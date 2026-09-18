import { Router } from 'express';
import { db } from '../db/index.js';
import { apenasMaster } from '../middleware/auth.js';
import { uuidValido } from '../utils/validacao.js';
import { registrarAuditoria } from '../middleware/auditoria.js';

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
async function processoContexto(processoId) {
  if (!processoId) return { numero: null, clienteId: null, clienteNome: null, visibilidade: 'normal' };
  if (!uuidValido(processoId)) { const e = new Error('Processo inválido.'); e.status = 400; throw e; }
  const p = await db.queryOne(`SELECT p.numero, p.cliente_id, p.visibilidade, c.nome AS cliente_nome FROM processos p LEFT JOIN clientes c ON c.id=p.cliente_id WHERE p.id=$1`, [processoId]);
  if (!p) { const e = new Error('Processo não encontrado.'); e.status = 404; throw e; }
  return { numero: p.numero, clienteId: p.cliente_id, clienteNome: p.cliente_nome, visibilidade: p.visibilidade || 'normal' };
}
async function gravarTeses(tipo, id, slugs) {
  const coluna = tipo === 'acervo_pecas' ? 'peca_id' : 'precedente_id';
  await db.execute(`DELETE FROM ${tipo}_teses WHERE ${coluna}=$1`, [id]);
  await db.execute(`INSERT INTO ${tipo}_teses (${coluna}, tese_id) SELECT $1,id FROM teses_acervo WHERE slug=ANY($2::text[])`, [id, slugs]);
}
function erro(res, err) { res.status(err.status || 500).json({ ok: false, erro: err.status ? 'validacao' : 'interno', mensagem: err.message }); }

acervoRouter.get('/teses', async (_req, res) => res.json({ ok:true, teses: await db.query('SELECT slug,label,drive_folder_id FROM teses_acervo WHERE ativo=true ORDER BY label') }));

