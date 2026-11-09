import { Router } from 'express';
import { db } from '../db/index.js';
import { apenasMaster } from '../middleware/auth.js';
import { uuidValido, urlHttpsOuNulo } from '../utils/validacao.js';
import { registrarAuditoria } from '../middleware/auditoria.js';
import { registrarErroInterno, mensagemErroInterno } from '../middleware/erros.js';
import { salvarDocumentoHtml } from '../services/drive/documentos.js';
import { salvarPecaPadrao } from '../services/drive/pecas.js';
import { prepararProtocolo } from '../services/drive/protocolo.js';
import { deletarEventoCalendar } from '../services/calendar/index.js';
import { concluirTarefaComNumero } from './tarefas.js';

export const acervoRouter = Router();

const TIPOS = new Set(['inicial','emenda-inicial','impugnacao-contestacao','especificacao-provas','recurso-inominado','contrarrazoes','embargos-declaracao','apelacao','agravo','recurso-especial','recurso-extraordinario','memorial','cumprimento-sentenca','alvara','precatorio','cessao-credito','peticao-diversa']);
const RESULTADOS = new Set(['pendente','procedente','parcialmente-procedente','improcedente','provido','parcialmente-provido','desprovido','nao-conhecido','extinto-sem-merito','acordo','desistencia']);
const ENTES = new Set(['municipio-joao-pessoa','estado-paraiba','municipio-outro-pb','estado-pernambuco','estado-espirito-santo','uniao','inss','alpb','particular','outro']);
const INSTANCIAS = new Set(['1grau','2grau','turma-recursal','stj','stf','tre-pb','tse','administrativo']);
const page = (v, fallback = 1, max = 200) => Math.max(1, Math.min(max, Number.parseInt(v, 10) || fallback));

function podeVerRestrito(req) { return Boolean(req.user?.pode_marcar_restrito); }
function escopoVisibilidade(req, alias = 'a') { return podeVerRestrito(req) ? '' : ` AND ${alias}.visibilidade_snapshot = 'normal'`; }
function validarEnum(valor, conjunto, campo, obrigatorio = false) {
  if ((valor === undefined || valor === null || valor === '') && !obrigatorio) return null;
  if (!conjunto.has(valor)) { const e = new Error(`${campo} inválido.`); e.status = 422; throw e; }
  return valor;
}
// S-23: os links do acervo (Drive e fonte primária) viram botão "Abrir fonte" — só aceitam https://.
// Vazio = sem link; qualquer outra coisa (javascript:, data:, http:...) = 422.
function urlHttps(valor, campo) {
  if (valor === undefined || valor === null || String(valor).trim() === '') return null;
  const url = urlHttpsOuNulo(valor);
  if (!url) { const e = new Error(`${campo} inválido: use um endereço que comece com https://`); e.status = 422; throw e; }
  return url;
}
function normalizarTeses(teses) {
  if (!Array.isArray(teses) || !teses.length) { const e = new Error('Selecione ao menos uma tese.'); e.status = 422; throw e; }
  const unicas = [...new Set(teses.map(String))];
  if (unicas.some(s => !/^[a-z0-9-]+$/.test(s))) { const e = new Error('Tese inválida.'); e.status = 422; throw e; }
  return unicas;
}
async function validarTeses(slugs) {
  const rows = await db.query('SELECT slug FROM teses_acervo WHERE ativo=true AND slug=ANY($1::text[])', [slugs]);
  if (rows.length !== slugs.length) { const e = new Error('Uma ou mais teses não existem no catálogo.'); e.status = 422; throw e; }
}
async function processoContexto(processoId, processoNumero, instancia) {
  const vazio = { processoId: null, numero: null, clienteId: null, clienteNome: null, visibilidade: 'normal' };
  if (!processoId) return processoPorNumero(processoNumero, instancia, vazio);
  if (!uuidValido(processoId)) { const e = new Error('Processo inválido.'); e.status = 400; throw e; }
  const p = await db.queryOne(`SELECT p.numero, p.cliente_id, p.visibilidade, c.nome AS cliente_nome FROM processos p LEFT JOIN clientes c ON c.id=p.cliente_id WHERE p.id=$1`, [processoId]);
  if (!p) { const e = new Error('Processo não encontrado.'); e.status = 404; throw e; }
  return { processoId, numero: p.numero, clienteId: p.cliente_id, clienteNome: p.cliente_nome, visibilidade: p.visibilidade || 'normal' };
}
// As skills de petição mandam só o número CNJ, não o id interno. Sem esta busca a peça ficava
// solta no acervo: em 09/11/2026 eram 56 peças, 51 com número de processo existente e 0 ligadas.
// Liga só quando o número aponta para um único processo (desempata pelo grau da instância);
// número desconhecido ou ambíguo continua gravado só como texto, como antes.
export function grauDaInstancia(instancia) {
  if (instancia === '1grau') return '1';
  if (instancia === '2grau' || instancia === 'turma-recursal') return '2';
  return null;
}
async function processoPorNumero(processoNumero, instancia, vazio) {
  const digitos = String(processoNumero || '').replace(/\D/g, '');
  if (digitos.length !== 20) return vazio;
  let rows = await db.query(`SELECT p.id, p.numero, p.grau, p.cliente_id, p.visibilidade, c.nome AS cliente_nome FROM processos p LEFT JOIN clientes c ON c.id=p.cliente_id WHERE regexp_replace(p.numero, '[^0-9]', '', 'g')=$1`, [digitos]);
  const grau = grauDaInstancia(instancia);
  if (rows.length > 1 && grau) rows = rows.filter(r => String(r.grau) === grau);
  if (rows.length !== 1) return vazio;
  const p = rows[0];
  return { processoId: p.id, numero: p.numero, clienteId: p.cliente_id, clienteNome: p.cliente_nome, visibilidade: p.visibilidade || 'normal' };
}
async function gravarTeses(tipo, id, slugs) {
  const coluna = tipo === 'acervo_pecas' ? 'peca_id' : 'precedente_id';
  await db.execute(`DELETE FROM ${tipo}_teses WHERE ${coluna}=$1`, [id]);
  await db.execute(`INSERT INTO ${tipo}_teses (${coluna}, tese_id) SELECT $1,id FROM teses_acervo WHERE slug=ANY($2::text[])`, [id, slugs]);
}
function erro(res, err) { if (err.status) return res.status(err.status).json({ ok: false, erro: 'validacao', mensagem: err.message }); res.status(500).json({ ok: false, erro: 'interno', mensagem: mensagemErroInterno(registrarErroInterno(err, res.req)) }); }

