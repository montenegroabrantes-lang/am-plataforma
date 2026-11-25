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
import { enfileirarAviso, montarAvisoVigilancia, despacharEmSeguida, montarLinhaDecisao, montarAvisoTese, ESPERA_AGRUPAR_DECISOES_MIN } from '../services/avisosAcervo.js';
import { concluirTarefaComNumero } from './tarefas.js';
import { cnjParaMensagem } from '../services/mensagensAlerta.js';

export const acervoRouter = Router();

const TIPOS = new Set(['inicial','emenda-inicial','impugnacao-contestacao','especificacao-provas','recurso-inominado','contrarrazoes','embargos-declaracao','apelacao','agravo','recurso-especial','recurso-extraordinario','memorial','cumprimento-sentenca','alvara','precatorio','cessao-credito','peticao-diversa']);
const RESULTADOS = new Set(['pendente','procedente','parcialmente-procedente','improcedente','provido','parcialmente-provido','desprovido','nao-conhecido','extinto-sem-merito','acordo','desistencia']);
const ENTES = new Set(['municipio-joao-pessoa','estado-paraiba','municipio-outro-pb','estado-pernambuco','estado-espirito-santo','uniao','inss','alpb','particular','outro']);
const INSTANCIAS = new Set(['1grau','2grau','turma-recursal','stj','stf','tre-pb','tse','administrativo']);
// Camada de conhecimento (23/11/2026): situação da tese, argumentos e resultado de cada pedido da peça.
const STATUS_TESE = new Set(['ativa','em_risco','suspensa','superada']);
const TIPOS_ARGUMENTO = new Set(['fundamento','defesa_fazenda','resposta','preliminar','calculo']);
const STATUS_ARGUMENTO = new Set(['em_teste','aprovado','abandonado']);
const RESULTADOS_PEDIDO = new Set(['pendente','a-confirmar','deferido','parcialmente-deferido','indeferido','prejudicado','nao-apreciado']);
const page = (v, fallback = 1, max = 200) => Math.max(1, Math.min(max, Number.parseInt(v, 10) || fallback));