acervoRouter.get('/', async (req, res) => {
  const { q='', tese, ente, tribunal, tipo, instancia, resultado, aba='todos', arquivados='false' } = req.query;
  const limite = page(req.query.limite, 50); const offset = (page(req.query.page) - 1) * limite;
  const params=[]; const where=[`a.arquivada_em IS ${arquivados==='true'?'NOT ':' '}NULL`];
  if (q.trim()) { params.push(`%${q.trim()}%`); where.push(`(a.titulo ILIKE $${params.length} OR a.processo_numero ILIKE $${params.length} OR a.cliente_nome ILIKE $${params.length} OR a.orgao_julgador ILIKE $${params.length} OR COALESCE(a.resumo,'') ILIKE $${params.length})`); }
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
  const ctx=await processoContexto(b.processo_id); const [nova]=await db.query(`INSERT INTO acervo_pecas (processo_id,processo_numero,cliente_id,cliente_nome,titulo,tipo_peca,ente,ente_detalhe,tribunal,instancia,orgao_julgador,relator,data_protocolo,drive_file_id,drive_url,resultado,resumo,modelo_aprovado,visibilidade_snapshot,criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,[b.processo_id||null,ctx.numero||b.processo_numero||null,ctx.clienteId||b.cliente_id||null,ctx.clienteNome||b.cliente_nome||'Sem cliente vinculado',String(b.titulo||b.tipo_peca).trim(),b.tipo_peca,b.ente,b.ente_detalhe||null,b.tribunal||null,b.instancia,b.orgao_julgador||null,b.relator||null,b.data_protocolo||null,b.drive_file_id||null,b.drive_url||null,b.resultado||'pendente',b.resumo||null,Boolean(b.modelo_aprovado),ctx.visibilidade,req.user.id]); await gravarTeses('acervo_pecas',nova.id,teses); await registrarAuditoria({usuarioId:req.user.id,acao:'criar',entidade:'acervo_peca',entidadeId:nova.id,valorDepois:{teses,tipo:b.tipo_peca},ip:req._ip}); res.status(201).json({ok:true,peca:nova});
}catch(e){erro(res,e);} });

acervoRouter.post('/precedentes', apenasMaster, async (req,res) => { try {
  const b=req.body||{}; const teses=normalizarTeses(b.teses); await validarTeses(teses); validarEnum(b.ente,ENTES,'ente'); validarEnum(b.instancia,INSTANCIAS,'instancia',true); validarEnum(b.resultado,RESULTADOS,'resultado',true); if (!String(b.orgao||'').trim()||!String(b.ratio||'').trim()||!b.data_julgamento) { const e=new Error('Órgão, data de julgamento e fundamento são obrigatórios.');e.status=422;throw e; }
  const ctx=await processoContexto(b.processo_id); const [novo]=await db.query(`INSERT INTO acervo_precedentes (processo_id,processo_numero,orgao,tribunal,instancia,relator,data_julgamento,ente,ratio,ementa,resultado,favoravel,vinculante,conferido,fonte_primaria_url,drive_file_id,drive_url,visibilidade_snapshot,criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,false,$14,$15,$16,$17,$18) RETURNING *`,[b.processo_id||null,ctx.numero||b.processo_numero||null,b.orgao,b.tribunal||null,b.instancia,b.relator||null,b.data_julgamento,b.ente||null,b.ratio,b.ementa||null,b.resultado,Boolean(b.favoravel),Boolean(b.vinculante),b.fonte_primaria_url||null,b.drive_file_id||null,b.drive_url||null,ctx.visibilidade,req.user.id]); await gravarTeses('acervo_precedentes',novo.id,teses); await registrarAuditoria({usuarioId:req.user.id,acao:'criar',entidade:'acervo_precedente',entidadeId:novo.id,valorDepois:{teses,conferido:false},ip:req._ip}); res.status(201).json({ok:true,precedente:novo});
}catch(e){erro(res,e);} });

acervoRouter.patch('/precedentes/:id/conferir', apenasMaster, async (req,res)=>{ try { if(!uuidValido(req.params.id)) return res.status(400).json({ok:false,erro:'validacao',mensagem:'ID inválido.'}); const fonte=String(req.body?.fonte_primaria_url||'').trim(); if(!fonte) return res.status(422).json({ok:false,erro:'validacao',mensagem:'Informe a fonte primária conferida.'}); const [p]=await db.query(`UPDATE acervo_precedentes SET conferido=true,conferido_por=$1,conferido_em=NOW(),fonte_primaria_url=$2 WHERE id=$3${escopoVisibilidade(req,'acervo_precedentes')} RETURNING *`,[req.user.id,fonte,req.params.id]); if(!p)return res.status(404).json({ok:false,erro:'Não encontrado.'}); await registrarAuditoria({usuarioId:req.user.id,acao:'conferir',entidade:'acervo_precedente',entidadeId:p.id,valorDepois:{fonte},ip:req._ip});res.json({ok:true,precedente:p}); }catch(e){erro(res,e);} });

acervoRouter.patch('/pecas/:id/resultado', apenasMaster, async (req,res)=>{ try { if(!uuidValido(req.params.id)) return res.status(400).json({ok:false,erro:'validacao',mensagem:'ID inv\u00e1lido.'}); const b=req.body||{}; validarEnum(b.resultado,RESULTADOS,'resultado',true); const [p]=await db.query(`UPDATE acervo_pecas SET resultado=$1,resumo=COALESCE($2,resumo),atualizado_em=NOW() WHERE id=$3${escopoVisibilidade(req,'acervo_pecas')} RETURNING *`,[b.resultado,b.resumo||null,req.params.id]); if(!p) return res.status(404).json({ok:false,erro:'N\u00e3o encontrado.'}); await registrarAuditoria({usuarioId:req.user.id,acao:'atualizar',entidade:'acervo_peca',entidadeId:p.id,valorDepois:{resultado:b.resultado},ip:req._ip}); res.json({ok:true,peca:p}); }catch(e){erro(res,e);} });

for (const [tipo,tabela] of [['pecas','acervo_pecas'],['precedentes','acervo_precedentes']]) {
  acervoRouter.post(`/${tipo}/:id/arquivar`, apenasMaster, async(req,res)=>{if(!uuidValido(req.params.id))return res.status(400).json({ok:false,erro:'ID inválido.'});const [r]=await db.query(`UPDATE ${tabela} SET arquivada_em=NOW(),arquivada_por=$1 WHERE id=$2${escopoVisibilidade(req,tabela)} AND arquivada_em IS NULL RETURNING id`,[req.user.id,req.params.id]);if(!r)return res.status(404).json({ok:false,erro:'Registro não encontrado.'});await registrarAuditoria({usuarioId:req.user.id,acao:'arquivar',entidade:tabela,entidadeId:r.id,ip:req._ip});res.json({ok:true});});
  acervoRouter.post(`/${tipo}/:id/restaurar`, apenasMaster, async(req,res)=>{if(!uuidValido(req.params.id))return res.status(400).json({ok:false,erro:'ID inválido.'});const [r]=await db.query(`UPDATE ${tabela} SET arquivada_em=NULL,arquivada_por=NULL WHERE id=$1${escopoVisibilidade(req,tabela)} AND arquivada_em IS NOT NULL RETURNING id`,[req.params.id]);if(!r)return res.status(404).json({ok:false,erro:'Registro não encontrado.'});await registrarAuditoria({usuarioId:req.user.id,acao:'restaurar',entidade:tabela,entidadeId:r.id,ip:req._ip});res.json({ok:true});});
}
