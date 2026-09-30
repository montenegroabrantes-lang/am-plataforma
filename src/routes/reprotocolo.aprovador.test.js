// D-S4 / S-05 — quem aprova o pacote do re-protocolo: UNIÃO de REPROTOCOLO_APROVADORES (e-mail) com a marcação
// no cadastro (usuarios.aprova_reprotocolo). Aqui o `podeAprovar` é o de verdade (não é injetado); só o banco
// é um dublê. Nunca pode tirar acesso de quem aprova hoje (o Luciano, pela variável).
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'segredo-de-teste';
process.env.REPROTOCOLO_APROVADORES = 'luciano@x.com';
const { db } = await import('../db/index.js');
// Banco falso: só sabe responder à consulta da marcação (id → linha com marcação/ativo/perfil).
let cadastro = new Map();
db.queryOne = async (sql, params) => {
  assert.match(sql, /aprova_reprotocolo = true/, 'única consulta esperada');
  const u = cadastro.get(params[0]);
  return u && u.aprova_reprotocolo && u.ativo && u.perfil === 'master' ? { ok: 1 } : null;
};
db.query = db.execute = async () => { throw new Error('banco real proibido nos testes'); };
const { autenticar } = await import('../middleware/auth.js');
const { criarReprotocoloRouter } = await import('./reprotocolo.js');

const P1 = '55555555-5555-4555-8555-555555555555';
const aprovacoes = [];
const app = express();
app.use(express.json());
app.use('/api/reprotocolo', autenticar, criarReprotocoloRouter({
  auditar: async () => {}, limitador: (_q, _s, n) => n(), transacao: async (fn) => fn('tx'),
  verificar: async () => ({ hoje: '2026-09-30', resultados: [] }),
  pacotes: {
    porTarefas: async () => [],
    aprovar: async (a) => { aprovacoes.push(a); return { ok: true, pacote_id: P1, aprovacao: { valor_causa: 812.35, proposta_do_sistema: 812.35, acima_do_teto_ciente: false, valor_divergente_ciente: false } }; },
  },
}));
app.use((err, _req, res, _next) => res.status(500).json({ ok: false, erro: err.message }));
const servidor = app.listen(0);
const base = `http://127.0.0.1:${servidor.address().port}`;
after(() => servidor.close());

const assinar = p => jwt.sign(p, process.env.JWT_SECRET, { expiresIn: '1h' });
const TOKENS = {
  luciano: assinar({ id: 'u-lu', perfil: 'master', email: 'luciano@x.com' }),
  ana: assinar({ id: 'u-ana', perfil: 'master', email: 'ana@x.com' }),
  bia: assinar({ id: 'u-bia', perfil: 'master', email: 'bia@x.com' }),
  junior: assinar({ id: 'u-jr', perfil: 'junior', email: 'jr@x.com' }),
  conectorMarcado: assinar({ id: 'u-ana', perfil: 'master', email: 'ana@x.com', escopos: ['reprotocolo'] }),
};
async function chamar(metodo, caminho, token, corpo) {
  const r = await fetch(`${base}${caminho}`, { method: metodo, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(corpo ? { 'Content-Type': 'application/json' } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
  return { status: r.status, corpo: await r.json() };
}
const aprovar = (token) => chamar('POST', `/api/reprotocolo/pacotes/${P1}/aprovar`, token, { valor_causa: '812,35' });

beforeEach(() => {
  aprovacoes.length = 0;
  cadastro = new Map([
    ['u-ana', { aprova_reprotocolo: true, ativo: true, perfil: 'master' }],
    ['u-bia', { aprova_reprotocolo: false, ativo: true, perfil: 'master' }],
  ]);
});

test('o Luciano (só pela variável, sem marcação no cadastro) continua aprovando: a união nunca tira acesso', async () => {
  const r = await aprovar(TOKENS.luciano);
  assert.equal(r.status, 200);
  assert.equal(aprovacoes.length, 1);
  assert.equal(aprovacoes[0].usuarioId, 'u-lu');
});

test('quem foi marcado no cadastro (e-mail fora da variável) aprova', async () => {
  assert.equal((await aprovar(TOKENS.ana)).status, 200);
  assert.equal(aprovacoes.length, 1);
});

test('quem não está na variável nem marcado recebe 403 e a aprovação nem é chamada', async () => {
  const master = await aprovar(TOKENS.bia);
  assert.equal(master.status, 403);
  assert.match(master.corpo.erro, /aprovador designado/);
  const junior = await aprovar(TOKENS.junior); // o roteador inteiro já é só Master
  assert.equal(junior.status, 403);
  assert.equal(aprovacoes.length, 0);
});

test('marcado mas desativado (ou virou júnior) perde a aprovação', async () => {
  cadastro.set('u-ana', { aprova_reprotocolo: true, ativo: false, perfil: 'master' });
  assert.equal((await aprovar(TOKENS.ana)).status, 403);
  cadastro.set('u-ana', { aprova_reprotocolo: true, ativo: true, perfil: 'junior' });
  assert.equal((await aprovar(TOKENS.ana)).status, 403);
  assert.equal(aprovacoes.length, 0);
});

test('a lista de verificação informa pode_aprovar pela mesma regra (variável OU marcação)', async () => {
  assert.equal((await chamar('GET', '/api/reprotocolo/verificacao', TOKENS.luciano)).corpo.pode_aprovar, true);
  assert.equal((await chamar('GET', '/api/reprotocolo/verificacao', TOKENS.ana)).corpo.pode_aprovar, true);
  assert.equal((await chamar('GET', '/api/reprotocolo/verificacao', TOKENS.bia)).corpo.pode_aprovar, false);
});

test('o conector do chat nunca aprova, mesmo com a conta marcada (escrita só por sessão do AM)', async () => {
  assert.equal((await aprovar(TOKENS.conectorMarcado)).status, 403);
  assert.equal(aprovacoes.length, 0);
});