function podeVerRestrito(req) { return Boolean(req.user?.pode_marcar_restrito); }
function escopoVisibilidade(req, alias = 'a') { return podeVerRestrito(req) ? '' : ` AND ${alias}.visibilidade_snapshot = 'normal'`; }
function validarEnum(valor, conjunto, campo, obrigatorio = false) {
  if ((valor === undefined || valor === null || valor === '') && !obrigatorio) return null;
  if (!conjunto.has(valor)) { const e = new Error(`${campo} inválido. Valores aceitos: ${[...conjunto].join(', ')}.`); e.status = 422; throw e; }
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

acervoRouter.get('/teses', async (_req, res) => res.json({ ok:true, teses: await db.query(`SELECT t.slug, t.label, t.drive_folder_id, m.slug AS tese_mae, t.status, t.status_motivo, t.skill_slug FROM teses_acervo t LEFT JOIN teses_acervo m ON m.id=t.tese_mae_id WHERE t.ativo=true ORDER BY t.label`) }));

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

// §5.3: peça de mérito alimenta a estatística por argumento. Sem os argumentos usados ela é registrada
// mesmo assim, com aviso, e aparece na curadoria do painel ("sem argumentos").
const TIPOS_COM_ARGUMENTO = new Set(['inicial','emenda-inicial','impugnacao-contestacao','recurso-inominado','contrarrazoes','embargos-declaracao','apelacao','agravo','recurso-especial','recurso-extraordinario','memorial']);
const semArgumentos = (tipo, argumentos) => TIPOS_COM_ARGUMENTO.has(tipo) && !(argumentos?.length);
const AVISO_SEM_ARGUMENTOS = 'Peça registrada sem os argumentos usados. Informe os ids em "argumentos" (veja listar_argumentos) com atualizar_peca, para ela entrar no êxito por argumento.';
acervoRouter.post('/pecas', apenasMaster, async (req,res) => { try {
  const b=req.body||{}; const teses=normalizarTeses(b.teses); await validarTeses(teses); validarEnum(b.tipo_peca,TIPOS,'tipo_peca',true); validarEnum(b.ente,ENTES,'ente',true); validarEnum(b.instancia,INSTANCIAS,'instancia',true); validarEnum(b.resultado||'pendente',RESULTADOS,'resultado'); if (b.ente==='municipio-outro-pb'&&!String(b.ente_detalhe||'').trim()) { const e=new Error('Informe o município.');e.status=422;throw e; }
  const ligacoes=await lerLigacoes(b,LIGACOES_PECA,req);
  const ctx=await processoContexto(b.processo_id,b.processo_numero,b.instancia); const [nova]=await db.query(`INSERT INTO acervo_pecas (processo_id,processo_numero,cliente_id,cliente_nome,titulo,tipo_peca,ente,ente_detalhe,tribunal,instancia,orgao_julgador,relator,data_protocolo,drive_file_id,drive_url,resultado,resumo,modelo_aprovado,visibilidade_snapshot,criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,[ctx.processoId,ctx.numero||b.processo_numero||null,ctx.clienteId||b.cliente_id||null,ctx.clienteNome||b.cliente_nome||'Sem cliente vinculado',String(b.titulo||b.tipo_peca).trim(),b.tipo_peca,b.ente,b.ente_detalhe||null,b.tribunal||null,b.instancia,b.orgao_julgador||null,b.relator||null,b.data_protocolo||null,b.drive_file_id||null,urlHttps(b.drive_url,'drive_url'),b.resultado||'pendente',b.resumo||null,Boolean(b.modelo_aprovado),ctx.visibilidade,req.user.id]); await gravarTeses('acervo_pecas',nova.id,teses); await trocarLigacoes(LIGACOES_PECA,nova.id,ligacoes,req); await registrarAuditoria({usuarioId:req.user.id,acao:'criar',entidade:'acervo_peca',entidadeId:nova.id,valorDepois:{teses,tipo:b.tipo_peca,...ligacoes,...marcaChave(req)},ip:req._ip}); res.status(201).json({ok:true,peca:{...nova,...ligacoes},...(semArgumentos(b.tipo_peca,ligacoes.argumentos)?{aviso:AVISO_SEM_ARGUMENTOS}:{})});
}catch(e){erro(res,e);} });

acervoRouter.post('/precedentes', apenasMaster, async (req,res) => { try {
  const b=req.body||{}; const teses=normalizarTeses(b.teses); await validarTeses(teses); validarEnum(b.ente,ENTES,'ente'); validarEnum(b.instancia,INSTANCIAS,'instancia',true); validarEnum(b.resultado,RESULTADOS,'resultado',true); if (!String(b.orgao||'').trim()||!String(b.ratio||'').trim()||!b.data_julgamento) { const e=new Error('Órgão, data de julgamento e fundamento são obrigatórios.');e.status=422;throw e; }
  const ctx=await processoContexto(b.processo_id,b.processo_numero,b.instancia); const [novo]=await db.query(`INSERT INTO acervo_precedentes (processo_id,processo_numero,orgao,tribunal,instancia,relator,data_julgamento,ente,ratio,ementa,resultado,favoravel,vinculante,conferido,fonte_primaria_url,drive_file_id,drive_url,visibilidade_snapshot,criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,false,$14,$15,$16,$17,$18) RETURNING *`,[ctx.processoId,ctx.numero||b.processo_numero||null,b.orgao,b.tribunal||null,b.instancia,b.relator||null,b.data_julgamento,b.ente||null,b.ratio,b.ementa||null,b.resultado,Boolean(b.favoravel),Boolean(b.vinculante),urlHttps(b.fonte_primaria_url,'fonte_primaria_url'),b.drive_file_id||null,urlHttps(b.drive_url,'drive_url'),ctx.visibilidade,req.user.id]); await gravarTeses('acervo_precedentes',novo.id,teses); await registrarAuditoria({usuarioId:req.user.id,acao:'criar',entidade:'acervo_precedente',entidadeId:novo.id,valorDepois:{teses,conferido:false},ip:req._ip}); res.status(201).json({ok:true,precedente:novo});
}catch(e){erro(res,e);} });

acervoRouter.patch('/precedentes/:id/conferir', apenasMaster, async (req,res)=>{ try { if(!uuidValido(req.params.id)) return res.status(400).json({ok:false,erro:'validacao',mensagem:'ID inválido.'}); const fonte=String(req.body?.fonte_primaria_url||'').trim(); if(!fonte) return res.status(422).json({ok:false,erro:'validacao',mensagem:'Informe a fonte primária conferida.'}); if(!urlHttpsOuNulo(fonte)) return res.status(422).json({ok:false,erro:'validacao',mensagem:'A fonte primária deve ser um endereço que comece com https://'}); const [p]=await db.query(`UPDATE acervo_precedentes SET conferido=true,conferido_por=$1,conferido_em=NOW(),fonte_primaria_url=$2 WHERE id=$3${escopoVisibilidade(req,'acervo_precedentes')} RETURNING *`,[req.user.id,fonte,req.params.id]); if(!p)return res.status(404).json({ok:false,erro:'Não encontrado.'}); await registrarAuditoria({usuarioId:req.user.id,acao:'conferir',entidade:'acervo_precedente',entidadeId:p.id,valorDepois:{fonte},ip:req._ip});res.json({ok:true,precedente:p}); }catch(e){erro(res,e);} });

acervoRouter.patch('/pecas/:id/resultado', apenasMaster, async (req,res)=>{ try { if(!uuidValido(req.params.id)) return res.status(400).json({ok:false,erro:'validacao',mensagem:'ID inv\u00e1lido.'}); const b=req.body||{}; validarEnum(b.resultado,RESULTADOS,'resultado',true); const [p]=await db.query(`UPDATE acervo_pecas SET resultado=$1,resumo=COALESCE($2,resumo),atualizado_em=NOW() WHERE id=$3${escopoVisibilidade(req,'acervo_pecas')} RETURNING *`,[b.resultado,b.resumo||null,req.params.id]); if(!p) return res.status(404).json({ok:false,erro:'N\u00e3o encontrado.'}); await registrarAuditoria({usuarioId:req.user.id,acao:'atualizar',entidade:'acervo_peca',entidadeId:p.id,valorDepois:{resultado:b.resultado},ip:req._ip}); res.json({ok:true,peca:p}); }catch(e){erro(res,e);} });

for (const [tipo,tabela] of [['pecas','acervo_pecas'],['precedentes','acervo_precedentes']]) {
  acervoRouter.post(`/${tipo}/:id/arquivar`, apenasMaster, async(req,res)=>{if(!uuidValido(req.params.id))return res.status(400).json({ok:false,erro:'ID inválido.'});const [r]=await db.query(`UPDATE ${tabela} SET arquivada_em=NOW(),arquivada_por=$1 WHERE id=$2${escopoVisibilidade(req,tabela)} AND arquivada_em IS NULL RETURNING id,arquivada_em`,[req.user.id,req.params.id]);if(!r)return res.status(404).json({ok:false,erro:'Registro não encontrado.'});await registrarAuditoria({usuarioId:req.user.id,acao:'arquivar',entidade:tabela,entidadeId:r.id,valorAntes:{arquivada_em:null},valorDepois:{arquivada_em:r.arquivada_em,...marcaChave(req)},ip:req._ip});res.json({ok:true});});
  acervoRouter.post(`/${tipo}/:id/restaurar`, apenasMaster, async(req,res)=>{if(!uuidValido(req.params.id))return res.status(400).json({ok:false,erro:'ID inválido.'});const [r]=await db.query(`UPDATE ${tabela} SET arquivada_em=NULL,arquivada_por=NULL WHERE id=$1${escopoVisibilidade(req,tabela)} AND arquivada_em IS NOT NULL RETURNING id`,[req.params.id]);if(!r)return res.status(404).json({ok:false,erro:'Registro não encontrado.'});await registrarAuditoria({usuarioId:req.user.id,acao:'restaurar',entidade:tabela,entidadeId:r.id,valorDepois:{arquivada_em:null,...marcaChave(req)},ip:req._ip});res.json({ok:true});});
}

// ── Leitura individual e edição geral (23/11/2026) ─────────────────────────────────────────
// Usadas pela tela e pela chave externa do acervo (permissões acervo_leitura / acervo_edicao).
const LIMITE_TEXTO = 20_000;
function texto(valor, campo, { obrigatorio = false, max = LIMITE_TEXTO } = {}) {
  const t = valor === null || valor === undefined ? '' : String(valor).trim();
  if (!t) { if (obrigatorio) { const e = new Error(`${campo} não pode ficar vazio.`); e.status = 422; throw e; } return null; }
  if (t.length > max) { const e = new Error(`${campo} excede ${max} caracteres.`); e.status = 422; throw e; }
  return t;
}
function dataOuNulo(valor, campo, obrigatorio = false) {
  if (valor === null || valor === undefined || valor === '') { if (obrigatorio) { const e = new Error(`${campo} é obrigatório.`); e.status = 422; throw e; } return null; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(valor)) || Number.isNaN(Date.parse(valor))) { const e = new Error(`${campo} inválido (use AAAA-MM-DD).`); e.status = 422; throw e; }
  return String(valor);
}
// Campos editáveis e seus conversores. Só campos presentes no corpo entram no UPDATE.
const CAMPOS_PECA = {
  titulo: v => texto(v, 'titulo', { obrigatorio: true, max: 300 }),
  tipo_peca: v => validarEnum(v, TIPOS, 'tipo_peca', true),
  ente: v => validarEnum(v, ENTES, 'ente', true),
  ente_detalhe: v => texto(v, 'ente_detalhe', { max: 200 }),
  tribunal: v => texto(v, 'tribunal', { max: 100 }),
  instancia: v => validarEnum(v, INSTANCIAS, 'instancia', true),
  orgao_julgador: v => texto(v, 'orgao_julgador', { max: 300 }),
  relator: v => texto(v, 'relator', { max: 200 }),
  data_protocolo: v => dataOuNulo(v, 'data_protocolo'),
  drive_file_id: v => texto(v, 'drive_file_id', { max: 200 }),
  drive_url: v => urlHttps(v, 'drive_url'),
  resultado: v => validarEnum(v, RESULTADOS, 'resultado', true),
  resumo: v => texto(v, 'resumo'),
  modelo_aprovado: v => Boolean(v),
  data_decisao: v => dataOuNulo(v, 'data_decisao'),
  decisao_id: v => { if (v === null || v === '') return null; if (!uuidValido(String(v))) throw invalido('decisao_id inválido.'); return String(v).toLowerCase(); },
  orgao_julgador_id: v => { if (v === null || v === '') return null; if (!uuidValido(String(v))) throw invalido('orgao_julgador_id inválido.'); return String(v).toLowerCase(); },
  resultado_por_pedido: v => resultadoPorPedido(v),
};
const CAMPOS_PRECEDENTE = {
  orgao: v => texto(v, 'orgao', { obrigatorio: true, max: 300 }),
  tribunal: v => texto(v, 'tribunal', { max: 100 }),
  instancia: v => validarEnum(v, INSTANCIAS, 'instancia', true),
  relator: v => texto(v, 'relator', { max: 200 }),
  data_julgamento: v => dataOuNulo(v, 'data_julgamento', true),
  ente: v => validarEnum(v, ENTES, 'ente'),
  ratio: v => texto(v, 'ratio', { obrigatorio: true }),
  ementa: v => texto(v, 'ementa'),
  resultado: v => validarEnum(v, RESULTADOS, 'resultado', true),
  favoravel: v => Boolean(v),
  vinculante: v => Boolean(v),
  fonte_primaria_url: v => urlHttps(v, 'fonte_primaria_url'),
  drive_file_id: v => texto(v, 'drive_file_id', { max: 200 }),
  drive_url: v => urlHttps(v, 'drive_url'),
};
// Mudou o conteúdo do precedente → o selo de conferido deixa de valer (zero alucinação).
const CAMPOS_PRECEDENTE_MATERIAIS = ['orgao', 'tribunal', 'instancia', 'data_julgamento', 'ratio', 'ementa', 'resultado', 'vinculante', 'fonte_primaria_url'];
const comoTexto = v => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? ''));

function montarAlteracoes(corpo, campos) {
  const alteracoes = {};
  for (const [campo, conv] of Object.entries(campos)) if (Object.hasOwn(corpo, campo)) alteracoes[campo] = conv(corpo[campo]);
  return alteracoes;
}
const marcaChave = req => (req.user?.via_chave ? { via_chave: req.user.via_chave } : {});

// ── Camada de conhecimento (23/11/2026) ──────────────────────────────────────────────────────
// Spec "AM - Estrutura Avancada do Acervo.md", §4.1 a §4.3: árvore e situação da tese, argumentos
// (fundamento, defesa da Fazenda × resposta, preliminar, cálculo) e o que cada peça usou e obteve.
function invalido(mensagem) { const e = new Error(mensagem); e.status = 422; return e; }
function listaIds(valor, campo, max = 200) {
  if (!Array.isArray(valor)) throw invalido(`${campo} deve ser uma lista de IDs.`);
  const unicos = [...new Set(valor.map(v => String(v).toLowerCase()))];
  if (unicos.length > max) throw invalido(`${campo}: no máximo ${max} itens.`);
  if (unicos.some(id => !uuidValido(id))) throw invalido(`${campo}: ID inválido.`);
  return unicos;
}
// Precedente de processo restrito não aparece para quem não pode vê-lo (a chave externa nunca pode).
function filtroLigacaoVisivel(l, req, alias) {
  return l.alvo === 'precedente_id' && !podeVerRestrito(req)
    ? ` AND ${alias}.precedente_id IN (SELECT id FROM acervo_precedentes WHERE visibilidade_snapshot = 'normal')` : '';
}
async function validarPrecedentes(ids, req) {
  if (!ids.length) return;
  const rows = await db.query(`SELECT p.id FROM acervo_precedentes p WHERE p.id = ANY($1::uuid[]) AND p.arquivada_em IS NULL${escopoVisibilidade(req, 'p')}`, [ids]);
  if (rows.length !== ids.length) throw invalido('Um ou mais precedentes não existem no acervo ou estão arquivados.');
}
async function validarArgumentos(ids) {
  if (!ids.length) return;
  const rows = await db.query('SELECT id FROM acervo_argumentos WHERE id = ANY($1::uuid[])', [ids]);
  if (rows.length !== ids.length) throw invalido('Um ou mais argumentos não existem no acervo.');
}
// Ligações N:N. A lista enviada substitui a anterior, mas só no que quem edita enxerga: um precedente
// restrito ligado por quem pode vê-lo continua ligado quando a chave externa troca a lista.
const LIGACOES_PECA = [
  { campo: 'argumentos', tabela: 'acervo_pecas_argumentos', dono: 'peca_id', alvo: 'argumento_id', validar: validarArgumentos },
  { campo: 'precedentes', tabela: 'acervo_pecas_precedentes', dono: 'peca_id', alvo: 'precedente_id', validar: validarPrecedentes },
];
const LIGACOES_ARGUMENTO = [
  { campo: 'precedentes', tabela: 'acervo_argumentos_precedentes', dono: 'argumento_id', alvo: 'precedente_id', validar: validarPrecedentes },
];
async function lerLigacoes(corpo, ligacoes, req) {
  const r = {};
  for (const l of ligacoes) {
    if (!Object.hasOwn(corpo, l.campo)) continue;
    r[l.campo] = listaIds(corpo[l.campo], l.campo);
    await l.validar(r[l.campo], req);
  }
  return r;
}
// Grava as ligações informadas e devolve as anteriores (para a auditoria).
async function trocarLigacoes(ligacoes, id, novas, req) {
  const antes = {};
  for (const l of ligacoes) {
    if (!novas[l.campo]) continue;
    const filtro = filtroLigacaoVisivel(l, req, l.tabela);
    antes[l.campo] = (await db.query(`SELECT ${l.alvo} AS id FROM ${l.tabela} WHERE ${l.dono}=$1${filtro}`, [id])).map(x => x.id);
    await db.execute(`DELETE FROM ${l.tabela} WHERE ${l.dono}=$1${filtro}`, [id]);
    if (novas[l.campo].length) await db.execute(`INSERT INTO ${l.tabela} (${l.dono}, ${l.alvo}) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`, [id, novas[l.campo]]);
  }
  return antes;
}
// resultado_por_pedido: [{ pedido, resultado, observacao? }], um item por pedido da peça.
function resultadoPorPedido(valor) {
  if (valor === null) return [];
  if (!Array.isArray(valor)) throw invalido('resultado_por_pedido deve ser uma lista de { pedido, resultado }.');
  if (valor.length > 50) throw invalido('resultado_por_pedido: no máximo 50 pedidos.');
  const vistos = new Set();
  return valor.map((item, i) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw invalido(`resultado_por_pedido[${i}] deve ser { pedido, resultado }.`);
    const pedido = texto(item.pedido, `resultado_por_pedido[${i}].pedido`, { obrigatorio: true, max: 200 });
    if (vistos.has(pedido.toLowerCase())) throw invalido(`Pedido repetido em resultado_por_pedido: "${pedido}".`);
    vistos.add(pedido.toLowerCase());
    const resultado = validarEnum(item.resultado, RESULTADOS_PEDIDO, `resultado_por_pedido[${i}].resultado`, true);
    const observacao = texto(item.observacao, `resultado_por_pedido[${i}].observacao`, { max: 1000 });
    return observacao ? { pedido, resultado, observacao } : { pedido, resultado };
  });
}
// Árvore de teses: 'acima' devolve a própria tese e as mães; 'abaixo', a própria e as variantes.
// UNION (e não UNION ALL) encerra a recursão mesmo se um ciclo escapasse da validação.
function linhagem(teseId, sentido) {
  const junta = sentido === 'acima' ? 't.id=a.tese_mae_id' : 't.tese_mae_id=a.id';
  return db.query(`WITH RECURSIVE arvore AS (SELECT id, slug, tese_mae_id FROM teses_acervo WHERE id=$1 UNION SELECT t.id, t.slug, t.tese_mae_id FROM teses_acervo t JOIN arvore a ON ${junta}) SELECT id, slug FROM arvore`, [teseId]);
}

for (const [tipo, tabela, rel, coluna, campos, chave, ligacoesTipo] of [
  ['pecas', 'acervo_pecas', 'acervo_pecas_teses', 'peca_id', CAMPOS_PECA, 'peca', LIGACOES_PECA],
  ['precedentes', 'acervo_precedentes', 'acervo_precedentes_teses', 'precedente_id', CAMPOS_PRECEDENTE, 'precedente', []],
]) {
  acervoRouter.get(`/${tipo}/:id`, async (req, res) => { try {
    if (!uuidValido(req.params.id)) return res.status(400).json({ ok:false, erro:'validacao', mensagem:'ID inválido.' });
    const extras = ligacoesTipo.map(l => `, ARRAY(SELECT lg.${l.alvo} FROM ${l.tabela} lg WHERE lg.${l.dono}=x.id${filtroLigacaoVisivel(l, req, 'lg')}) ${l.campo}`).join('');
    const r = await db.queryOne(`SELECT x.*, ARRAY(SELECT t.slug FROM ${rel} r JOIN teses_acervo t ON t.id=r.tese_id WHERE r.${coluna}=x.id ORDER BY t.label) teses${extras} FROM ${tabela} x WHERE x.id=$1${escopoVisibilidade(req, 'x')}`, [req.params.id]);
    if (!r) return res.status(404).json({ ok:false, erro:'Não encontrado.' });
    res.json({ ok:true, [chave]: r });
  } catch (e) { erro(res, e); } });

  acervoRouter.patch(`/${tipo}/:id`, apenasMaster, async (req, res) => { try {
    if (!uuidValido(req.params.id)) return res.status(400).json({ ok:false, erro:'validacao', mensagem:'ID inválido.' });
    const b = req.body || {};
    const alteracoes = montarAlteracoes(b, campos);
    const teses = Object.hasOwn(b, 'teses') ? normalizarTeses(b.teses) : null;
    if (teses) await validarTeses(teses);
    const ligacoes = await lerLigacoes(b, ligacoesTipo, req);
    // §4.3: a decisão da peça é um precedente do acervo, visível a quem edita.
    if (alteracoes.decisao_id) await validarPrecedentes([alteracoes.decisao_id], req);
    if (alteracoes.orgao_julgador_id) await conferirOrgao(alteracoes.orgao_julgador_id);
    if (!Object.keys(alteracoes).length && !teses && !Object.keys(ligacoes).length) return res.status(422).json({ ok:false, erro:'validacao', mensagem:'Nenhum campo editável informado.' });
    const anterior = await db.queryOne(`SELECT * FROM ${tabela} x WHERE x.id=$1${escopoVisibilidade(req, 'x')}`, [req.params.id]);
    if (!anterior) return res.status(404).json({ ok:false, erro:'Não encontrado.' });
    if (alteracoes.ente === 'municipio-outro-pb' && !(alteracoes.ente_detalhe ?? anterior.ente_detalhe)) return res.status(422).json({ ok:false, erro:'validacao', mensagem:'Informe o município.' });
    const sets = []; const params = [];
    // Objeto/lista (resultado_por_pedido) vai como JSON: o pg converteria array JS em array do Postgres.
    for (const [campo, valor] of Object.entries(alteracoes)) { params.push(valor !== null && typeof valor === 'object' ? JSON.stringify(valor) : valor); sets.push(`${campo}=$${params.length}`); }
    const perdeConferencia = tabela === 'acervo_precedentes' && anterior.conferido
      && CAMPOS_PRECEDENTE_MATERIAIS.some(c => c in alteracoes && comoTexto(alteracoes[c]) !== comoTexto(anterior[c]));
    if (perdeConferencia) sets.push('conferido=false', 'conferido_por=NULL', 'conferido_em=NULL');
    sets.push('atualizado_em=NOW()');
    params.push(req.params.id);
    const tesesAntes = teses ? (await db.query(`SELECT t.slug FROM ${rel} r JOIN teses_acervo t ON t.id=r.tese_id WHERE r.${coluna}=$1 ORDER BY t.slug`, [req.params.id])).map(t => t.slug) : null;
    const [r] = await db.query(`UPDATE ${tabela} SET ${sets.join(', ')} WHERE id=$${params.length} RETURNING *`, params);
    if (teses) await gravarTeses(tabela, r.id, teses);
    const ligacoesAntes = await trocarLigacoes(ligacoesTipo, r.id, ligacoes, req);
    const antes = { ...Object.fromEntries(Object.keys(alteracoes).map(c => [c, anterior[c]])), ...(teses ? { teses: tesesAntes } : {}), ...ligacoesAntes };
    await registrarAuditoria({ usuarioId:req.user.id, acao:'editar', entidade:chave === 'peca' ? 'acervo_peca' : 'acervo_precedente', entidadeId:r.id, valorAntes:antes, valorDepois:{ ...alteracoes, ...(teses ? { teses } : {}), ...ligacoes, ...(perdeConferencia ? { conferido:false } : {}), ...marcaChave(req) }, ip:req._ip });
    res.json({ ok:true, [chave]: { ...r, ...(teses ? { teses } : {}), ...ligacoes }, ...(perdeConferencia ? { aviso:'O conteúdo mudou: o precedente voltou a "não conferido" até nova conferência com fonte primária.' } : {}) });
  } catch (e) { erro(res, e); } });
}

// Catálogo de teses: criar e editar. O slug é a identidade e não muda.
// Desde 23/11/2026 a tese tem tese-mãe (variante → mãe, por slug), situação (ativa, em_risco, suspensa,
// superada; fora de "ativa" exige status_motivo) e a skill que redige a peça (skill_slug).
const COLUNAS_TESE = 't.id, t.slug, t.label, t.drive_folder_id, t.ativo, m.slug AS tese_mae, t.status, t.status_motivo, t.skill_slug';
const lerTese = slug => db.queryOne(`SELECT ${COLUNAS_TESE} FROM teses_acervo t LEFT JOIN teses_acervo m ON m.id=t.tese_mae_id WHERE t.slug=$1`, [String(slug ?? '').trim().toLowerCase()]);
const semId = ({ id, ...resto }) => resto;
const SKILL_RE = /^[a-z0-9]+([:_-][a-z0-9]+)*$/;
const CAMPOS_TESE = {
  label: v => texto(v, 'label', { obrigatorio: true, max: 200 }),
  drive_folder_id: v => texto(v, 'drive_folder_id', { max: 200 }),
  ativo: v => Boolean(v),
  status: v => validarEnum(v, STATUS_TESE, 'status', true),
  status_motivo: v => texto(v, 'status_motivo', { max: 2000 }),
  skill_slug: v => {
    const t = texto(v, 'skill_slug', { max: 120 });
    if (t && !SKILL_RE.test(t)) throw invalido('skill_slug inválido: use o nome da skill (minúsculas, números e hífen; ex.: magisterio-direito-v01).');
    return t;
  },
};
// Tese-mãe por slug. Recusa ciclo: a mãe não pode ser a própria tese nem uma variante dela.
async function resolverTeseMae(valor, teseId = null) {
  if (valor === null || valor === undefined || String(valor).trim() === '') return null;
  const mae = await lerTese(valor);
  if (!mae || !mae.ativo) throw invalido('A tese-mãe não existe no catálogo (ou está inativa).');
  if (teseId && (await linhagem(mae.id, 'acima')).some(t => t.id === teseId)) throw invalido('Ciclo na árvore: a tese-mãe indicada é a própria tese ou uma variante dela.');
  return mae;
}
function conferirStatus(status, motivo) {
  if (status !== 'ativa' && !motivo) throw invalido(`Informe status_motivo: a tese "${status}" precisa dizer por quê (ex.: "Tema 1308 modulado em 26/10/2026").`);
}

acervoRouter.post('/teses', apenasMaster, async (req, res) => { try {
  const b = req.body || {};
  const slug = String(b.slug || '').trim().toLowerCase();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 80) return res.status(422).json({ ok:false, erro:'validacao', mensagem:'slug inválido: use letras minúsculas, números e hífen (até 80).' });
  const label = CAMPOS_TESE.label(b.label);
  const pasta = CAMPOS_TESE.drive_folder_id(b.drive_folder_id);
  const status = CAMPOS_TESE.status(b.status ?? 'ativa');
  const motivo = CAMPOS_TESE.status_motivo(b.status_motivo);
  const skill = CAMPOS_TESE.skill_slug(b.skill_slug);
  conferirStatus(status, motivo);
  const mae = await resolverTeseMae(b.tese_mae);
  const [t] = await db.query('INSERT INTO teses_acervo (slug,label,drive_folder_id,tese_mae_id,status,status_motivo,skill_slug) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (slug) DO NOTHING RETURNING id,slug,label,drive_folder_id,ativo,status,status_motivo,skill_slug', [slug, label, pasta, mae?.id ?? null, status, motivo, skill]);
  if (!t) return res.status(409).json({ ok:false, erro:'validacao', mensagem:'Já existe tese com esse slug.' });
  const tese = { ...semId(t), tese_mae: mae?.slug ?? null };
  await registrarAuditoria({ usuarioId:req.user.id, acao:'criar', entidade:'tese_acervo', entidadeId:t.id, valorDepois:{ ...tese, ...marcaChave(req) }, ip:req._ip });
  res.status(201).json({ ok:true, tese });
} catch (e) { erro(res, e); } });

acervoRouter.patch('/teses/:slug', apenasMaster, async (req, res) => { try {
  const b = req.body || {};
  const colunas = montarAlteracoes(b, CAMPOS_TESE);
  const mudaMae = Object.hasOwn(b, 'tese_mae');
  if (!Object.keys(colunas).length && !mudaMae) return res.status(422).json({ ok:false, erro:'validacao', mensagem:'Nenhum campo editável informado (label, drive_folder_id, ativo, tese_mae, status, status_motivo, skill_slug).' });
  const anterior = await lerTese(req.params.slug);
  if (!anterior) return res.status(404).json({ ok:false, erro:'Tese não encontrada.' });
  if (mudaMae) colunas.tese_mae_id = (await resolverTeseMae(b.tese_mae, anterior.id))?.id ?? null;
  // De volta a "ativa": o motivo explicava a situação anterior e deixa de valer.
  if (colunas.status === 'ativa' && !Object.hasOwn(colunas, 'status_motivo')) colunas.status_motivo = null;
  conferirStatus(colunas.status ?? anterior.status, Object.hasOwn(colunas, 'status_motivo') ? colunas.status_motivo : anterior.status_motivo);
  const sets = []; const params = [];
  for (const [campo, valor] of Object.entries(colunas)) { params.push(valor); sets.push(`${campo}=$${params.length}`); }
  sets.push('atualizado_em=NOW()');
  params.push(anterior.id);
  await db.execute(`UPDATE teses_acervo SET ${sets.join(', ')} WHERE id=$${params.length}`, params);
  const tese = semId(await lerTese(anterior.slug));
  await registrarAuditoria({ usuarioId:req.user.id, acao:'editar', entidade:'tese_acervo', entidadeId:anterior.id, valorAntes:semId(anterior), valorDepois:{ ...tese, ...marcaChave(req) }, ip:req._ip });
  // Mudou a situação (ex.: ativa → em risco): aviso por WhatsApp a quem mudou, com o alcance no acervo.
  let aviso = null;
  if (colunas.status && colunas.status !== anterior.status) {
    try {
      const consideradas = await tesesComVariantes([anterior.id]);
      const imp = await calcularImpacto(req, consideradas.map(t => t.id));
      aviso = await enfileirarAviso(db, { tipo: 'acervo_tese', chaveEvento: `tese:${anterior.id}:${tese.status}:${Date.now()}`, usuarioId: req.user.id,
        texto: montarAvisoTese({ label: tese.label, slug: tese.slug, de: anterior.status, para: tese.status, motivo: tese.status_motivo, totalPecas: imp.total_pecas, totalProcessos: imp.total_processos }) });
      if (aviso) despacharEmSeguida(['acervo_tese']);
    } catch (e) { console.warn('[AvisosAcervo] Não foi possível enfileirar o aviso da tese:', e.message); }
  }
  res.json({ ok:true, tese, ...(aviso ? { aviso_whatsapp: 'enfileirado' } : {}) });
} catch (e) { erro(res, e); } });

// ── Argumentos (§4.2): fundamento | defesa_fazenda | resposta | preliminar | calculo ─────────
// A resposta aponta (responde_a_id) para a defesa da Fazenda que rebate, da mesma tese ou de uma
// tese-mãe. É o mapa de objeções: cada defesa tem uma ou mais respostas.
const CAMPOS_ARGUMENTO = {
  tipo: v => validarEnum(v, TIPOS_ARGUMENTO, 'tipo', true),
  titulo: v => texto(v, 'titulo', { obrigatorio: true, max: 300 }),
  texto_modelo: v => texto(v, 'texto_modelo', { max: 50_000 }),
  status: v => validarEnum(v, STATUS_ARGUMENTO, 'status', true),
  observacoes: v => texto(v, 'observacoes', { max: 5_000 }),
};
const ORDEM_TIPO_ARGUMENTO = `CASE g.tipo WHEN 'fundamento' THEN 1 WHEN 'preliminar' THEN 2 WHEN 'defesa_fazenda' THEN 3 WHEN 'resposta' THEN 4 ELSE 5 END`;
const selectArgumento = req => `SELECT g.*, t.slug AS tese, ARRAY(SELECT ap.precedente_id FROM acervo_argumentos_precedentes ap WHERE ap.argumento_id=g.id${filtroLigacaoVisivel(LIGACOES_ARGUMENTO[0], req, 'ap')}) precedentes FROM acervo_argumentos g JOIN teses_acervo t ON t.id=g.tese_id`;
async function teseDoArgumento(slug) {
  if (!String(slug ?? '').trim()) throw invalido('Informe a tese (slug do catálogo, ver GET /teses).');
  const t = await lerTese(slug);
  if (!t || !t.ativo) throw invalido('A tese não existe no catálogo (ou está inativa).');
  return t;
}
async function conferirRespondeA(respondeAId, { tipo, teseId, argumentoId = null }) {
  if (!respondeAId) return;
  if (tipo !== 'resposta') throw invalido('Só argumento do tipo "resposta" aponta para a defesa que rebate (responde_a_id); envie responde_a_id: null.');
  if (!uuidValido(String(respondeAId))) throw invalido('responde_a_id inválido.');
  if (respondeAId === argumentoId) throw invalido('Um argumento não responde a si mesmo.');
  const alvo = await db.queryOne('SELECT id, tipo, tese_id FROM acervo_argumentos WHERE id=$1', [respondeAId]);
  if (!alvo) throw invalido('A defesa indicada em responde_a_id não existe.');
  if (alvo.tipo !== 'defesa_fazenda') throw invalido('responde_a_id deve apontar para um argumento do tipo "defesa_fazenda".');
  if (!(await linhagem(teseId, 'acima')).some(t => t.id === alvo.tese_id)) throw invalido('A defesa rebatida deve ser da mesma tese da resposta ou de uma tese-mãe dela.');
}

// GET /argumentos?tese=&incluir_maes=true&tipo=&status=&responde_a=&q= — sem status, o abandonado fica de fora.
acervoRouter.get('/argumentos', async (req, res) => { try {
  const { tese, tipo, status, responde_a } = req.query;
  const q = String(req.query.q ?? '').trim();
  const limite = page(req.query.limite, 100); const offset = (page(req.query.page) - 1) * limite;
  const params = []; const where = [];
  if (tese) {
    const t = await lerTese(tese);
    if (!t) return res.status(404).json({ ok:false, erro:'Tese não encontrada.' });
    const ids = req.query.incluir_maes === 'true' ? (await linhagem(t.id, 'acima')).map(x => x.id) : [t.id];
    params.push(ids); where.push(`g.tese_id = ANY($${params.length}::uuid[])`);
  }
  if (tipo) { params.push(validarEnum(tipo, TIPOS_ARGUMENTO, 'tipo')); where.push(`g.tipo=$${params.length}`); }
  if (status) { params.push(validarEnum(status, STATUS_ARGUMENTO, 'status')); where.push(`g.status=$${params.length}`); }
  else where.push(`g.status <> 'abandonado'`);
  if (responde_a) {
    if (!uuidValido(responde_a)) return res.status(400).json({ ok:false, erro:'validacao', mensagem:'responde_a inválido.' });
    params.push(responde_a); where.push(`g.responde_a_id=$${params.length}`);
  }
  if (q) { params.push(`%${q}%`); const n = params.length; where.push(`(g.titulo ILIKE $${n} OR COALESCE(g.texto_modelo,'') ILIKE $${n} OR COALESCE(g.observacoes,'') ILIKE $${n})`); }
  const argumentos = await db.query(`${selectArgumento(req)} WHERE ${where.join(' AND ')} ORDER BY t.label, ${ORDEM_TIPO_ARGUMENTO}, g.titulo LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limite, offset]);
  res.json({ ok:true, argumentos });
} catch (e) { erro(res, e); } });

