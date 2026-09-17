import { Router } from 'express';
import { createHash, randomBytes } from 'crypto';
import { db } from '../db/index.js';
import { apenasMaster } from '../middleware/auth.js';
import { registrarAuditoria } from '../middleware/auditoria.js';

export const chavesApiRouter = Router();
const PERMISSOES_VALIDAS = new Set(['leitura', 'clientes', 'processos', 'estimativas', 'tarefas']);
const PREFIXO = 'am_live_';
const hashChave = chave => createHash('sha256').update(chave).digest('hex');
const rotuloChave = chave => `${chave.slice(0, 11)}••••••••${chave.slice(-4)}`;
const escopoMaster = req => req.user.master_id || req.user.id;

// Middleware reutilizável para futuras rotas públicas de integração.
// A chave nunca é registrada; somente o hash é comparado no banco.
export async function autenticarChaveExterna(req, res, next) {
  const chave = req.get('x-am-api-key') || req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!chave || !chave.startsWith(PREFIXO)) return res.status(401).json({ ok: false, erro: 'Chave de integração não fornecida.' });
  const registro = await db.queryOne(`SELECT * FROM chaves_api_externas WHERE chave_hash = $1 AND ativa = true AND (expira_em IS NULL OR expira_em > NOW())`, [hashChave(chave)]);
  if (!registro) return res.status(401).json({ ok: false, erro: 'Chave de integração inválida, revogada ou expirada.' });
  req.integracao = { id: registro.id, masterId: registro.master_id, permissoes: registro.permissoes || [] };
  db.execute('UPDATE chaves_api_externas SET ultimo_uso_em = NOW(), ultimo_uso_ip = $2 WHERE id = $1', [registro.id, req._ip]).catch(() => {});
  next();
}

chavesApiRouter.get('/', apenasMaster, async (req, res) => {
  const chaves = await db.query(`SELECT id, nome, descricao, prefixo, permissoes, ativa, expira_em, ultimo_uso_em, ultimo_uso_ip, criado_em FROM chaves_api_externas WHERE master_id = $1 ORDER BY criado_em DESC`, [escopoMaster(req)]);
  res.json({ ok: true, chaves });
});

chavesApiRouter.post('/', apenasMaster, async (req, res) => {
  const nome = String(req.body?.nome || '').trim();
  const descricao = String(req.body?.descricao || '').trim().slice(0, 500) || null;
  const permissoes = [...new Set((Array.isArray(req.body?.permissoes) ? req.body.permissoes : []).filter(p => PERMISSOES_VALIDAS.has(p)))];
  const expiraEm = req.body?.expira_em || null;
  if (nome.length < 3 || nome.length > 100) return res.status(400).json({ ok: false, erro: 'Informe um nome entre 3 e 100 caracteres.' });
  if (!permissoes.length) return res.status(400).json({ ok: false, erro: 'Selecione ao menos uma permissão.' });
  if (expiraEm && Number.isNaN(Date.parse(expiraEm))) return res.status(400).json({ ok: false, erro: 'Data de expiração inválida.' });
  const chave = `${PREFIXO}${randomBytes(32).toString('base64url')}`;
  const [registro] = await db.query(`INSERT INTO chaves_api_externas (master_id, nome, descricao, chave_hash, prefixo, permissoes, expira_em, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, nome, descricao, prefixo, permissoes, ativa, expira_em, criado_em`, [escopoMaster(req), nome, descricao, hashChave(chave), rotuloChave(chave), permissoes, expiraEm, req.user.id]);
  await registrarAuditoria({ usuarioId: req.user.id, acao: 'criar', entidade: 'chave_api_externa', entidadeId: registro.id, valorDepois: { nome, permissoes, expira_em: expiraEm }, ip: req._ip });
  // A chave em texto só é devolvida nesta resposta. Nunca é persistida.
  res.status(201).json({ ok: true, chave, registro });
});

// Edita metadados e escopo, sem nunca alterar/expor o segredo já emitido.
chavesApiRouter.patch('/:id', apenasMaster, async (req, res) => {
  const anterior = await db.queryOne(
    'SELECT id, nome, descricao, permissoes, expira_em, ativa FROM chaves_api_externas WHERE id = $1 AND master_id = $2',
    [req.params.id, escopoMaster(req)]
  );
  if (!anterior) return res.status(404).json({ ok: false, erro: 'Chave não encontrada.' });
  if (!anterior.ativa) return res.status(400).json({ ok: false, erro: 'Uma chave revogada não pode ser editada. Crie outra se precisar reativar a integração.' });
  const nome = String(req.body?.nome ?? anterior.nome).trim();
  const descricao = String(req.body?.descricao ?? anterior.descricao ?? '').trim().slice(0, 500) || null;
  const permissoes = [...new Set((Array.isArray(req.body?.permissoes) ? req.body.permissoes : anterior.permissoes).filter(p => PERMISSOES_VALIDAS.has(p)))];
  const expiraEm = req.body?.expira_em === '' ? null : (req.body?.expira_em ?? anterior.expira_em);
  if (nome.length < 3 || nome.length > 100) return res.status(400).json({ ok: false, erro: 'Informe um nome entre 3 e 100 caracteres.' });
  if (!permissoes.length) return res.status(400).json({ ok: false, erro: 'Selecione ao menos uma permissão.' });
  if (expiraEm && Number.isNaN(Date.parse(expiraEm))) return res.status(400).json({ ok: false, erro: 'Data de expiração inválida.' });
  const [chave] = await db.query(
    `UPDATE chaves_api_externas SET nome = $3, descricao = $4, permissoes = $5, expira_em = $6
     WHERE id = $1 AND master_id = $2
     RETURNING id, nome, descricao, prefixo, permissoes, ativa, expira_em, ultimo_uso_em, ultimo_uso_ip, criado_em`,
    [req.params.id, escopoMaster(req), nome, descricao, permissoes, expiraEm]
  );
  await registrarAuditoria({ usuarioId: req.user.id, acao: 'editar', entidade: 'chave_api_externa', entidadeId: chave.id, valorAntes: anterior, valorDepois: { nome, descricao, permissoes, expira_em: expiraEm }, ip: req._ip });
  res.json({ ok: true, chave });
});

chavesApiRouter.patch('/:id/revogar', apenasMaster, async (req, res) => {
  const anterior = await db.queryOne('SELECT id, nome, ativa FROM chaves_api_externas WHERE id = $1 AND master_id = $2', [req.params.id, escopoMaster(req)]);
  if (!anterior) return res.status(404).json({ ok: false, erro: 'Chave não encontrada.' });
  if (!anterior.ativa) return res.json({ ok: true, mensagem: 'A chave já estava revogada.' });
  await db.execute('UPDATE chaves_api_externas SET ativa = false, revogada_em = NOW(), revogada_por = $3 WHERE id = $1 AND master_id = $2', [req.params.id, escopoMaster(req), req.user.id]);
  await registrarAuditoria({ usuarioId: req.user.id, acao: 'revogar', entidade: 'chave_api_externa', entidadeId: req.params.id, valorAntes: { nome: anterior.nome, ativa: true }, valorDepois: { ativa: false }, ip: req._ip });
  res.json({ ok: true });
});