acervoRouter.get('/teses', async (_req, res) => res.json({ ok:true, teses: await db.query('SELECT slug,label,drive_folder_id FROM teses_acervo WHERE ativo=true ORDER BY label') }));

acervoRouter.get('/', async (req, res) => {
  const { q='', tese, ente, tribunal, tipo, instancia, resultado, aba='todos', arquivados='false' } = req.query;
  const limite = page(req.query.limite, 50); const offset = (page(req.query.page) - 1) * limite;
  const params=[]; const where=[`a.arquivada_em IS ${arquivados==='true'?'NOT ':' '}NULL`];
  if (q.trim()) { params.push(`%${q.trim()}%`); where.push(`(a.titulo ILIKE $${params.length} OR a.processo_numero ILIKE $${params.length} OR a.cliente_nome ILIKE $${params.length} OR a.orgao_julgador ILIKE $${params.length} OR COALESCE(a.resumo,'') ILIKE $${params.length})`); }
  // Ficha do processo: só as peças ligadas a ele.
  if (req.query.processo_id) {
    if (!uuidValido(req.query.processo_id)) return res.status(400).json({ ok:false, erro:'validacao', mensagem:'Processo inválido.' });
    params.push(req.query.processo_id); where.push(`a.processo_id=$${params.length}`);
  }
  if (ente) { params.push(ente); where.push(`a.ente=$${params.length}`); }
  if (tribunal) { params.push(tribunal); where.push(`a.tribunal=$${params.length}`); }
  if (tipo && aba !== 'precedentes') { params.push(tipo); where.push(`a.tipo_peca=$${params.length}`); }
  if (instancia) { params.push(instancia); where.push(`a.instancia=$${params.length}`); }
  if (resultado) { params.push(resultado); where.push(`a.resultado=$${params.length}`); }
  if (tese) { params.push(tese); where.push(`EXISTS (SELECT 1 FROM acervo_pecas_teses apt JOIN teses_acervo t ON t.id=apt.tese_id WHERE apt.peca_id=a.id AND t.slug=$${params.length})`); }
  const wPecas = `${where.join(' AND ')}${escopoVisibilidade(req)}`;
  const pPecas = [...params];
  const pecas = aba === 'precedentes' ? [] : await db.query(`SELECT a.*, ARRAY(SELECT t.slug FROM acervo_pecas_teses apt JOIN teses_acervo t ON t.id=apt.tese_id WHERE apt.peca_id=a.id ORDER BY t.label) teses FROM acervo_pecas a WHERE ${wPecas} ORDER BY a.data_protocolo DESC NULLS LAST,a.criado_em DESC LIMIT $${pPecas.length+1} OFFSET $${pPecas.length+2}`, [...pPecas, limite, offset]);
  const pWhere=[`p.arquivada_em IS ${arquivados==='true'?'NOT ':' '}NULL`]; const pp=[];
  if (q.trim()) { pp.push(`%${q.trim()}%`); pWhere.push(`(p.processo_numero ILIKE $${pp.length} OR p.orgao ILIKE $${pp.length} OR p.ratio ILIKE $${pp.length} OR COALESCE(p.ementa,'') ILIKE $${pp.length})`); }
  if (ente) { pp.push(ente); pWhere.push(`p.ente=$${pp.length}`); } if (tribunal) { pp.push(tribunal); pWhere.push(`p.tribunal=$${pp.length}`); } if (instancia) { pp.push(instancia); pWhere.push(`p.instancia=$${pp.length}`); } if (resultado) { pp.push(resultado); pWhere.push(`p.resultado=$${pp.length}`); }
  if (tese) { pp.push(tese); pWhere.push(`EXISTS (SELECT 1 FROM acervo_precedentes_teses apt JOIN teses_acervo t ON t.id=apt.tese_id WHERE apt.precedente_id=p.id AND t.slug=$${pp.length})`); }
  if (aba === 'organizacao') pWhere.push(`(p.conferido=false OR p.fonte_primaria_url IS NULL)`);
  const wPrec = `${pWhere.join(' AND ')}${escopoVisibilidade(req,'p')}`;
  const precedentes = aba === 'pecas' ? [] : await db.query(`SELECT p.*, ARRAY(SELECT t.slug FROM acervo_precedentes_teses apt JOIN teses_acervo t ON t.id=apt.tese_id WHERE apt.precedente_id=p.id ORDER BY t.label) teses FROM acervo_precedentes p WHERE ${wPrec} ORDER BY p.vinculante DESC,p.conferido DESC,p.data_julgamento DESC NULLS LAST LIMIT $${pp.length+1} OFFSET $${pp.length+2}`, [...pp, limite, offset]);
  res.json({ ok:true, pecas, precedentes });
});