acervoRouter.get('/argumentos/:id', async (req, res) => { try {
  if (!uuidValido(req.params.id)) return res.status(400).json({ ok:false, erro:'validacao', mensagem:'ID inválido.' });
  const g = await db.queryOne(`${selectArgumento(req)} WHERE g.id=$1`, [req.params.id]);
  if (!g) return res.status(404).json({ ok:false, erro:'Argumento não encontrado.' });
  const [precedentes, respostas, respondeA, uso] = await Promise.all([
    g.precedentes.length ? db.query('SELECT p.id, p.processo_numero, p.orgao, p.tribunal, p.data_julgamento, p.ratio, p.vinculante, p.favoravel, p.conferido, p.fonte_primaria_url, p.arquivada_em FROM acervo_precedentes p WHERE p.id = ANY($1::uuid[]) ORDER BY p.vinculante DESC, p.data_julgamento DESC', [g.precedentes]) : [],
    g.tipo === 'defesa_fazenda' ? db.query('SELECT r.id, r.titulo, r.status, t.slug AS tese FROM acervo_argumentos r JOIN teses_acervo t ON t.id=r.tese_id WHERE r.responde_a_id=$1 ORDER BY r.status, r.titulo', [g.id]) : [],
    g.responde_a_id ? db.queryOne('SELECT id, titulo, status FROM acervo_argumentos WHERE id=$1', [g.responde_a_id]) : null,
    db.queryOne(`SELECT COUNT(*)::int AS n FROM acervo_pecas_argumentos pa JOIN acervo_pecas a ON a.id=pa.peca_id WHERE pa.argumento_id=$1 AND a.arquivada_em IS NULL${escopoVisibilidade(req)}`, [g.id]),
  ]);
  res.json({ ok:true, argumento: { ...g, precedentes_detalhe: precedentes, responde_a: respondeA, respostas, pecas_que_usam: uso?.n ?? 0 } });
} catch (e) { erro(res, e); } });

acervoRouter.post('/argumentos', apenasMaster, async (req, res) => { try {
  const b = req.body || {};
  const tese = await teseDoArgumento(b.tese);
  const c = montarAlteracoes(b, CAMPOS_ARGUMENTO);
  c.tipo = CAMPOS_ARGUMENTO.tipo(b.tipo);
  c.titulo = CAMPOS_ARGUMENTO.titulo(b.titulo);
  c.status ??= 'em_teste';
  const respondeA = b.responde_a_id ? String(b.responde_a_id).toLowerCase() : null;
  await conferirRespondeA(respondeA, { tipo: c.tipo, teseId: tese.id });
  const ligacoes = await lerLigacoes(b, LIGACOES_ARGUMENTO, req);
  const [novo] = await db.query('INSERT INTO acervo_argumentos (tese_id,tipo,titulo,responde_a_id,texto_modelo,status,observacoes,criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id', [tese.id, c.tipo, c.titulo, respondeA, c.texto_modelo ?? null, c.status, c.observacoes ?? null, req.user.id]);
  await trocarLigacoes(LIGACOES_ARGUMENTO, novo.id, ligacoes, req);
  await registrarAuditoria({ usuarioId:req.user.id, acao:'criar', entidade:'acervo_argumento', entidadeId:novo.id, valorDepois:{ tese:tese.slug, tipo:c.tipo, titulo:c.titulo, status:c.status, responde_a_id:respondeA, ...ligacoes, ...marcaChave(req) }, ip:req._ip });
  res.status(201).json({ ok:true, argumento: await db.queryOne(`${selectArgumento(req)} WHERE g.id=$1`, [novo.id]) });
} catch (e) { erro(res, e); } });

acervoRouter.patch('/argumentos/:id', apenasMaster, async (req, res) => { try {
  if (!uuidValido(req.params.id)) return res.status(400).json({ ok:false, erro:'validacao', mensagem:'ID inválido.' });
  const b = req.body || {};
  const colunas = montarAlteracoes(b, CAMPOS_ARGUMENTO);
  const ligacoes = await lerLigacoes(b, LIGACOES_ARGUMENTO, req);
  const mudaTese = Object.hasOwn(b, 'tese'); const mudaResposta = Object.hasOwn(b, 'responde_a_id');
  if (!Object.keys(colunas).length && !Object.keys(ligacoes).length && !mudaTese && !mudaResposta) return res.status(422).json({ ok:false, erro:'validacao', mensagem:'Nenhum campo editável informado (tese, tipo, titulo, responde_a_id, texto_modelo, status, observacoes, precedentes).' });
  const anterior = await db.queryOne('SELECT g.*, t.slug AS tese FROM acervo_argumentos g JOIN teses_acervo t ON t.id=g.tese_id WHERE g.id=$1', [req.params.id]);
  if (!anterior) return res.status(404).json({ ok:false, erro:'Argumento não encontrado.' });
  let tese = { id: anterior.tese_id, slug: anterior.tese };
  if (mudaTese) { tese = await teseDoArgumento(b.tese); if (tese.id !== anterior.tese_id) colunas.tese_id = tese.id; }
  if (mudaResposta) colunas.responde_a_id = b.responde_a_id ? String(b.responde_a_id).toLowerCase() : null;
  if (['tipo', 'tese_id', 'responde_a_id'].some(c => Object.hasOwn(colunas, c))) {
    const tipo = colunas.tipo ?? anterior.tipo;
    await conferirRespondeA(Object.hasOwn(colunas, 'responde_a_id') ? colunas.responde_a_id : anterior.responde_a_id, { tipo, teseId: tese.id, argumentoId: anterior.id });
    // Defesa com respostas ligadas não muda de tipo nem de tese: as respostas ficariam soltas.
    if (anterior.tipo === 'defesa_fazenda' && (tipo !== 'defesa_fazenda' || colunas.tese_id)) {
      const ligadas = await db.queryOne('SELECT COUNT(*)::int AS n FROM acervo_argumentos WHERE responde_a_id=$1', [anterior.id]);
      if (ligadas?.n) throw invalido(`Esta defesa tem ${ligadas.n} resposta(s) ligada(s): mude ou desligue as respostas antes de trocar o tipo ou a tese.`);
    }
  }
  const sets = []; const params = [];
  for (const [campo, valor] of Object.entries(colunas)) { params.push(valor); sets.push(`${campo}=$${params.length}`); }
  sets.push('atualizado_em=NOW()');
  params.push(anterior.id);
  await db.execute(`UPDATE acervo_argumentos SET ${sets.join(', ')} WHERE id=$${params.length}`, params);
  const ligacoesAntes = await trocarLigacoes(LIGACOES_ARGUMENTO, anterior.id, ligacoes, req);
  // Na auditoria a tese aparece pelo slug, não pelo id.
  const legivel = (campo, valor) => (campo === 'tese_id' ? ['tese', valor] : [campo, valor]);
  const antes = Object.fromEntries(Object.keys(colunas).map(c => legivel(c, c === 'tese_id' ? anterior.tese : anterior[c])));
  const depois = Object.fromEntries(Object.entries(colunas).map(([c, v]) => legivel(c, c === 'tese_id' ? tese.slug : v)));
  await registrarAuditoria({ usuarioId:req.user.id, acao:'editar', entidade:'acervo_argumento', entidadeId:anterior.id, valorAntes:{ ...antes, ...ligacoesAntes }, valorDepois:{ ...depois, ...ligacoes, ...marcaChave(req) }, ip:req._ip });
  res.json({ ok:true, argumento: await db.queryOne(`${selectArgumento(req)} WHERE g.id=$1`, [anterior.id]) });
} catch (e) { erro(res, e); } });

// ── Impacto (§2 e §7): GET /impacto?tese=slug[&variantes=false][&protocolo_desde=&protocolo_ate=][&ente=] ──
// Peças e processos de uma tese e das variantes dela, para saber o que revisar quando a tese muda de
// situação. Ex.: Tema 1308 modulado → peças de piso protocoladas depois de 16/04/2026. Só leitura.
const LIMITE_IMPACTO = 1000;
// Peças (não arquivadas, visíveis) de um conjunto de teses e os processos delas. Usada pelo /impacto e
// pela vigilância jurisprudencial (§4.5), que devolve o impacto quando a situação de um tema muda.
async function calcularImpacto(req, teseIds, { desde = null, ate = null, ente = null, precedenteId = null } = {}) {
  const params = [teseIds];
  const porTese = 'EXISTS (SELECT 1 FROM acervo_pecas_teses apt WHERE apt.peca_id=a.id AND apt.tese_id = ANY($1::uuid[]))';
  // Com precedente (§7): além das peças das teses dele, as que o citam ou cuja decisão é ele.
  let cita = 'false';
  if (precedenteId) { params.push(precedenteId); cita = `(a.decisao_id=$${params.length} OR EXISTS (SELECT 1 FROM acervo_pecas_precedentes pp WHERE pp.peca_id=a.id AND pp.precedente_id=$${params.length}))`; }
  const where = ['a.arquivada_em IS NULL', precedenteId ? `(${porTese} OR ${cita})` : porTese];
  if (desde) { params.push(desde); where.push(`a.data_protocolo >= $${params.length}`); }
  if (ate) { params.push(ate); where.push(`a.data_protocolo <= $${params.length}`); }
  if (ente) { params.push(ente); where.push(`a.ente=$${params.length}`); }
  const pecas = await db.query(`SELECT a.id, a.titulo, a.tipo_peca, a.processo_id, a.processo_numero, a.cliente_nome, a.ente, a.ente_detalhe, a.tribunal, a.instancia, a.orgao_julgador, a.data_protocolo, a.resultado, a.data_decisao, a.resultado_por_pedido, a.drive_url,${precedenteId ? ` COALESCE(${cita}, false) AS cita_precedente,` : ''}
      ARRAY(SELECT t.slug FROM acervo_pecas_teses apt JOIN teses_acervo t ON t.id=apt.tese_id WHERE apt.peca_id=a.id ORDER BY t.label) teses
    FROM acervo_pecas a WHERE ${where.join(' AND ')}${escopoVisibilidade(req)} ORDER BY a.data_protocolo DESC NULLS LAST, a.criado_em DESC LIMIT ${LIMITE_IMPACTO + 1}`, params);
  const truncado = pecas.length > LIMITE_IMPACTO;
  if (truncado) pecas.length = LIMITE_IMPACTO;
  const idsProcesso = [...new Set(pecas.map(p => p.processo_id).filter(Boolean))];
  const noAm = idsProcesso.length ? await db.query(`SELECT p.id, p.numero, p.status, p.grau, p.tribunal, p.vara, c.nome AS cliente_nome FROM processos p LEFT JOIN clientes c ON c.id=p.cliente_id WHERE p.id = ANY($1::uuid[])${podeVerRestrito(req) ? '' : " AND p.visibilidade = 'normal'"}`, [idsProcesso]) : [];
  const porId = new Map(noAm.map(p => [p.id, p]));
  // Um item por processo: o cadastro do AM quando a peça está ligada a ele; senão, o número gravado na peça.
  const processos = new Map();
  for (const pc of pecas) {
    const p = porId.get(pc.processo_id);
    const digitos = String(pc.processo_numero || '').replace(/\D/g, '');
    const chave = p ? p.id : digitos ? `cnj:${digitos}` : null;
    if (!chave) continue;
    if (!processos.has(chave)) processos.set(chave, p
      ? { processo_id: p.id, numero: p.numero, cliente_nome: p.cliente_nome, status: p.status, grau: p.grau, tribunal: p.tribunal, vara: p.vara, vinculado: true, pecas: [] }
      : { processo_id: null, numero: pc.processo_numero, cliente_nome: pc.cliente_nome, vinculado: false, pecas: [] });
    processos.get(chave).pecas.push(pc.id);
  }
  return { total_pecas: pecas.length, total_processos: processos.size, truncado, pecas, processos: [...processos.values()] };
}
// As teses informadas e todas as variantes delas, sem repetição.
async function tesesComVariantes(teseIds) {
  const todas = new Map();
  for (const id of teseIds) for (const t of await linhagem(id, 'abaixo')) todas.set(t.id, t);
  return [...todas.values()];
}

// Itens vigiados ativos que tocam um conjunto de teses.
const vigilanciaDasTeses = teseIds => db.query(`SELECT DISTINCT v.id, v.referencia, v.ultima_situacao, v.verificado_em FROM acervo_vigilancia v JOIN acervo_vigilancia_teses vt ON vt.vigilancia_id=v.id WHERE v.ativo=true AND vt.tese_id = ANY($1::uuid[]) ORDER BY v.referencia`, [teseIds]);
// Origem do impacto: uma (e só uma) entre tese=slug, precedente=id (§7, "impacto_precedente") e vigilancia=id.
acervoRouter.get('/impacto', apenasMaster, async (req, res) => { try {
  const origens = ['tese', 'precedente', 'vigilancia'].filter(k => String(req.query[k] ?? '').trim());
  if (origens.length !== 1) return res.status(422).json({ ok:false, erro:'validacao', mensagem:'Informe uma origem: /impacto?tese=slug, ?precedente=id ou ?vigilancia=id.' });
  const filtros = {
    desde: dataOuNulo(req.query.protocolo_desde, 'protocolo_desde'),
    ate: dataOuNulo(req.query.protocolo_ate, 'protocolo_ate'),
    ente: req.query.ente ? validarEnum(req.query.ente, ENTES, 'ente') : null,
  };
  const comVariantes = async ids => (req.query.variantes === 'false'
    ? (ids.length ? await db.query('SELECT id, slug FROM teses_acervo WHERE id = ANY($1::uuid[])', [ids]) : [])
    : tesesComVariantes(ids));
  if (origens[0] === 'tese') {
    const tese = await lerTese(req.query.tese);
    if (!tese) return res.status(404).json({ ok:false, erro:'Tese não encontrada.' });
    const teses = await comVariantes([tese.id]);
    const impacto = await calcularImpacto(req, teses.map(t => t.id), filtros);
    return res.json({ ok:true, tese: semId(tese), teses_consideradas: teses.map(t => t.slug), vigilancia: await vigilanciaDasTeses(teses.map(t => t.id)), ...impacto });
  }
  const id = String(req.query[origens[0]]).trim();
  if (!uuidValido(id)) return res.status(400).json({ ok:false, erro:'validacao', mensagem:'ID inválido.' });
  if (origens[0] === 'precedente') {
    const precedente = await db.queryOne(`SELECT p.id, p.processo_numero, p.orgao, p.tribunal, p.instancia, p.data_julgamento, p.resultado, p.favoravel, p.vinculante, p.conferido, p.ratio, p.fonte_primaria_url,
        ARRAY(SELECT apt.tese_id FROM acervo_precedentes_teses apt WHERE apt.precedente_id=p.id) tese_ids
      FROM acervo_precedentes p WHERE p.id=$1 AND p.arquivada_em IS NULL${escopoVisibilidade(req, 'p')}`, [id]);
    if (!precedente) return res.status(404).json({ ok:false, erro:'Precedente não encontrado.' });
    const { tese_ids, ...dados } = precedente;
    const teses = await comVariantes(tese_ids);
    const impacto = await calcularImpacto(req, teses.map(t => t.id), { ...filtros, precedenteId: precedente.id });
    return res.json({ ok:true, precedente: dados, teses_consideradas: teses.map(t => t.slug), vigilancia: await vigilanciaDasTeses(teses.map(t => t.id)), ...impacto,
      citam_precedente: impacto.pecas.filter(p => p.cita_precedente).length });
  }
  const item = await db.queryOne(`SELECT v.id, v.referencia, v.descricao, v.ultima_situacao, v.verificado_em, v.url_fonte, v.impacto AS impacto_esperado, v.ativo,
      ARRAY(SELECT vt.tese_id FROM acervo_vigilancia_teses vt WHERE vt.vigilancia_id=v.id) tese_ids
    FROM acervo_vigilancia v WHERE v.id=$1`, [id]);
  if (!item) return res.status(404).json({ ok:false, erro:'Item de vigilância não encontrado.' });
  const { tese_ids, ...vigiado } = item;
  const teses = await comVariantes(tese_ids);
  res.json({ ok:true, vigilancia: vigiado, teses_consideradas: teses.map(t => t.slug), ...(await calcularImpacto(req, teses.map(t => t.id), filtros)) });
} catch (e) { erro(res, e); } });

// ── Vigilância jurisprudencial (§4.5) ─────────────────────────────────────────────────────
// Temas com repercussão geral pendentes, PUILs, ADIs e julgamentos que podem mudar teses do escritório.
// Cada verificação grava a situação no histórico; se a situação mudou, a resposta já traz as peças e os
// processos das teses afetadas (com as variantes), para o advogado decidir o que revisar.
const CAMPOS_VIGILANCIA = {
  referencia: v => texto(v, 'referencia', { obrigatorio: true, max: 200 }),
  descricao: v => texto(v, 'descricao', { max: 2000 }),
  url_fonte: v => urlHttps(v, 'url_fonte'),
  impacto: v => texto(v, 'impacto', { max: 5000 }),
  ativo: v => Boolean(v),
};
const selectVigilancia = `SELECT v.*, ARRAY(SELECT t.slug FROM acervo_vigilancia_teses vt JOIN teses_acervo t ON t.id=vt.tese_id WHERE vt.vigilancia_id=v.id ORDER BY t.slug) teses FROM acervo_vigilancia v`;
async function tesesDaVigilancia(valor) {
  const slugs = normalizarTeses(valor);
  const rows = await db.query('SELECT id, slug FROM teses_acervo WHERE ativo=true AND slug = ANY($1::text[])', [slugs]);
  if (rows.length !== slugs.length) throw invalido('Uma ou mais teses não existem no catálogo (ou estão inativas).');
  return rows;
}
async function gravarTesesVigilancia(id, teses) {
  await db.execute('DELETE FROM acervo_vigilancia_teses WHERE vigilancia_id=$1', [id]);
  await db.execute('INSERT INTO acervo_vigilancia_teses (vigilancia_id, tese_id) SELECT $1, unnest($2::uuid[])', [id, teses.map(t => t.id)]);
}
// §5.4: quando um item vigiado muda, tarefa para o Master (quem registrou a verificação; pela chave, o
// Master dono dela) com a nova situação e os processos afetados. Não altera peça nem processo.
const MAX_PROCESSOS_TAREFA = 60;
async function tarefaVigilancia(req, item, anterior, nova, impacto) {
  const n = (x, um, varios) => `${x} ${x === 1 ? um : varios}`;
  const linhas = impacto.processos.slice(0, MAX_PROCESSOS_TAREFA)
    .map(p => `- ${p.numero || 'sem número'} — ${p.cliente_nome || 'sem cliente'}${p.vinculado ? '' : ' (fora do cadastro de processos)'} — ${n(p.pecas.length, 'peça', 'peças')}`);
  if (impacto.processos.length > MAX_PROCESSOS_TAREFA) linhas.push(`- e mais ${impacto.processos.length - MAX_PROCESSOS_TAREFA} (lista completa: Acervo → impacto da vigilância)`);
  const instrucao = [
    `Nova situação: ${nova}`,
    `Situação anterior: ${anterior}`,
    `Teses consideradas: ${impacto.teses_consideradas.join(', ') || '—'}`,
    impacto.processos.length ? `Processos afetados (${impacto.processos.length}):\n${linhas.join('\n')}` : 'Nenhuma peça do acervo ligada a essas teses.',
    'Revise cada processo e decida o que fazer (petição, distinção, acompanhamento). A decisão sobre cada ação é do advogado.',
  ].join('\n\n');
  const prazo = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  return db.queryOne(`INSERT INTO tarefas (tipo, descricao, instrucao, atribuido_a, validado_por, urgencia, prazo_data) VALUES ('geral',$1,$2,$3,$3,$4,$5::date) RETURNING id, descricao, urgencia, prazo_data, status`,
    [`Vigilância: ${item.referencia} mudou — revisar ${n(impacto.total_pecas, 'peça', 'peças')} em ${n(impacto.total_processos, 'processo', 'processos')}`,
      instrucao, req.user.id, impacto.total_pecas ? 'ALTO' : 'MEDIO', prazo]);
}
// Registra uma verificação. Devolve se a situação mudou em relação à anterior. A primeira situação
// registrada (sem anterior) não é mudança: só passa a ser acompanhada.
async function registrarVerificacao(id, anterior, nova, req) {
  const mudou = Boolean(anterior) && anterior !== (nova ?? '');
  await db.execute('INSERT INTO acervo_vigilancia_historico (vigilancia_id, situacao_anterior, situacao_nova, mudou, registrado_por) VALUES ($1,$2,$3,$4,$5)', [id, anterior ?? null, nova, mudou, req.user.id]);
  return mudou;
}

acervoRouter.get('/vigilancia', async (req, res) => { try {
  const params = []; const where = [];
  if (req.query.ativo !== 'todos') where.push(req.query.ativo === 'false' ? 'v.ativo=false' : 'v.ativo=true');
  if (req.query.tese) {
    const t = await lerTese(req.query.tese);
    if (!t) return res.status(404).json({ ok:false, erro:'Tese não encontrada.' });
    // Vigilância da própria tese ou de uma tese-mãe dela também alcança a variante.
    params.push((await linhagem(t.id, 'acima')).map(x => x.id));
    where.push(`EXISTS (SELECT 1 FROM acervo_vigilancia_teses vt WHERE vt.vigilancia_id=v.id AND vt.tese_id = ANY($${params.length}::uuid[]))`);
  }
  const vigilancia = await db.query(`${selectVigilancia}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY v.verificado_em ASC NULLS FIRST, v.referencia`, params);
  res.json({ ok:true, vigilancia });
} catch (e) { erro(res, e); } });

acervoRouter.get('/vigilancia/:id', async (req, res) => { try {
  if (!uuidValido(req.params.id)) return res.status(400).json({ ok:false, erro:'validacao', mensagem:'ID inválido.' });
  const v = await db.queryOne(`${selectVigilancia} WHERE v.id=$1`, [req.params.id]);
  if (!v) return res.status(404).json({ ok:false, erro:'Item de vigilância não encontrado.' });
  const historico = await db.query('SELECT situacao_anterior, situacao_nova, mudou, registrado_em FROM acervo_vigilancia_historico WHERE vigilancia_id=$1 ORDER BY registrado_em DESC LIMIT 20', [v.id]);
  res.json({ ok:true, vigilancia: { ...v, historico } });
} catch (e) { erro(res, e); } });

acervoRouter.post('/vigilancia', apenasMaster, async (req, res) => { try {
  const b = req.body || {};
  const c = montarAlteracoes(b, CAMPOS_VIGILANCIA);
  c.referencia = CAMPOS_VIGILANCIA.referencia(b.referencia);
  const teses = await tesesDaVigilancia(b.teses);
  const situacao = texto(b.ultima_situacao, 'ultima_situacao', { max: 2000 });
  const [v] = await db.query(`INSERT INTO acervo_vigilancia (referencia, descricao, url_fonte, ultima_situacao, verificado_em, impacto, ativo, criado_por)
    VALUES ($1,$2,$3,$4,${situacao ? 'NOW()' : 'NULL'},$5,$6,$7) ON CONFLICT (referencia) DO NOTHING RETURNING id`,
    [c.referencia, c.descricao ?? null, c.url_fonte ?? null, situacao, c.impacto ?? null, c.ativo ?? true, req.user.id]);
  if (!v) return res.status(409).json({ ok:false, erro:'validacao', mensagem:'Já existe item de vigilância com essa referência.' });
  await gravarTesesVigilancia(v.id, teses);
  if (situacao) await registrarVerificacao(v.id, null, situacao, req);
  await registrarAuditoria({ usuarioId:req.user.id, acao:'criar', entidade:'acervo_vigilancia', entidadeId:v.id, valorDepois:{ ...c, teses: teses.map(t => t.slug), ultima_situacao: situacao, ...marcaChave(req) }, ip:req._ip });
  res.status(201).json({ ok:true, vigilancia: await db.queryOne(`${selectVigilancia} WHERE v.id=$1`, [v.id]) });
} catch (e) { erro(res, e); } });