acervoRouter.post('/pecas', apenasMaster, async (req,res) => { try {
  const b=req.body||{}; const teses=normalizarTeses(b.teses); await validarTeses(teses); validarEnum(b.tipo_peca,TIPOS,'tipo_peca',true); validarEnum(b.ente,ENTES,'ente',true); validarEnum(b.instancia,INSTANCIAS,'instancia',true); validarEnum(b.resultado||'pendente',RESULTADOS,'resultado'); if (b.ente==='municipio-outro-pb'&&!String(b.ente_detalhe||'').trim()) { const e=new Error('Informe o município.');e.status=422;throw e; }
  const ctx=await processoContexto(b.processo_id,b.processo_numero,b.instancia); const [nova]=await db.query(`INSERT INTO acervo_pecas (processo_id,processo_numero,cliente_id,cliente_nome,titulo,tipo_peca,ente,ente_detalhe,tribunal,instancia,orgao_julgador,relator,data_protocolo,drive_file_id,drive_url,resultado,resumo,modelo_aprovado,visibilidade_snapshot,criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,[ctx.processoId,ctx.numero||b.processo_numero||null,ctx.clienteId||b.cliente_id||null,ctx.clienteNome||b.cliente_nome||'Sem cliente vinculado',String(b.titulo||b.tipo_peca).trim(),b.tipo_peca,b.ente,b.ente_detalhe||null,b.tribunal||null,b.instancia,b.orgao_julgador||null,b.relator||null,b.data_protocolo||null,b.drive_file_id||null,urlHttps(b.drive_url,'drive_url'),b.resultado||'pendente',b.resumo||null,Boolean(b.modelo_aprovado),ctx.visibilidade,req.user.id]); await gravarTeses('acervo_pecas',nova.id,teses); await registrarAuditoria({usuarioId:req.user.id,acao:'criar',entidade:'acervo_peca',entidadeId:nova.id,valorDepois:{teses,tipo:b.tipo_peca},ip:req._ip}); res.status(201).json({ok:true,peca:nova});
}catch(e){erro(res,e);} });

acervoRouter.post('/precedentes', apenasMaster, async (req,res) => { try {
  const b=req.body||{}; const teses=normalizarTeses(b.teses); await validarTeses(teses); validarEnum(b.ente,ENTES,'ente'); validarEnum(b.instancia,INSTANCIAS,'instancia',true); validarEnum(b.resultado,RESULTADOS,'resultado',true); if (!String(b.orgao||'').trim()||!String(b.ratio||'').trim()||!b.data_julgamento) { const e=new Error('Órgão, data de julgamento e fundamento são obrigatórios.');e.status=422;throw e; }
  const ctx=await processoContexto(b.processo_id,b.processo_numero,b.instancia); const [novo]=await db.query(`INSERT INTO acervo_precedentes (processo_id,processo_numero,orgao,tribunal,instancia,relator,data_julgamento,ente,ratio,ementa,resultado,favoravel,vinculante,conferido,fonte_primaria_url,drive_file_id,drive_url,visibilidade_snapshot,criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,false,$14,$15,$16,$17,$18) RETURNING *`,[ctx.processoId,ctx.numero||b.processo_numero||null,b.orgao,b.tribunal||null,b.instancia,b.relator||null,b.data_julgamento,b.ente||null,b.ratio,b.ementa||null,b.resultado,Boolean(b.favoravel),Boolean(b.vinculante),urlHttps(b.fonte_primaria_url,'fonte_primaria_url'),b.drive_file_id||null,urlHttps(b.drive_url,'drive_url'),ctx.visibilidade,req.user.id]); await gravarTeses('acervo_precedentes',novo.id,teses); await registrarAuditoria({usuarioId:req.user.id,acao:'criar',entidade:'acervo_precedente',entidadeId:novo.id,valorDepois:{teses,conferido:false},ip:req._ip}); res.status(201).json({ok:true,precedente:novo});
}catch(e){erro(res,e);} });

acervoRouter.patch('/precedentes/:id/conferir', apenasMaster, async (req,res)=>{ try { if(!uuidValido(req.params.id)) return res.status(400).json({ok:false,erro:'validacao',mensagem:'ID inválido.'}); const fonte=String(req.body?.fonte_primaria_url||'').trim(); if(!fonte) return res.status(422).json({ok:false,erro:'validacao',mensagem:'Informe a fonte primária conferida.'}); if(!urlHttpsOuNulo(fonte)) return res.status(422).json({ok:false,erro:'validacao',mensagem:'A fonte primária deve ser um endereço que comece com https://'}); const [p]=await db.query(`UPDATE acervo_precedentes SET conferido=true,conferido_por=$1,conferido_em=NOW(),fonte_primaria_url=$2 WHERE id=$3${escopoVisibilidade(req,'acervo_precedentes')} RETURNING *`,[req.user.id,fonte,req.params.id]); if(!p)return res.status(404).json({ok:false,erro:'Não encontrado.'}); await registrarAuditoria({usuarioId:req.user.id,acao:'conferir',entidade:'acervo_precedente',entidadeId:p.id,valorDepois:{fonte},ip:req._ip});res.json({ok:true,precedente:p}); }catch(e){erro(res,e);} });

acervoRouter.patch('/pecas/:id/resultado', apenasMaster, async (req,res)=>{ try { if(!uuidValido(req.params.id)) return res.status(400).json({ok:false,erro:'validacao',mensagem:'ID inv\u00e1lido.'}); const b=req.body||{}; validarEnum(b.resultado,RESULTADOS,'resultado',true); const [p]=await db.query(`UPDATE acervo_pecas SET resultado=$1,resumo=COALESCE($2,resumo),atualizado_em=NOW() WHERE id=$3${escopoVisibilidade(req,'acervo_pecas')} RETURNING *`,[b.resultado,b.resumo||null,req.params.id]); if(!p) return res.status(404).json({ok:false,erro:'N\u00e3o encontrado.'}); await registrarAuditoria({usuarioId:req.user.id,acao:'atualizar',entidade:'acervo_peca',entidadeId:p.id,valorDepois:{resultado:b.resultado},ip:req._ip}); res.json({ok:true,peca:p}); }catch(e){erro(res,e);} });

for (const [tipo,tabela] of [['pecas','acervo_pecas'],['precedentes','acervo_precedentes']]) {
  acervoRouter.post(`/${tipo}/:id/arquivar`, apenasMaster, async(req,res)=>{if(!uuidValido(req.params.id))return res.status(400).json({ok:false,erro:'ID inválido.'});const [r]=await db.query(`UPDATE ${tabela} SET arquivada_em=NOW(),arquivada_por=$1 WHERE id=$2${escopoVisibilidade(req,tabela)} AND arquivada_em IS NULL RETURNING id`,[req.user.id,req.params.id]);if(!r)return res.status(404).json({ok:false,erro:'Registro não encontrado.'});await registrarAuditoria({usuarioId:req.user.id,acao:'arquivar',entidade:tabela,entidadeId:r.id,ip:req._ip});res.json({ok:true});});
  acervoRouter.post(`/${tipo}/:id/restaurar`, apenasMaster, async(req,res)=>{if(!uuidValido(req.params.id))return res.status(400).json({ok:false,erro:'ID inválido.'});const [r]=await db.query(`UPDATE ${tabela} SET arquivada_em=NULL,arquivada_por=NULL WHERE id=$1${escopoVisibilidade(req,tabela)} AND arquivada_em IS NOT NULL RETURNING id`,[req.params.id]);if(!r)return res.status(404).json({ok:false,erro:'Registro não encontrado.'});await registrarAuditoria({usuarioId:req.user.id,acao:'restaurar',entidade:tabela,entidadeId:r.id,ip:req._ip});res.json({ok:true});});
}

// Grava uma peça/planilha (HTML) como PDF e/ou Word na pasta do cliente no Drive (Master).
// Usado pelo conector do Claude: o PJe exige PDF e o conector do Google Drive só grava texto.
acervoRouter.post('/drive/documentos', apenasMaster, async (req, res) => {
  const b = req.body || {};
  try {
    const r = await salvarDocumentoHtml({
      pastaId: b.pasta_id, nome: b.nome, html: b.html,
      formatos: Array.isArray(b.formatos) && b.formatos.length ? b.formatos : ['pdf'],
      orientacao: b.orientacao === 'paisagem' ? 'paisagem' : 'retrato',
    });
    await registrarAuditoria({ usuarioId: req.user.id, acao: 'gravar_documento_drive', entidade: 'drive_documento',
      entidadeId: r.arquivos[0]?.id || b.pasta_id, valorDepois: { pasta: r.pasta.nome, arquivos: r.arquivos.map(a => a.nome) }, ip: req._ip });
    res.status(201).json({ ok: true, ...r });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ ok: false, erro: 'validacao', mensagem: e.message });
    console.error('[Acervo/Drive] Gravação falhou:', e.message);
    res.status(502).json({ ok: false, erro: 'drive', mensagem: 'Não foi possível gravar no Google Drive agora. Confira a autorização do Google.' });
  }
});

// Confere a pasta do cliente e monta a ficha de protocolo de cada processo (só leitura; Master).
acervoRouter.get('/drive/protocolo/:pastaId', apenasMaster, async (req, res) => {
  try {
    res.json({ ok: true, ...(await prepararProtocolo({ pastaId: req.params.pastaId })) });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ ok: false, erro: 'validacao', mensagem: e.message });
    console.error('[Acervo/Drive] Ficha de protocolo falhou:', e.message);
    res.status(502).json({ ok: false, erro: 'drive', mensagem: 'Não foi possível ler a pasta no Google Drive agora.' });
  }
});

// Grava uma peça no padrão de formatação do escritório (blocos → Word ABNT → PDF/.docx) na pasta do cliente (Master).
acervoRouter.post('/drive/pecas', apenasMaster, async (req, res) => {
  const b = req.body || {};
  try {
    const r = await salvarPecaPadrao({
      pastaId: b.pasta_id, nome: b.nome, blocos: b.blocos,
      formatos: Array.isArray(b.formatos) && b.formatos.length ? b.formatos : ['pdf'],
      orientacao: b.orientacao === 'paisagem' ? 'paisagem' : 'retrato',
    });
    await registrarAuditoria({ usuarioId: req.user.id, acao: 'gravar_peca_drive', entidade: 'drive_documento',
      entidadeId: r.arquivos[0]?.id || b.pasta_id, valorDepois: { pasta: r.pasta.nome, arquivos: r.arquivos.map(a => a.nome) }, ip: req._ip });
    res.status(201).json({ ok: true, ...r });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ ok: false, erro: 'validacao', mensagem: e.message });
    console.error('[Acervo/Drive] Gravação de peça falhou:', e.message);
    res.status(502).json({ ok: false, erro: 'drive', mensagem: 'Não foi possível gravar no Google Drive agora. Confira a autorização do Google.' });
  }
});

// ── Fecho da peça pelas skills (09/11/2026) ──────────────────────────────────────────────────
// A skill de petição, ao terminar a peça, consulta o processo, mostra ao usuário o prazo que a peça
// cumpre (ou a tarefa de protocolo da inicial) e só depois da confirmação dele chama as rotas de
// escrita abaixo. Nada aqui é decidido sozinho: as escritas exigem o id exato da tarefa.

const STATUS_ABERTOS = ['pendente', 'em_execucao', 'aguardando_validacao', 'devolvida'];

// GET /api/acervo/contexto-processo?numero=&cliente_id= — SÓ LEITURA.
// Com o número: o processo no AM e os prazos abertos dele. Sem processo (inicial recém-protocolada)
// e com cliente_id: as tarefas de protocolo abertas do cliente e os vínculos ativos.
acervoRouter.get('/contexto-processo', apenasMaster, async (req, res) => { try {
  const digitos = String(req.query.numero || '').replace(/\D/g, '');
  const clienteId = req.query.cliente_id || null;
  const clienteNome = String(req.query.cliente_nome || '').trim().slice(0, 120);
  if (clienteId && !uuidValido(clienteId)) return res.status(400).json({ ok:false, erro:'validacao', mensagem:'Cliente inválido.' });
  if (digitos && digitos.length !== 20) return res.status(400).json({ ok:false, erro:'validacao', mensagem:'Número CNJ incompleto: são 20 dígitos.' });
  if (!digitos && !clienteId && !clienteNome) return res.status(400).json({ ok:false, erro:'validacao', mensagem:'Informe o número do processo ou o cliente.' });

  const processos = digitos ? await db.query(
    `SELECT p.id, p.numero, p.tribunal, p.grau, p.cliente_id, c.nome AS cliente_nome, pr.nome AS tese
       FROM processos p LEFT JOIN clientes c ON c.id=p.cliente_id LEFT JOIN produtos pr ON pr.id=p.produto_id
      WHERE regexp_replace(p.numero, '[^0-9]', '', 'g')=$1 ORDER BY p.grau`, [digitos]) : [];

  const prazos = processos.length ? await db.query(
    `SELECT t.id, t.processo_id, t.descricao, t.prazo_data, t.status, t.urgencia
       FROM tarefas t WHERE t.tipo='prazo' AND t.processo_id = ANY($1::uuid[]) AND t.status = ANY($2::text[])
      ORDER BY t.prazo_data NULLS LAST`, [processos.map(p => p.id), STATUS_ABERTOS]) : [];

  // Sem cliente_id, acha pelo nome (cada palavra precisa aparecer); só usa se achar um único cliente.
  // O conector de petição costuma ter só o escopo "acervo", sem o localizar_cliente da comunicação.
  let clientesEncontrados = [];
  if (!processos.length && !clienteId && clienteNome.length >= 3) {
    const palavras = clienteNome.split(/\s+/).filter(w => w.length >= 2).slice(0, 6);
    if (palavras.length) {
      clientesEncontrados = await db.query(
        `SELECT id, nome FROM clientes WHERE ativo=true AND ${palavras.map((_, i) => `nome ILIKE $${i + 1}`).join(' AND ')} ORDER BY nome LIMIT 6`,
        palavras.map(w => `%${w}%`));
    }
  }
  const idCliente = clienteId || (processos.length === 1 ? processos[0].cliente_id : null)
    || (clientesEncontrados.length === 1 ? clientesEncontrados[0].id : null);
  let protocolos = [], vinculos = [];
  if (!processos.length && idCliente) {
    protocolos = await db.query(
      `SELECT t.id, t.status, t.subtipo, t.prazo_data, t.ciclo_inicio, t.precisa_triagem, pr.nome AS tese
         FROM tarefas t JOIN cliente_produtos cp ON cp.id=t.cliente_produto_id JOIN produtos pr ON pr.id=cp.produto_id
        WHERE t.tipo='protocolar' AND cp.cliente_id=$1 AND t.status = ANY($2::text[])
        ORDER BY t.prazo_data NULLS LAST, t.criado_em`, [idCliente, STATUS_ABERTOS]);
    vinculos = await db.query(
      `SELECT id, cargo, orgao, polo_passivo FROM cliente_vinculos WHERE cliente_id=$1 AND vinculo_ativo=true ORDER BY ordem`, [idCliente]);
  }
  res.json({ ok:true, processos, prazos_abertos: prazos, clientes_encontrados: clientesEncontrados, protocolos_pendentes: protocolos, vinculos_ativos: vinculos });
} catch (e) { erro(res, e); } });

// POST /api/acervo/prazos/:id/cumprir — marca como concluída UMA tarefa de prazo, depois que o
// usuário confirmou qual prazo a peça cumpre. body: { peca_id? } (liga a peça na observação/auditoria).
acervoRouter.post('/prazos/:id/cumprir', apenasMaster, async (req, res) => { try {
  if (!uuidValido(req.params.id)) return res.status(400).json({ ok:false, erro:'validacao', mensagem:'Tarefa inválida.' });
  const pecaId = req.body?.peca_id || null;
  if (pecaId && !uuidValido(pecaId)) return res.status(400).json({ ok:false, erro:'validacao', mensagem:'Peça inválida.' });
  const t = await db.queryOne(`SELECT id, tipo, status, processo_id, descricao, calendar_event_id FROM tarefas WHERE id=$1`, [req.params.id]);
  if (!t) return res.status(404).json({ ok:false, erro:'nao-encontrado', mensagem:'Tarefa não encontrada.' });
  if (t.tipo !== 'prazo') return res.status(409).json({ ok:false, erro:'validacao', mensagem:'Esta tarefa não é um prazo processual.' });
  if (!STATUS_ABERTOS.includes(t.status)) return res.status(409).json({ ok:false, erro:'validacao', mensagem:`O prazo já está ${t.status}.` });
  let peca = null;
  if (pecaId) {
    peca = await db.queryOne(`SELECT id, titulo, processo_id FROM acervo_pecas WHERE id=$1`, [pecaId]);
    if (!peca) return res.status(404).json({ ok:false, erro:'nao-encontrado', mensagem:'Peça não encontrada no acervo.' });
    if (peca.processo_id && t.processo_id && peca.processo_id !== t.processo_id) {
      return res.status(409).json({ ok:false, erro:'validacao', mensagem:'A peça e o prazo são de processos diferentes.' });
    }
  }
  const nota = `Cumprido com a peça${peca ? ` "${peca.titulo}"` : ''} (registro pelo acervo).`;
  const r = await db.execute(
    `UPDATE tarefas SET status='concluida', concluida_em=NOW(),
       observacao = CASE WHEN COALESCE(observacao,'')='' THEN $2 ELSE observacao || E'\n' || $2 END
     WHERE id=$1 AND status = ANY($3::text[])`, [t.id, nota, STATUS_ABERTOS]);
  if (r.rowCount === 0) return res.status(409).json({ ok:false, erro:'validacao', mensagem:'O prazo mudou de situação; consulte de novo.' });
  if (t.calendar_event_id) deletarEventoCalendar(t.calendar_event_id).catch(() => {});
  await registrarAuditoria({ usuarioId:req.user.id, acao:'cumprir_prazo', entidade:'tarefa', entidadeId:t.id,
    valorAntes:{ status:t.status }, valorDepois:{ status:'concluida', peca_id: peca?.id || null }, ip:req._ip });
  res.json({ ok:true, tarefa_id:t.id, processo_id:t.processo_id, descricao:t.descricao });
} catch (e) { erro(res, e); } });

// POST /api/acervo/protocolos/:id/concluir — inicial protocolada: conclui a tarefa de protocolo com o
// número CNJ e cria o processo no AM (cliente, tese, polo, tribunal pelo CNJ). Mesma regra da tela de
// Tarefas (concluir-com-numero). body: { numero_processo, periodo_fim, periodo_inicio?, vinculo_id? }
acervoRouter.post('/protocolos/:id/concluir', apenasMaster, async (req, res) => { try {
  if (!uuidValido(req.params.id)) return res.status(400).json({ ok:false, erro:'validacao', mensagem:'Tarefa inválida.' });
  await concluirTarefaComNumero(req, res);
} catch (e) { if (!res.headersSent) erro(res, e); } });