// PATCH /vigilancia/:id — campos, teses e/ou ultima_situacao. Enviar ultima_situacao é registrar uma
// verificação (mesmo que repetida): atualiza verificado_em e grava o histórico. Se mudou, a resposta traz
// o impacto nas peças e processos das teses vigiadas.
acervoRouter.patch('/vigilancia/:id', apenasMaster, async (req, res) => { try {
  if (!uuidValido(req.params.id)) return res.status(400).json({ ok:false, erro:'validacao', mensagem:'ID inválido.' });
  const b = req.body || {};
  const colunas = montarAlteracoes(b, CAMPOS_VIGILANCIA);
  const teses = Object.hasOwn(b, 'teses') ? await tesesDaVigilancia(b.teses) : null;
  const verifica = Object.hasOwn(b, 'ultima_situacao');
  const situacao = verifica ? texto(b.ultima_situacao, 'ultima_situacao', { obrigatorio: true, max: 2000 }) : null;
  if (!Object.keys(colunas).length && !teses && !verifica) return res.status(422).json({ ok:false, erro:'validacao', mensagem:'Nenhum campo editável informado (referencia, descricao, url_fonte, impacto, ativo, teses, ultima_situacao).' });
  const anterior = await db.queryOne(`${selectVigilancia} WHERE v.id=$1`, [req.params.id]);
  if (!anterior) return res.status(404).json({ ok:false, erro:'Item de vigilância não encontrado.' });
  const sets = []; const params = [];
  for (const [campo, valor] of Object.entries(colunas)) { params.push(valor); sets.push(`${campo}=$${params.length}`); }
  if (verifica) { params.push(situacao); sets.push(`ultima_situacao=$${params.length}`, 'verificado_em=NOW()'); }
  sets.push('atualizado_em=NOW()');
  params.push(anterior.id);
  try {
    await db.execute(`UPDATE acervo_vigilancia SET ${sets.join(', ')} WHERE id=$${params.length}`, params);
  } catch (e) {
    if (e.code === '23505') throw invalido('Já existe item de vigilância com essa referência.');
    throw e;
  }
  if (teses) await gravarTesesVigilancia(anterior.id, teses);
  const mudou = verifica ? await registrarVerificacao(anterior.id, anterior.ultima_situacao, situacao, req) : false;
  const antes = Object.fromEntries([...Object.keys(colunas), ...(teses ? ['teses'] : []), ...(verifica ? ['ultima_situacao'] : [])].map(c => [c, anterior[c]]));
  const depois = { ...colunas, ...(teses ? { teses: teses.map(t => t.slug) } : {}), ...(verifica ? { ultima_situacao: situacao, mudou } : {}) };
  const vigilancia = await db.queryOne(`${selectVigilancia} WHERE v.id=$1`, [anterior.id]);
  let impacto; let tarefa = null;
  if (mudou) {
    const ids = (await db.query('SELECT tese_id FROM acervo_vigilancia_teses WHERE vigilancia_id=$1', [anterior.id])).map(r => r.tese_id);
    const consideradas = await tesesComVariantes(ids);
    impacto = { teses_consideradas: consideradas.map(t => t.slug), ...(await calcularImpacto(req, consideradas.map(t => t.id))) };
    if (b.criar_tarefa !== false) tarefa = await tarefaVigilancia(req, vigilancia, anterior.ultima_situacao, situacao, impacto);
  }
  // Aviso por WhatsApp ao Master da tarefa (spec dos avisos do acervo). Falha aqui não desfaz a verificação.
  let aviso = null;
  if (tarefa) {
    try {
      aviso = await enfileirarAviso(db, { tipo: 'acervo_vigilancia', chaveEvento: `vigilancia:${anterior.id}:${tarefa.id}`, usuarioId: req.user.id, tarefaId: tarefa.id,
        texto: montarAvisoVigilancia({ referencia: vigilancia.referencia, situacao, totalPecas: impacto.total_pecas, totalProcessos: impacto.total_processos, teses: impacto.teses_consideradas }) });
      if (aviso) despacharEmSeguida(['acervo_vigilancia']);
    } catch (e) { console.warn('[AvisosAcervo] Não foi possível enfileirar o aviso da vigilância:', e.message); }
  }
  await registrarAuditoria({ usuarioId:req.user.id, acao: mudou ? 'vigilancia_mudou' : 'editar', entidade:'acervo_vigilancia', entidadeId:anterior.id, valorAntes:antes, valorDepois:{ ...depois, ...(tarefa ? { tarefa_id: tarefa.id } : {}), ...marcaChave(req) }, ip:req._ip });
  res.json({ ok:true, vigilancia, ...(verifica ? { mudou } : {}), ...(impacto ? { impacto, ...(tarefa ? { tarefa } : {}), ...(aviso ? { aviso_whatsapp: 'enfileirado' } : {}), aviso:`A situação mudou: revise as peças e os processos listados em "impacto"${tarefa ? ' (tarefa criada para o Master)' : ''}. A decisão sobre cada ação é do advogado.` } : {}) });
} catch (e) { erro(res, e); } });

// ── Retroalimentação do resultado (§5.1): POST /pecas/:id/decisao ──────────────────────────
// Usada pela varredura do PJe (rotina das 15h) quando aparece sentença ou acórdão depois da peça. Numa
// transação: grava a data da decisão; com `resultado` (caso inequívoco) grava o resultado, sem ele deixa a
// peça "pendente" com o resultado por pedido "a-confirmar"; cria a decisão como precedente NÃO conferido
// (com o link do documento) e liga em decisao_id; e cria uma tarefa para o Master conferir. Só peça pendente.
const TIPOS_PRIMEIRO_GRAU = new Set(['inicial','emenda-inicial','impugnacao-contestacao','especificacao-provas','memorial']);
// Registra a decisão de uma peça (usada pela rota e pelas decisões lidas nas publicações do Diário).
// `fonte`: de onde a decisão foi lida ('PJe' ou 'Diário'). Devolve { status, body }; validação lança 422.
export const TIPOS_DECISAO = new Set(['Sentença', 'Acórdão', 'Decisão']);
export async function registrarDecisao(req, pecaId, dados, { fonte = 'PJe' } = {}) {
  if (!uuidValido(pecaId)) return { status: 400, body: { ok:false, erro:'validacao', mensagem:'ID inválido.' } };
  const b = dados || {};
  const data = dataOuNulo(b.data_decisao, 'data_decisao');
  if (!data) throw invalido('Informe data_decisao (AAAA-MM-DD).');
  const evidencia = texto(b.evidencia, 'evidencia', { obrigatorio: true, max: 1000 });
  const resultado = b.resultado ? validarEnum(b.resultado, RESULTADOS, 'resultado') : null;
  if (resultado === 'pendente') throw invalido('resultado "pendente" não é decisão; omita o campo para deixar a confirmar.');
  const documento = urlHttps(b.documento_url, 'documento_url');
  const instancia = b.instancia ? validarEnum(b.instancia, INSTANCIAS, 'instancia') : null;
  const orgaoInformado = texto(b.orgao, 'orgao', { max: 300 });
  const criarTarefa = b.criar_tarefa !== false;
  if (b.tipo_decisao && !TIPOS_DECISAO.has(b.tipo_decisao)) throw invalido('tipo_decisao deve ser Sentença, Acórdão ou Decisão.');

  const peca = await db.queryOne(`SELECT a.*, o.nome AS orgao_nome, ARRAY(SELECT apt.tese_id FROM acervo_pecas_teses apt WHERE apt.peca_id=a.id) tese_ids
    FROM acervo_pecas a LEFT JOIN acervo_orgaos o ON o.id=a.orgao_julgador_id WHERE a.id=$1 AND a.arquivada_em IS NULL${escopoVisibilidade(req, 'a')}`, [pecaId]);
  if (!peca) return { status: 404, body: { ok:false, erro:'Peça não encontrada.' } };
  if (peca.resultado !== 'pendente') return { status: 409, body: { ok:false, erro:'conflito', mensagem:`A peça já tem resultado (${peca.resultado}); nada foi alterado.` } };
  if (peca.decisao_id) return { status: 409, body: { ok:false, erro:'conflito', mensagem:'A decisão desta peça já foi registrada (decisao_id); confira a tarefa aberta.' } };
  if (peca.data_protocolo && data < String(peca.data_protocolo instanceof Date ? peca.data_protocolo.toISOString() : peca.data_protocolo).slice(0, 10)) throw invalido('A decisão é anterior ao protocolo da peça.');

  const sentido = resultado ? sentidoResultado(peca.tipo_peca, resultado) : null;
  const tipoDecisao = b.tipo_decisao || (TIPOS_PRIMEIRO_GRAU.has(peca.tipo_peca) ? 'Sentença' : 'Acórdão');
  const porPedido = resultado ? null : [{ pedido: 'Resultado geral', resultado: 'a-confirmar', observacao: `Leitura automática (${fonte}): ${evidencia}`.slice(0, 1000) }];

  const feito = await db.transaction(async t => {
    const precedente = await t.queryOne(`INSERT INTO acervo_precedentes (processo_id,processo_numero,orgao,tribunal,instancia,data_julgamento,ente,ratio,resultado,favoravel,vinculante,conferido,fonte_primaria_url,drive_url,visibilidade_snapshot,criado_por)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false,false,NULL,$11,$12,$13) RETURNING id`,
      [peca.processo_id, peca.processo_numero, orgaoInformado || peca.orgao_nome || peca.orgao_julgador || 'A conferir', peca.tribunal, instancia || peca.instancia, data, peca.ente,
        `A CONFERIR (${tipoDecisao.toLowerCase()} lida automaticamente no ${fonte}): ${evidencia}`.slice(0, 2000), resultado || 'pendente', sentido === 'favoravel', documento, peca.visibilidade_snapshot, req.user.id]);
    const precId = precedente.id;
    if (peca.tese_ids.length) await t.query('INSERT INTO acervo_precedentes_teses (precedente_id, tese_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING', [precId, peca.tese_ids]);
    await t.query(`UPDATE acervo_pecas SET data_decisao=$1, decisao_id=$2, ${resultado ? 'resultado=$3' : "resultado_por_pedido=CASE WHEN resultado_por_pedido IS NULL OR resultado_por_pedido='[]'::jsonb THEN $3::jsonb ELSE resultado_por_pedido END"}, atualizado_em=NOW() WHERE id=$4`,
      [data, precId, resultado || JSON.stringify(porPedido), peca.id]);
    let tarefa = null;
    if (criarTarefa) {
      const instrucao = [
        `${tipoDecisao} de ${data.split('-').reverse().join('/')} lida automaticamente no ${fonte}: ${evidencia}`,
        resultado ? `Resultado gravado: ${resultado}${sentido ? ` (${sentido === 'favoravel' ? 'favorável' : 'desfavorável'} ao cliente)` : ''}. Confirme e preencha o resultado por pedido.` : 'Resultado não identificado com segurança: a peça ficou "pendente", com o resultado por pedido "a-confirmar".',
        `No acervo: confirmar resultado e resultado por pedido da peça (atualizar_peca); conferir o precedente criado (ratio, ementa e fonte primária; conferir_precedente) ou arquivá-lo se não servir.${documento ? `\nDocumento: ${documento}` : ''}`,
      ].join('\n\n');
      tarefa = await t.queryOne(`INSERT INTO tarefas (processo_id, tipo, descricao, instrucao, atribuido_a, validado_por, urgencia, prazo_data) VALUES ($1,'geral',$2,$3,$4,$4,'MEDIO',$5::date) RETURNING id, descricao, prazo_data`,
        [peca.processo_id, `Acervo: conferir ${tipoDecisao.toLowerCase()} — ${peca.processo_numero || peca.titulo}`, instrucao, req.user.id, new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)]);
    }
    return { precedenteId: precId, tarefa };
  });
  await registrarAuditoria({ usuarioId:req.user.id, acao:'decisao_detectada', entidade:'acervo_peca', entidadeId:peca.id,
    valorAntes:{ resultado: peca.resultado, data_decisao: peca.data_decisao, decisao_id: null },
    valorDepois:{ data_decisao: data, resultado: resultado || 'pendente', a_confirmar: !resultado, decisao_id: feito.precedenteId, tarefa_id: feito.tarefa?.id ?? null, evidencia, fonte, tipo_decisao: tipoDecisao, ...marcaChave(req) }, ip:req._ip });
  // Aviso por WhatsApp ao Master da tarefa (spec dos avisos do acervo, etapa 2). Espera alguns minutos para
  // as decisões da mesma rotina saírem juntas; quem despacha é o agendamento de 10 em 10 minutos.
  let aviso = null;
  if (feito.tarefa) {
    try {
      aviso = await enfileirarAviso(db, { tipo: 'acervo_decisao', chaveEvento: `decisao:${feito.tarefa.id}`, usuarioId: req.user.id, tarefaId: feito.tarefa.id,
        texto: montarLinhaDecisao({ numero: peca.processo_numero, tipoPeca: peca.tipo_peca, tipoDecisao, data, resultado, sentido }),
        enviarApos: new Date(Date.now() + ESPERA_AGRUPAR_DECISOES_MIN * 60000) });
    } catch (e) { console.warn('[AvisosAcervo] Não foi possível enfileirar o aviso da decisão:', e.message); }
  }
  return { status: 201, body: { ok:true, peca_id: peca.id, data_decisao: data, resultado: resultado || 'pendente', a_confirmar: !resultado, precedente_id: feito.precedenteId, ...(feito.tarefa ? { tarefa: feito.tarefa } : {}), ...(aviso ? { aviso_whatsapp: 'enfileirado' } : {}) } };
}
acervoRouter.post('/pecas/:id/decisao', apenasMaster, async (req, res) => { try {
  const r = await registrarDecisao(req, req.params.id, req.body);
  res.status(r.status).json(r.body);
} catch (e) { erro(res, e); } });

// Decisões pelas publicações, etapa 3 (spec "AM - Spec Decisoes pelas Publicacoes.md", D3): reprocessa as publicações
// já importadas. Simulação por padrão (lista o que registraria); grava só com simular=false. Quem chama é o
// responsável reserva (sem Master no processo). Import dinâmico: o serviço usa registrarDecisao deste arquivo.
acervoRouter.post('/decisoes-publicacoes/reprocessar', apenasMaster, async (req, res) => { try {
  const p = { ...req.query, ...(req.body || {}) };
  const dias = p.dias === undefined || p.dias === '' ? 120 : Number(p.dias);
  if (!Number.isInteger(dias) || dias < 1 || dias > 365) return res.status(422).json({ ok:false, erro:'validacao', mensagem:'dias deve ser um inteiro de 1 a 365.' });
  const simular = !(p.simular === false || p.simular === 'false');
  const { reprocessarPublicacoes } = await import('../services/processarDecisoesPublicacoes.js');
  const r = await reprocessarPublicacoes({ dias, simular, usuarioImportacao: req.user.id });
  if (!simular) await registrarAuditoria({ usuarioId:req.user.id, acao:'reprocessar', entidade:'acervo_decisoes_publicacoes', entidadeId:null, valorDepois:{ dias, registradas:r.registradas, ja_registradas:r.ja_registradas, erros:r.erros, ...marcaChave(req) }, ip:req._ip });
  res.json({ ok:true, ...r });
} catch (e) { erro(res, e); } });

// ── Órgão julgador (§4.4) ─────────────────────────────────────────────────────────────────
// Juízo como entidade, ligado às peças (acervo_pecas.orgao_julgador_id), com a estatística de êxito do
// escritório naquele juízo por tese e por pedido. O texto livre acervo_pecas.orgao_julgador continua.
const CAMPOS_ORGAO = {
  nome: v => texto(v, 'nome', { obrigatorio: true, max: 300 }),
  tribunal: v => texto(v, 'tribunal', { obrigatorio: true, max: 100 }),
  instancia: v => validarEnum(v, INSTANCIAS, 'instancia', true),
  magistrado_atual: v => texto(v, 'magistrado_atual', { max: 200 }),
  notas: v => texto(v, 'notas', { max: 5000 }),
  ativo: v => Boolean(v),
};
// Sentido do resultado para o escritório. Em contrarrazões o recurso é da parte contrária: desprovido é bom.
const RESULTADO_FAVORAVEL = new Set(['procedente', 'parcialmente-procedente', 'provido', 'parcialmente-provido', 'acordo']);
const RESULTADO_DESFAVORAVEL = new Set(['improcedente', 'desprovido', 'nao-conhecido', 'extinto-sem-merito']);
export function sentidoResultado(tipoPeca, resultado) {
  if (tipoPeca === 'contrarrazoes') {
    if (resultado === 'desprovido' || resultado === 'nao-conhecido') return 'favoravel';
    if (resultado === 'provido' || resultado === 'parcialmente-provido') return 'desfavoravel';
  }
  if (RESULTADO_FAVORAVEL.has(resultado)) return 'favoravel';
  if (RESULTADO_DESFAVORAVEL.has(resultado)) return 'desfavoravel';
  return null; // pendente, desistência: fora da taxa
}
const taxa = (fav, decididas) => (decididas ? Math.round((fav * 1000) / decididas) / 10 : null);
async function estatisticaOrgao(req, orgaoId) {
  const pecas = await db.query(`SELECT a.id, a.tipo_peca, a.resultado, a.resultado_por_pedido,
      ARRAY(SELECT t.slug FROM acervo_pecas_teses apt JOIN teses_acervo t ON t.id=apt.tese_id WHERE apt.peca_id=a.id ORDER BY t.slug) teses
    FROM acervo_pecas a WHERE a.orgao_julgador_id=$1 AND a.arquivada_em IS NULL${escopoVisibilidade(req)}`, [orgaoId]);
  const porTese = new Map(); const porPedido = new Map();
  let decididas = 0; let favoraveis = 0;
  for (const p of pecas) {
    const sentido = sentidoResultado(p.tipo_peca, p.resultado);
    if (sentido) { decididas++; if (sentido === 'favoravel') favoraveis++; }
    for (const slug of p.teses) {
      const x = porTese.get(slug) ?? { tese: slug, pecas: 0, sem_decisao: 0, favoraveis: 0, desfavoraveis: 0 };
      x.pecas++;
      if (!sentido) x.sem_decisao++; else if (sentido === 'favoravel') x.favoraveis++; else x.desfavoraveis++;
      porTese.set(slug, x);
    }
    for (const item of Array.isArray(p.resultado_por_pedido) ? p.resultado_por_pedido : []) {
      const chave = String(item.pedido || '').trim().toLowerCase();
      if (!chave) continue;
      const y = porPedido.get(chave) ?? { pedido: String(item.pedido).trim(), total: 0, resultados: {} };
      y.total++; y.resultados[item.resultado] = (y.resultados[item.resultado] || 0) + 1;
      porPedido.set(chave, y);
    }
  }
  return {
    total_pecas: pecas.length, decididas, favoraveis, taxa_exito: taxa(favoraveis, decididas),
    por_tese: [...porTese.values()].map(x => ({ ...x, taxa_exito: taxa(x.favoraveis, x.favoraveis + x.desfavoraveis) })).sort((a, b) => b.pecas - a.pecas),
    por_pedido: [...porPedido.values()].sort((a, b) => b.total - a.total),
  };
}
const selectOrgao = req => `SELECT o.*, (SELECT COUNT(*) FROM acervo_pecas a WHERE a.orgao_julgador_id=o.id AND a.arquivada_em IS NULL${escopoVisibilidade(req)})::int AS pecas FROM acervo_orgaos o`;
async function conferirOrgao(id) {
  if (!uuidValido(String(id))) throw invalido('orgao_julgador_id inválido.');
  if (!(await db.queryOne('SELECT id FROM acervo_orgaos WHERE id=$1', [id]))) throw invalido('Órgão julgador não encontrado (cadastre antes em /orgaos).');
}

acervoRouter.get('/orgaos', async (req, res) => { try {
  const params = []; const where = [];
  if (req.query.ativo !== 'todos') where.push(req.query.ativo === 'false' ? 'o.ativo=false' : 'o.ativo=true');
  if (req.query.tribunal) { params.push(String(req.query.tribunal)); where.push(`o.tribunal=$${params.length}`); }
  if (String(req.query.q ?? '').trim()) { params.push(`%${String(req.query.q).trim()}%`); where.push(`(o.nome ILIKE $${params.length} OR COALESCE(o.magistrado_atual,'') ILIKE $${params.length})`); }
  const orgaos = await db.query(`${selectOrgao(req)}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY o.tribunal, o.instancia, o.nome`, params);
  res.json({ ok:true, orgaos });
} catch (e) { erro(res, e); } });

acervoRouter.get('/orgaos/:id', async (req, res) => { try {
  if (!uuidValido(req.params.id)) return res.status(400).json({ ok:false, erro:'validacao', mensagem:'ID inválido.' });
  const o = await db.queryOne(`${selectOrgao(req)} WHERE o.id=$1`, [req.params.id]);
  if (!o) return res.status(404).json({ ok:false, erro:'Órgão julgador não encontrado.' });
  res.json({ ok:true, orgao: { ...o, estatistica: await estatisticaOrgao(req, o.id) } });
} catch (e) { erro(res, e); } });

acervoRouter.post('/orgaos', apenasMaster, async (req, res) => { try {
  const b = req.body || {};
  const c = montarAlteracoes(b, CAMPOS_ORGAO);
  for (const campo of ['nome', 'tribunal', 'instancia']) c[campo] = CAMPOS_ORGAO[campo](b[campo]);
  const [o] = await db.query(`INSERT INTO acervo_orgaos (nome, tribunal, instancia, magistrado_atual, notas, ativo, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT ON CONSTRAINT acervo_orgaos_unico DO NOTHING RETURNING id`, [c.nome, c.tribunal, c.instancia, c.magistrado_atual ?? null, c.notas ?? null, c.ativo ?? true, req.user.id]);
  if (!o) return res.status(409).json({ ok:false, erro:'validacao', mensagem:'Já existe órgão com esse nome nesse tribunal.' });
  await registrarAuditoria({ usuarioId:req.user.id, acao:'criar', entidade:'acervo_orgao', entidadeId:o.id, valorDepois:{ ...c, ...marcaChave(req) }, ip:req._ip });
  res.status(201).json({ ok:true, orgao: await db.queryOne(`${selectOrgao(req)} WHERE o.id=$1`, [o.id]) });
} catch (e) { erro(res, e); } });

acervoRouter.patch('/orgaos/:id', apenasMaster, async (req, res) => { try {
  if (!uuidValido(req.params.id)) return res.status(400).json({ ok:false, erro:'validacao', mensagem:'ID inválido.' });
  const colunas = montarAlteracoes(req.body || {}, CAMPOS_ORGAO);
  if (!Object.keys(colunas).length) return res.status(422).json({ ok:false, erro:'validacao', mensagem:'Nenhum campo editável informado (nome, tribunal, instancia, magistrado_atual, notas, ativo).' });
  const anterior = await db.queryOne('SELECT * FROM acervo_orgaos WHERE id=$1', [req.params.id]);
  if (!anterior) return res.status(404).json({ ok:false, erro:'Órgão julgador não encontrado.' });
  const sets = []; const params = [];
  for (const [campo, valor] of Object.entries(colunas)) { params.push(valor); sets.push(`${campo}=$${params.length}`); }
  sets.push('atualizado_em=NOW()'); params.push(anterior.id);
  try { await db.execute(`UPDATE acervo_orgaos SET ${sets.join(', ')} WHERE id=$${params.length}`, params); }
  catch (e) { if (e.code === '23505') throw invalido('Já existe órgão com esse nome nesse tribunal.'); throw e; }
  await registrarAuditoria({ usuarioId:req.user.id, acao:'editar', entidade:'acervo_orgao', entidadeId:anterior.id, valorAntes:Object.fromEntries(Object.keys(colunas).map(c => [c, anterior[c]])), valorDepois:{ ...colunas, ...marcaChave(req) }, ip:req._ip });
  res.json({ ok:true, orgao: await db.queryOne(`${selectOrgao(req)} WHERE o.id=$1`, [anterior.id]) });
} catch (e) { erro(res, e); } });

// ── Painel de inteligência (§6) ───────────────────────────────────────────────────────────
// GET /painel — só leitura, respeita a visibilidade (quem não vê restrito não conta peça restrita).
// Êxito por tese, ente, juízo e argumento; tempo do protocolo à decisão por juízo; teses em risco;
// vigilância; pendências de curadoria. "Êxito" segue sentidoResultado (contrarrazões invertem).
const DIAS_CURADORIA = 30;
function agregador() {
  const mapa = new Map();
  return {
    somar(chave, base, sentido) {
      const x = mapa.get(chave) ?? { ...base, pecas: 0, sem_decisao: 0, favoraveis: 0, desfavoraveis: 0 };
      x.pecas++;
      if (!sentido) x.sem_decisao++; else if (sentido === 'favoravel') x.favoraveis++; else x.desfavoraveis++;
      mapa.set(chave, x);
      return x;
    },
    lista() {
      return [...mapa.values()].map(x => ({ ...x, taxa_exito: taxa(x.favoraveis, x.favoraveis + x.desfavoraveis) }))
        .sort((a, b) => b.pecas - a.pecas);
    },
  };
}
const diasEntre = (de, ate) => Math.round((Date.parse(ate) - Date.parse(de)) / 86_400_000);

// Retrato atual do acervo. Usado pela rota /painel e pelo relatório mensal (curadoria, teses, vigilância).
export async function montarPainel(req) {
  const vis = escopoVisibilidade(req);
  const [pecas, teses, orgaos, argumentos, usoArgumentos, precedentes, vigilancia, semPeca] = await Promise.all([
    db.query(`SELECT a.id, a.titulo, a.processo_numero, a.tipo_peca, a.ente, a.resultado, a.data_protocolo, a.data_decisao, a.drive_url, a.drive_file_id, a.orgao_julgador_id, a.retroativa,
        ARRAY(SELECT t.slug FROM acervo_pecas_teses apt JOIN teses_acervo t ON t.id=apt.tese_id WHERE apt.peca_id=a.id ORDER BY t.slug) teses
      FROM acervo_pecas a WHERE a.arquivada_em IS NULL${vis}`),
    db.query(`SELECT t.slug, t.label, t.status, t.status_motivo, m.slug AS tese_mae FROM teses_acervo t LEFT JOIN teses_acervo m ON m.id=t.tese_mae_id WHERE t.ativo=true`),
    db.query('SELECT id, nome, tribunal, instancia FROM acervo_orgaos WHERE ativo=true'),
    db.query(`SELECT g.id, g.titulo, g.tipo, g.status, g.responde_a_id, t.slug AS tese FROM acervo_argumentos g JOIN teses_acervo t ON t.id=g.tese_id`),
    db.query(`SELECT pa.argumento_id, pa.peca_id FROM acervo_pecas_argumentos pa JOIN acervo_pecas a ON a.id=pa.peca_id WHERE a.arquivada_em IS NULL${vis}`),
    db.query(`SELECT p.id, p.processo_numero, p.orgao, p.tribunal, p.data_julgamento, p.conferido FROM acervo_precedentes p WHERE p.arquivada_em IS NULL${escopoVisibilidade(req, 'p')}`),
    db.query(`SELECT v.id, v.referencia, v.ultima_situacao, v.verificado_em,
        (SELECT MAX(a.enviado_em) FROM avisos_acervo a WHERE a.tipo='acervo_vigilancia' AND a.status='enviado' AND a.chave_evento LIKE 'vigilancia:' || v.id || ':%') AS ultimo_aviso_em,
        (SELECT h.mudou AND h.situacao_anterior IS NOT NULL FROM acervo_vigilancia_historico h WHERE h.vigilancia_id=v.id ORDER BY h.registrado_em DESC LIMIT 1) AS ultima_mudou,
        (SELECT MAX(h.registrado_em) FROM acervo_vigilancia_historico h WHERE h.vigilancia_id=v.id AND h.mudou AND h.situacao_anterior IS NOT NULL) AS mudou_em,
        ARRAY(SELECT t.slug FROM acervo_vigilancia_teses vt JOIN teses_acervo t ON t.id=vt.tese_id WHERE vt.vigilancia_id=v.id ORDER BY t.slug) teses
      FROM acervo_vigilancia v WHERE v.ativo=true ORDER BY v.verificado_em ASC NULLS FIRST`),
    // Processos ativos e não restritos sem peça no acervo (spec "Peças que faltam"); detalhes em /cobertura.
    db.query(`SELECT pr.numero AS processo_numero, t.slug AS tese FROM processos pr
        LEFT JOIN produtos pd ON pd.id=pr.produto_id LEFT JOIN teses_acervo t ON t.id=pd.tese_acervo_id
      WHERE pr.status='ativo' AND pr.visibilidade='normal'
        AND NOT EXISTS (SELECT 1 FROM acervo_pecas a WHERE a.arquivada_em IS NULL AND (a.processo_id=pr.id
          OR REGEXP_REPLACE(COALESCE(a.processo_numero,''),'[^0-9]','','g')=REGEXP_REPLACE(pr.numero,'[^0-9]','','g')))
      ORDER BY pr.data_distribuicao DESC NULLS LAST, pr.numero`),
  ]);
  const hoje = new Date().toISOString().slice(0, 10);
  const nomeTese = new Map(teses.map(t => [t.slug, t.label]));
  const nomeOrgao = new Map(orgaos.map(o => [o.id, o]));
  const sentidoPeca = new Map();
  const porTese = agregador(); const porEnte = agregador(); const porOrgao = agregador();
  const tempos = new Map();
  let decididas = 0; let favoraveis = 0;
  for (const p of pecas) {
    const sentido = sentidoResultado(p.tipo_peca, p.resultado);
    sentidoPeca.set(p.id, sentido);
    if (sentido) { decididas++; if (sentido === 'favoravel') favoraveis++; }
    for (const slug of p.teses) porTese.somar(slug, { tese: slug, label: nomeTese.get(slug) ?? slug }, sentido);
    porEnte.somar(p.ente, { ente: p.ente }, sentido);
    if (p.orgao_julgador_id && nomeOrgao.has(p.orgao_julgador_id)) {
      const o = nomeOrgao.get(p.orgao_julgador_id);
      porOrgao.somar(o.id, { id: o.id, nome: o.nome, tribunal: o.tribunal, instancia: o.instancia }, sentido);
      if (p.data_protocolo && p.data_decisao && p.data_decisao >= p.data_protocolo) {
        const t = tempos.get(o.id) ?? []; t.push(diasEntre(p.data_protocolo, p.data_decisao)); tempos.set(o.id, t);
      }
    }
  }
  const media = v => (v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null);
  const orgaosLista = porOrgao.lista().map(o => ({ ...o, tempo_medio_dias: media(tempos.get(o.id) ?? []), decisoes_com_tempo: (tempos.get(o.id) ?? []).length }));

  // Êxito por argumento: peças que o usaram e o sentido do resultado delas; respostas agrupadas na defesa.
  const pecasDoArgumento = new Map();
  for (const u of usoArgumentos) { const l = pecasDoArgumento.get(u.argumento_id) ?? []; l.push(u.peca_id); pecasDoArgumento.set(u.argumento_id, l); }
  const estatArg = g => {
    const ids = pecasDoArgumento.get(g.id) ?? [];
    const s = { pecas: ids.length, favoraveis: 0, desfavoraveis: 0, sem_decisao: 0 };
    for (const id of ids) { const x = sentidoPeca.get(id); if (!x) s.sem_decisao++; else if (x === 'favoravel') s.favoraveis++; else s.desfavoraveis++; }
    return { ...s, taxa_exito: taxa(s.favoraveis, s.favoraveis + s.desfavoraveis) };
  };
  const defesas = argumentos.filter(g => g.tipo === 'defesa_fazenda' && g.status !== 'abandonado').map(d => ({
    id: d.id, titulo: d.titulo, tese: d.tese, status: d.status, ...estatArg(d),
    respostas: argumentos.filter(r => r.responde_a_id === d.id && r.status !== 'abandonado')
      .map(r => ({ id: r.id, titulo: r.titulo, tese: r.tese, status: r.status, ...estatArg(r) }))
      .sort((a, b) => b.pecas - a.pecas),
  })).sort((a, b) => (b.pecas + b.respostas.reduce((s, r) => s + r.pecas, 0)) - (a.pecas + a.respostas.reduce((s, r) => s + r.pecas, 0)));
  const statusArgumentos = argumentos.reduce((acc, g) => ({ ...acc, [g.status]: (acc[g.status] || 0) + 1 }), {});

  // Curadoria (§6): precedentes não conferidos, peças decididas sem resultado há mais de 30 dias, peças sem Drive,
  // sem data de protocolo, sem órgão julgador e peças de mérito sem os argumentos usados (§5.3).
  // Registro sem número de processo é modelo (peça-padrão, minuta), não peça protocolada: fica fora das
  // pendências de protocolo, órgão e argumentos; continua na de Drive, porque o modelo precisa do arquivo.
  const resumoPeca = p => ({ id: p.id, titulo: p.titulo, processo_numero: p.processo_numero });
  const comArgumento = new Set(usoArgumentos.map(u => u.peca_id));
  const protocoladas = pecas.filter(p => String(p.processo_numero ?? '').trim());
  const curadoria = {
    precedentes_nao_conferidos: precedentes.filter(p => !p.conferido).map(p => ({ id: p.id, processo_numero: p.processo_numero, orgao: p.orgao, tribunal: p.tribunal, data_julgamento: p.data_julgamento })),
    pecas_sem_resultado: pecas.filter(p => p.resultado === 'pendente' && p.data_decisao && diasEntre(p.data_decisao, hoje) > DIAS_CURADORIA)
      .map(p => ({ ...resumoPeca(p), data_decisao: p.data_decisao, dias: diasEntre(p.data_decisao, hoje) })),
    pecas_sem_drive: pecas.filter(p => !p.drive_url && !p.drive_file_id).map(resumoPeca),
    pecas_sem_protocolo: protocoladas.filter(p => !p.data_protocolo).map(resumoPeca),
    pecas_sem_orgao: protocoladas.filter(p => !p.orgao_julgador_id).map(resumoPeca),
    // D4: a peça cadastrada retroativamente (inicial mínima) tem contador próprio, para não esconder as novas.
    pecas_sem_argumento: protocoladas.filter(p => !p.retroativa && TIPOS_COM_ARGUMENTO.has(p.tipo_peca) && !comArgumento.has(p.id)).map(p => ({ ...resumoPeca(p), tipo_peca: p.tipo_peca })),
    retroativas_sem_argumento: protocoladas.filter(p => p.retroativa && !comArgumento.has(p.id)).map(p => ({ ...resumoPeca(p), tipo_peca: p.tipo_peca })),
    processos_sem_peca: semPeca.map(p => ({ processo_numero: p.processo_numero, tese: p.tese })),
  };

  return {
    ok: true,
    gerado_em: new Date().toISOString(),
    resumo: {
      pecas: pecas.length, decididas, favoraveis, taxa_exito: taxa(favoraveis, decididas), sem_decisao: pecas.length - decididas,
      precedentes: precedentes.length, precedentes_conferidos: precedentes.filter(p => p.conferido).length,
      teses_ativas: teses.length, teses_em_risco: teses.filter(t => t.status !== 'ativa').length,
      argumentos: argumentos.length, argumentos_por_status: statusArgumentos,
      vigilancia: vigilancia.length, orgaos: orgaos.length,
    },
    por_tese: porTese.lista(), por_ente: porEnte.lista(), por_orgao: orgaosLista,
    por_argumento: defesas,
    teses_em_risco: teses.filter(t => t.status !== 'ativa').map(t => ({ ...t, pecas: porTese.lista().find(x => x.tese === t.slug)?.pecas ?? 0 })),
    vigilancia: vigilancia.map(v => ({ ...v, dias_sem_verificar: v.verificado_em ? diasEntre(String(v.verificado_em instanceof Date ? v.verificado_em.toISOString() : v.verificado_em).slice(0, 10), hoje) : null })),
    curadoria,
  };
}
acervoRouter.get('/painel', async (req, res) => { try { res.json(await montarPainel(req)); } catch (e) { erro(res, e); } });

// ── Peças que faltam no acervo, etapa 1 (spec "AM - Spec Pecas que Faltam no Acervo.md") ──────────────────
// Cobertura (só leitura): processos ativos e não restritos sem peça no acervo. Produtos: ligação produto → tese,
// com a sugestão pelo nome (D5: o usuário aprova; a ligação é gravada pelo PATCH). Sem nome de cliente.
acervoRouter.get('/cobertura', async (req, res) => { try {
  const { tese, ente, com_decisao, limite } = req.query;
  if (ente && !ENTES.has(ente)) return res.status(422).json({ ok:false, erro:'validacao', mensagem:'ente inválido.' });
  const lim = limite === undefined ? 500 : Number(limite);
  if (!Number.isInteger(lim) || lim < 1 || lim > 2000) return res.status(422).json({ ok:false, erro:'validacao', mensagem:'limite deve ser um inteiro de 1 a 2000.' });
  const { listarCobertura } = await import('../services/coberturaAcervo.js');
  res.json({ ok:true, ...(await listarCobertura({ tese: tese || null, ente: ente || null, comDecisao: com_decisao === 'true' || com_decisao === '1', limite: lim })) });
} catch (e) { erro(res, e); } });
// Etapa 2: cadastro retroativo em lote. Simulação por padrão (D1: começar pelos processos com decisão publicada).
acervoRouter.post('/cobertura/cadastrar', apenasMaster, async (req, res) => { try {
  const b = { ...req.query, ...(req.body || {}) };
  const limite = b.limite === undefined || b.limite === '' ? 100 : Number(b.limite);
  if (!Number.isInteger(limite) || limite < 1 || limite > 300) return res.status(422).json({ ok:false, erro:'validacao', mensagem:'limite deve ser um inteiro de 1 a 300.' });
  const processos = b.processos === undefined ? null : b.processos;
  if (processos !== null && (!Array.isArray(processos) || processos.length > 300 || processos.some(id => !uuidValido(id)))) return res.status(422).json({ ok:false, erro:'validacao', mensagem:'processos deve ser uma lista de até 300 ids.' });
  const simular = !(b.simular === false || b.simular === 'false');
  const comDecisao = b.com_decisao === true || b.com_decisao === 'true';
  // datas: { numero: 'AAAA-MM-DD' } consultadas no DataJud de uma máquina do escritório (do Railway ele não responde).
  const datas = b.datas === undefined ? null : b.datas;
  if (datas !== null && (typeof datas !== 'object' || Array.isArray(datas) || Object.keys(datas).length > 300)) return res.status(422).json({ ok:false, erro:'validacao', mensagem:'datas deve ser um objeto { numero: "AAAA-MM-DD" } com até 300 processos.' });
  const buscarDataJud = !(b.buscar_datajud === false || b.buscar_datajud === 'false');
  const { cadastrarRetroativas } = await import('../services/coberturaAcervo.js');
  const r = await cadastrarRetroativas({ processos, comDecisao, tese: b.tese || null, limite, simular, datas, buscarDataJud, usuarioId: req.user.id });
  if (!simular) await registrarAuditoria({ usuarioId:req.user.id, acao:'cadastro_retroativo', entidade:'acervo_peca', entidadeId:null, valorDepois:{ criadas:r.criadas, com_decisao:comDecisao, tese:b.tese || null, decisoes:r.decisoes, ...marcaChave(req) }, ip:req._ip });
  res.json({ ok:true, ...r });
} catch (e) { erro(res, e); } });
acervoRouter.get('/produtos', async (req, res) => { try {
  const { listarProdutos } = await import('../services/coberturaAcervo.js');
  res.json({ ok:true, produtos: await listarProdutos() });
} catch (e) { erro(res, e); } });
acervoRouter.patch('/produtos/:id/tese', apenasMaster, async (req, res) => { try {
  if (!uuidValido(req.params.id)) return res.status(400).json({ ok:false, erro:'validacao', mensagem:'ID inválido.' });
  const slug = req.body?.tese ?? null;
  let teseId = null;
  if (slug !== null) {
    const t = await db.queryOne('SELECT id FROM teses_acervo WHERE slug=$1 AND ativo=true', [String(slug)]);
    if (!t) return res.status(422).json({ ok:false, erro:'validacao', mensagem:'Tese inexistente.' });
    teseId = t.id;
  }
  const antes = await db.queryOne('SELECT p.id, p.nome, t.slug AS tese FROM produtos p LEFT JOIN teses_acervo t ON t.id=p.tese_acervo_id WHERE p.id=$1', [req.params.id]);
  if (!antes) return res.status(404).json({ ok:false, erro:'Não encontrado.' });
  await db.query('UPDATE produtos SET tese_acervo_id=$1 WHERE id=$2', [teseId, req.params.id]);
  await registrarAuditoria({ usuarioId:req.user.id, acao:'ligar_tese', entidade:'produto', entidadeId:antes.id, valorAntes:{ tese: antes.tese }, valorDepois:{ tese: slug, ...marcaChave(req) }, ip:req._ip });
  res.json({ ok:true, produto: { id: antes.id, nome: antes.nome, tese: slug } });
} catch (e) { erro(res, e); } });

// ── Contexto antes de redigir (§5.2): GET /contexto-redacao?tese=slug[&ente=][&orgao_julgador_id=][&tipo_peca=] ──
// O que a skill da tese precisa antes de escrever: situação da tese, vigilância, precedentes-âncora conferidos,
// argumentos aprovados e as defesas da Fazenda com as respostas, ordenadas pelo uso naquele ente e juízo e com o
// êxito de cada resposta (geral, no ente e no juízo). Herda da tese-mãe; não desce para as variantes. Só leitura.
const LIMITE_ANCORAS = 15;
const LIMITE_MODELOS = 10;
acervoRouter.get('/contexto-redacao', async (req, res) => { try {
  if (!String(req.query.tese ?? '').trim()) return res.status(422).json({ ok:false, erro:'validacao', mensagem:'Informe a tese: /contexto-redacao?tese=slug.' });
  const tese = await lerTese(req.query.tese);
  if (!tese) return res.status(404).json({ ok:false, erro:'Tese não encontrada.' });
  const ente = req.query.ente ? validarEnum(req.query.ente, ENTES, 'ente') : null;
  const tipoPeca = req.query.tipo_peca ? validarEnum(req.query.tipo_peca, TIPOS, 'tipo_peca') : null;
  const orgaoId = String(req.query.orgao_julgador_id ?? '').trim() || null;
  if (orgaoId && !uuidValido(orgaoId)) return res.status(400).json({ ok:false, erro:'validacao', mensagem:'orgao_julgador_id inválido.' });
  const orgao = orgaoId ? await db.queryOne('SELECT id, nome, tribunal, instancia FROM acervo_orgaos WHERE id=$1', [orgaoId]) : null;
  if (orgaoId && !orgao) return res.status(404).json({ ok:false, erro:'Órgão julgador não encontrado.' });

  const acima = await linhagem(tese.id, 'acima');
  const ids = acima.map(t => t.id);
  const vis = escopoVisibilidade(req);
  const [maes, variantes, precedentes, naoConferidos, argumentos, pecas, vigilancia] = await Promise.all([
    db.query('SELECT slug, label, status, status_motivo FROM teses_acervo WHERE id = ANY($1::uuid[]) AND id<>$2', [ids, tese.id]),
    db.query('SELECT slug, label FROM teses_acervo WHERE tese_mae_id=$1 AND ativo=true ORDER BY label', [tese.id]),
    db.query(`SELECT DISTINCT ON (p.id) p.id, p.processo_numero, p.orgao, p.tribunal, p.instancia, p.data_julgamento, p.ente, p.resultado, p.favoravel, p.vinculante, p.ratio, p.fonte_primaria_url, p.drive_url,
        ARRAY(SELECT t.slug FROM acervo_precedentes_teses x JOIN teses_acervo t ON t.id=x.tese_id WHERE x.precedente_id=p.id ORDER BY t.slug) teses
      FROM acervo_precedentes p JOIN acervo_precedentes_teses apt ON apt.precedente_id=p.id
      WHERE apt.tese_id = ANY($1::uuid[]) AND p.arquivada_em IS NULL AND p.conferido=true${escopoVisibilidade(req, 'p')}`, [ids]),
    db.queryOne(`SELECT COUNT(DISTINCT p.id)::int AS n FROM acervo_precedentes p JOIN acervo_precedentes_teses apt ON apt.precedente_id=p.id
      WHERE apt.tese_id = ANY($1::uuid[]) AND p.arquivada_em IS NULL AND p.conferido=false${escopoVisibilidade(req, 'p')}`, [ids]),
    db.query(`SELECT g.id, g.tipo, g.titulo, g.status, g.responde_a_id, g.texto_modelo, t.slug AS tese,
        ARRAY(SELECT ap.precedente_id FROM acervo_argumentos_precedentes ap WHERE ap.argumento_id=g.id) precedentes
      FROM acervo_argumentos g JOIN teses_acervo t ON t.id=g.tese_id WHERE g.tese_id = ANY($1::uuid[]) AND g.status<>'abandonado'`, [ids]),
    db.query(`SELECT a.id, a.titulo, a.tipo_peca, a.ente, a.orgao_julgador_id, a.resultado, a.data_protocolo, a.modelo_aprovado, a.drive_url, a.processo_numero,
        ARRAY(SELECT pa.argumento_id FROM acervo_pecas_argumentos pa WHERE pa.peca_id=a.id) argumentos
      FROM acervo_pecas a WHERE a.arquivada_em IS NULL AND EXISTS (SELECT 1 FROM acervo_pecas_teses apt WHERE apt.peca_id=a.id AND apt.tese_id = ANY($1::uuid[]))${vis}`, [ids]),
    vigilanciaDasTeses(ids),
  ]);

  // Uso e êxito de cada argumento: geral, no ente e no juízo informados.
  const novo = () => ({ pecas: 0, favoraveis: 0, desfavoraveis: 0 });
  const uso = new Map();
  for (const p of pecas) {
    const sentido = sentidoResultado(p.tipo_peca, p.resultado);
    const recortes = ['geral', ...(ente && p.ente === ente ? ['ente'] : []), ...(orgaoId && p.orgao_julgador_id === orgaoId ? ['juizo'] : [])];
    for (const g of p.argumentos) {
      const u = uso.get(g) ?? { geral: novo(), ente: novo(), juizo: novo() };
      for (const r of recortes) { u[r].pecas++; if (sentido === 'favoravel') u[r].favoraveis++; else if (sentido) u[r].desfavoraveis++; }
      uso.set(g, u);
    }
  }
  const estat = id => {
    const u = uso.get(id) ?? { geral: novo(), ente: novo(), juizo: novo() };
    const fmt = x => ({ ...x, taxa_exito: taxa(x.favoraveis, x.favoraveis + x.desfavoraveis) });
    return { geral: fmt(u.geral), ...(ente ? { no_ente: fmt(u.ente) } : {}), ...(orgaoId ? { no_juizo: fmt(u.juizo) } : {}) };
  };
  const pesoStatus = g => (g.status === 'aprovado' ? 0 : 1);
  const recorte = g => { const e = estat(g.id); return [e.no_juizo?.pecas ?? 0, e.no_ente?.pecas ?? 0, e.geral.pecas]; };
  const porUso = (a, b) => { const x = recorte(a); const y = recorte(b); return y[0] - x[0] || y[1] - x[1] || y[2] - x[2]; };
  const comEstat = g => ({ id: g.id, tipo: g.tipo, titulo: g.titulo, status: g.status, tese: g.tese, texto_modelo: g.texto_modelo, precedentes: g.precedentes, uso: estat(g.id) });
  const defesas = argumentos.filter(g => g.tipo === 'defesa_fazenda').sort(porUso).map(d => ({
    ...comEstat(d),
    respostas: argumentos.filter(r => r.responde_a_id === d.id).sort((a, b) => pesoStatus(a) - pesoStatus(b) || porUso(a, b)).map(comEstat),
  }));
  const proprios = argumentos.filter(g => g.tipo !== 'defesa_fazenda' && !(g.tipo === 'resposta' && g.responde_a_id))
    .sort((a, b) => pesoStatus(a) - pesoStatus(b) || porUso(a, b)).map(comEstat);

  // Âncoras: vinculantes primeiro, depois favoráveis, do mesmo ente, mais recentes. Desfavoráveis vêm marcadas
  // (servem para a distinção), nunca como fundamento.
  const ordem = p => [p.vinculante ? 0 : 1, p.favoravel ? 0 : 1, ente && p.ente === ente ? 0 : 1];
  const ancoras = precedentes.sort((a, b) => {
    const x = ordem(a); const y = ordem(b);
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || String(b.data_julgamento ?? '').localeCompare(String(a.data_julgamento ?? ''));
  });
  const modelos = pecas.filter(p => p.modelo_aprovado && (!tipoPeca || p.tipo_peca === tipoPeca))
    .sort((a, b) => (ente ? (a.ente === ente ? 0 : 1) - (b.ente === ente ? 0 : 1) : 0) || String(b.data_protocolo ?? '').localeCompare(String(a.data_protocolo ?? '')))
    .slice(0, LIMITE_MODELOS).map(({ argumentos: _a, orgao_julgador_id: _o, resultado: _r, ...p }) => p);

  const avisos = [];
  for (const t of [tese, ...maes]) if (t.status && t.status !== 'ativa') avisos.push(`Tese ${t.slug} em situação "${t.status}": ${t.status_motivo}`);
  if (naoConferidos?.n) avisos.push(`${naoConferidos.n} precedente(s) da tese ainda não conferido(s) na fonte primária: não citar sem conferir.`);
  if (!argumentos.length) avisos.push('A tese ainda não tem argumentos cadastrados: a fonte continua sendo a skill.');

  res.json({
    ok: true,
    tese: { ...semId(tese), maes, variantes },
    recorte: { ente, orgao_julgador: orgao, tipo_peca: tipoPeca },
    avisos,
    vigilancia,
    precedentes_ancora: ancoras.slice(0, LIMITE_ANCORAS),
    precedentes_total: ancoras.length,
    argumentos: proprios,
    defesas_fazenda: defesas,
    modelos_aprovados: modelos,
    pecas_consideradas: pecas.length,
  });
} catch (e) { erro(res, e); } });

// ── Relatório mensal do acervo (spec "AM - Spec Relatorio Mensal do Acervo.md", Drive) ─────────────────
// GET /relatorio?mes=AAAA-MM (padrão: mês anterior). Mês fechado com retrato gravado devolve o retrato;
// sem retrato, calcula na hora. POST /relatorio/:mes/fechar (Master) grava o retrato. Sem processos
// restritos (qualquer perfil vê o mesmo relatório) e sem nome de cliente: o processo sai pelo número CNJ.
const MES_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const pad2 = n => String(n).padStart(2, '0');
const mesAtualBR = (agora = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(agora).slice(0, 7);
const mesAnterior = mes => { const [a, m] = mes.split('-').map(Number); return m === 1 ? `${a - 1}-12` : `${a}-${pad2(m - 1)}`; };
const proximoMes = mes => { const [a, m] = mes.split('-').map(Number); return m === 12 ? `${a + 1}-01` : `${a}-${pad2(m + 1)}`; };
const reqSemRestrito = req => ({ ...req, user: { ...req.user, pode_marcar_restrito: false } });
export const ARG_SUGERIR_APROVAR = 3; // decisões favoráveis, nenhuma desfavorável
export const ARG_SUGERIR_REVER = 2;   // decisões desfavoráveis, nenhuma favorável

function lerMes(valor, { padrao }) {
  const mes = String(valor ?? '').trim() || padrao;
  if (!MES_RE.test(mes)) throw invalido('mes deve ser AAAA-MM.');
  if (mes > mesAtualBR()) throw invalido('Mês futuro: ainda não há relatório.');
  return mes;
}

export async function calcularRelatorio(reqOriginal, mes, { comAnterior = true } = {}) {
  const req = reqSemRestrito(reqOriginal);
  const ini = `${mes}-01`; const fim = `${proximoMes(mes)}-01`; // [ini, fim)
  const noMes = d => Boolean(d) && d >= ini && d < fim;
  const [pecas, argumentos, precedentes, argMudaram, vigMudou, tarefasConf] = await Promise.all([
    db.query(`SELECT a.id, a.processo_numero, a.tipo_peca, a.resultado, a.data_protocolo::text AS dp, a.data_decisao::text AS dd, a.resultado_por_pedido, a.orgao_julgador_id, o.nome AS orgao, o.tribunal,
        ARRAY(SELECT t.slug FROM acervo_pecas_teses apt JOIN teses_acervo t ON t.id=apt.tese_id WHERE apt.peca_id=a.id ORDER BY t.slug) teses,
        ARRAY(SELECT pa.argumento_id FROM acervo_pecas_argumentos pa WHERE pa.peca_id=a.id) argumentos
      FROM acervo_pecas a LEFT JOIN acervo_orgaos o ON o.id=a.orgao_julgador_id WHERE a.arquivada_em IS NULL${escopoVisibilidade(req)}`),
    db.query(`SELECT g.id, g.tipo, g.titulo, g.status, g.responde_a_id, t.slug AS tese, (g.criado_em AT TIME ZONE 'America/Sao_Paulo')::date::text AS criado
      FROM acervo_argumentos g JOIN teses_acervo t ON t.id=g.tese_id`),
    db.queryOne(`SELECT COUNT(*) FILTER (WHERE (p.criado_em AT TIME ZONE 'America/Sao_Paulo')::date >= $1::date AND (p.criado_em AT TIME ZONE 'America/Sao_Paulo')::date < $2::date)::int AS novos,
        COUNT(*) FILTER (WHERE p.conferido AND (p.conferido_em AT TIME ZONE 'America/Sao_Paulo')::date >= $1::date AND (p.conferido_em AT TIME ZONE 'America/Sao_Paulo')::date < $2::date)::int AS conferidos
      FROM acervo_precedentes p WHERE p.arquivada_em IS NULL${escopoVisibilidade(req, 'p')}`, [ini, fim]),
    db.query(`SELECT l.entidade_id AS id, l.valor_antes->>'status' AS de, l.valor_depois->>'status' AS para, (l.criado_em AT TIME ZONE 'America/Sao_Paulo')::date::text AS em
      FROM logs_auditoria l WHERE l.entidade='acervo_argumento' AND l.acao='editar' AND l.valor_depois ? 'status'
        AND l.valor_antes->>'status' IS DISTINCT FROM l.valor_depois->>'status'
        AND (l.criado_em AT TIME ZONE 'America/Sao_Paulo')::date >= $1::date AND (l.criado_em AT TIME ZONE 'America/Sao_Paulo')::date < $2::date ORDER BY l.criado_em`, [ini, fim]),
    db.query(`SELECT v.referencia, h.situacao_anterior, h.situacao_nova, (h.registrado_em AT TIME ZONE 'America/Sao_Paulo')::date::text AS em
      FROM acervo_vigilancia_historico h JOIN acervo_vigilancia v ON v.id=h.vigilancia_id
      WHERE h.mudou AND h.situacao_anterior IS NOT NULL AND (h.registrado_em AT TIME ZONE 'America/Sao_Paulo')::date >= $1::date AND (h.registrado_em AT TIME ZONE 'America/Sao_Paulo')::date < $2::date ORDER BY h.registrado_em`, [ini, fim]),
    db.queryOne(`SELECT COUNT(*)::int AS n FROM tarefas WHERE descricao LIKE 'Acervo: conferir %' AND status NOT IN ('concluida','cancelada')`),
  ]);
  const sentidoDe = p => (p.resultado === 'pendente' ? null : sentidoResultado(p.tipo_peca, p.resultado));
  const contar = (lista, chave) => lista.reduce((acc, x) => { for (const k of [].concat(chave(x))) acc[k] = (acc[k] || 0) + 1; return acc; }, {});

  // Resumo do mês
  const protocoladas = pecas.filter(p => noMes(p.dp));
  const decididasMes = pecas.filter(p => noMes(p.dd));
  const dec = { total: decididasMes.length, favoraveis: 0, desfavoraveis: 0, a_confirmar: 0, outras: 0 };
  for (const p of decididasMes) {
    if (p.resultado === 'pendente') { dec.a_confirmar++; continue; }
    const s = sentidoDe(p); if (s === 'favoravel') dec.favoraveis++; else if (s === 'desfavoravel') dec.desfavoraveis++; else dec.outras++;
  }
  const acumuladas = pecas.filter(p => p.dd && p.dd < fim && sentidoDe(p));
  const favAcum = acumuladas.filter(p => sentidoDe(p) === 'favoravel').length;
  const tempos = decididasMes.filter(p => p.dp && p.dd >= p.dp).map(p => diasEntre(p.dp, p.dd));
  const novosArgs = argumentos.filter(g => noMes(g.criado));
  const resumo = {
    pecas_protocoladas: protocoladas.length,
    por_tese: contar(protocoladas, p => p.teses), por_tipo: contar(protocoladas, p => p.tipo_peca),
    decisoes: dec,
    taxa_exito_mes: taxa(dec.favoraveis, dec.favoraveis + dec.desfavoraveis),
    taxa_exito_acumulada: taxa(favAcum, acumuladas.length), decididas_acumuladas: acumuladas.length,
    tempo_medio_dias: tempos.length ? Math.round(tempos.reduce((s, x) => s + x, 0) / tempos.length) : null,
    precedentes_novos: precedentes?.novos ?? 0, precedentes_conferidos: precedentes?.conferidos ?? 0,
    argumentos_novos: novosArgs.length, argumentos_mudaram: argMudaram.length,
  };

  // Decisões do mês: desfavoráveis primeiro, depois a confirmar, depois as demais
  const ordem = { desfavoravel: 0, a_confirmar: 1, favoravel: 2 };
  const decisoes = decididasMes.map(p => {
    const s = sentidoDe(p);
    return { processo: cnjParaMensagem(p.processo_numero), teses: p.teses, tipo_peca: p.tipo_peca, orgao: p.orgao ?? null, data_decisao: p.dd, resultado: p.resultado, sentido: s, a_confirmar: p.resultado === 'pendente' };
  }).sort((a, b) => (ordem[a.a_confirmar ? 'a_confirmar' : a.sentido] ?? 3) - (ordem[b.a_confirmar ? 'a_confirmar' : b.sentido] ?? 3) || a.data_decisao.localeCompare(b.data_decisao));

  // O que está funcionando: êxito por tese e juízo (do mês e acumulado, só com decisões) e argumentos
  const exito = (lista, chave, base) => {
    const ag = agregador();
    for (const p of lista) { const s = sentidoDe(p); if (!s) continue; for (const k of [].concat(chave(p))) if (k) ag.somar(k, base(p, k), s); }
    return ag.lista();
  };
  const porTese = l => exito(l, p => p.teses, (_p, k) => ({ tese: k }));
  const porOrgao = l => exito(l, p => p.orgao_julgador_id, p => ({ id: p.orgao_julgador_id, nome: p.orgao, tribunal: p.tribunal }));
  const argPorId = new Map(argumentos.map(g => [g.id, g]));
  const defesasMes = new Map();
  for (const p of decididasMes) {
    const s = sentidoDe(p); if (!s) continue;
    const usados = p.argumentos.map(id => argPorId.get(id)).filter(Boolean);
    for (const d of usados.filter(g => g.tipo === 'defesa_fazenda')) {
      const item = defesasMes.get(d.id) ?? { id: d.id, titulo: d.titulo, tese: d.tese, respostas: new Map() };
      for (const r of usados.filter(g => g.responde_a_id === d.id)) {
        const x = item.respostas.get(r.id) ?? { id: r.id, titulo: r.titulo, status: r.status, favoraveis: 0, desfavoraveis: 0 };
        if (s === 'favoravel') x.favoraveis++; else x.desfavoraveis++;
        item.respostas.set(r.id, x);
      }
      defesasMes.set(d.id, item);
    }
  }
  const sugestoes = [];
  for (const g of argumentos.filter(x => x.status === 'em_teste' && x.tipo !== 'defesa_fazenda')) {
    let fav = 0; let desf = 0;
    for (const p of acumuladas) if (p.argumentos.includes(g.id)) { if (sentidoDe(p) === 'favoravel') fav++; else desf++; }
    if (fav >= ARG_SUGERIR_APROVAR && desf === 0) sugestoes.push({ id: g.id, titulo: g.titulo, tese: g.tese, favoraveis: fav, desfavoraveis: desf, sugestao: 'aprovar' });
    else if (desf >= ARG_SUGERIR_REVER && fav === 0) sugestoes.push({ id: g.id, titulo: g.titulo, tese: g.tese, favoraveis: fav, desfavoraveis: desf, sugestao: 'rever' });
  }

  // O que pede atenção (situação no momento do cálculo)
  const painel = await montarPainel(req);
  const relatorio = {
    ok: true, mes, parcial: mes === mesAtualBR(), gerado_em: new Date().toISOString(), retrato: false,
    resumo,
    decisoes,
    funcionando: {
      por_tese_mes: porTese(decididasMes), por_tese_acumulado: porTese(acumuladas),
      por_orgao_mes: porOrgao(decididasMes), por_orgao_acumulado: porOrgao(acumuladas),
      defesas_mes: [...defesasMes.values()].map(d => ({ ...d, respostas: [...d.respostas.values()] })),
      sugestoes_argumentos: sugestoes,
    },
    argumentos_novos: novosArgs.map(g => ({ id: g.id, titulo: g.titulo, tese: g.tese, tipo: g.tipo })),
    argumentos_mudaram: argMudaram.map(x => ({ ...x, titulo: argPorId.get(x.id)?.titulo ?? null })),
    atencao: {
      teses_em_risco: painel.teses_em_risco.map(t => ({ slug: t.slug, label: t.label, status: t.status, motivo: t.status_motivo, pecas: t.pecas })),
      vigilancia_mudou: vigMudou,
      vigilancia_sem_verificacao: painel.vigilancia.filter(v => v.dias_sem_verificar === null || v.dias_sem_verificar > DIAS_CURADORIA).map(v => ({ referencia: v.referencia, dias_sem_verificar: v.dias_sem_verificar })),
      decisoes_a_confirmar: pecas.filter(p => p.resultado === 'pendente' && (p.resultado_por_pedido || []).some(x => x.resultado === 'a-confirmar')).length,
      tarefas_conferencia_abertas: tarefasConf?.n ?? 0,
      curadoria: Object.fromEntries(Object.entries(painel.curadoria).map(([k, v]) => [k, v.length])),
    },
  };
  if (comAnterior) {
    const ant = mesAnterior(mes);
    const ret = await db.queryOne('SELECT dados FROM acervo_relatorios_mensais WHERE mes=$1', [ant]);
    relatorio.anterior = ret
      ? { mes: ant, fonte: 'retrato', resumo: ret.dados.resumo, curadoria: ret.dados.atencao?.curadoria ?? null }
      : { mes: ant, fonte: 'calculado', resumo: (await calcularRelatorio(reqOriginal, ant, { comAnterior: false })).resumo, curadoria: null };
  }
  return relatorio;
}

acervoRouter.get('/relatorio', async (req, res) => { try {
  const mes = lerMes(req.query.mes, { padrao: mesAnterior(mesAtualBR()) });
  const recalcular = req.query.recalcular === 'true';
  if (recalcular && req.user?.perfil !== 'master') return res.status(403).json({ ok:false, erro:'Só o Master pode recalcular um mês fechado.' });
  if (!recalcular) {
    const ret = await db.queryOne('SELECT dados, fechado_em FROM acervo_relatorios_mensais WHERE mes=$1', [mes]);
    if (ret) return res.json({ ...ret.dados, retrato: true, fechado_em: ret.fechado_em });
  }
  res.json(await calcularRelatorio(req, mes));
} catch (e) { erro(res, e); } });

// Fecha um mês: calcula e grava o retrato (substitui o anterior, se houver). Só mês já encerrado.
export async function fecharRelatorio(req, mes) {
  if (mes >= mesAtualBR()) throw invalido('Só um mês já encerrado pode ser fechado.');
  const dados = await calcularRelatorio(req, mes);
  await db.execute(`INSERT INTO acervo_relatorios_mensais (mes, dados, fechado_por) VALUES ($1,$2::jsonb,$3)
    ON CONFLICT (mes) DO UPDATE SET dados=EXCLUDED.dados, fechado_em=NOW(), fechado_por=EXCLUDED.fechado_por`, [mes, JSON.stringify(dados), req.user?.id ?? null]);
  await registrarAuditoria({ usuarioId: req.user?.id ?? null, acao: 'fechar', entidade: 'acervo_relatorio', entidadeId: null, valorDepois: { mes, resumo: dados.resumo, ...marcaChave(req) }, ip: req._ip });
  return dados;
}
acervoRouter.post('/relatorio/:mes/fechar', apenasMaster, async (req, res) => { try {
  const mes = lerMes(req.params.mes, { padrao: '' });
  const dados = await fecharRelatorio(req, mes);
  res.status(201).json({ ...dados, retrato: true });
} catch (e) { erro(res, e); } });

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
