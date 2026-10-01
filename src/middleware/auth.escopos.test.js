// S-18: token da conta de serviço do conector SEM o claim `escopos` (emitido antes dos escopos
// de 28/09/2026) valeria como Master em toda a API. `autenticar` passa a recusá-lo com 401,
// em qualquer rota (incluindo /mcp), pedindo que o conector seja reconectado.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import { definirCarregador, carregadorEcoDoToken } from './sessao.js';
definirCarregador(carregadorEcoDoToken); // S-03: nestes testes a conta vale o que o token diz (sem banco)

process.env.JWT_SECRET = 'segredo-de-teste';

const { db } = await import('../db/index.js');
for (const metodo of ['query', 'queryOne', 'execute']) {
  db[metodo] = async () => { throw new Error('banco real proibido nos testes'); };
}
const { autenticar, exigirEscopo } = await import('./auth.js');
const { escoposDoToken, tokenConectorSemEscopos, CONTA_SERVICO_EMAIL } = await import('../oauth/escopos.js');
const { mcpRouter } = await import('../mcp/index.js');

const app = express();
app.use(express.json());
app.use('/api/usuarios', autenticar, (_req, res) => res.json({ ok: true, rota: 'usuarios' }));
app.use('/api/clientes', autenticar, (_req, res) => res.json({ ok: true, rota: 'clientes' }));
app.use('/api/acervo', autenticar, exigirEscopo('acervo'), (_req, res) => res.json({ ok: true, rota: 'acervo' }));
app.use('/api/reprotocolo', autenticar, exigirEscopo('reprotocolo'), (_req, res) => res.json({ ok: true, rota: 'reprotocolo' }));
app.use('/mcp', mcpRouter);
const servidor = app.listen(0);
const base = `http://127.0.0.1:${servidor.address().port}`;
after(() => servidor.close());

const assinar = (payload) => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
const SERVICO = { id: 'svc', nome: 'Integração Claude', email: CONTA_SERVICO_EMAIL, perfil: 'master' };
const TOKENS = {
  servicoSemEscopos: assinar(SERVICO),
  servicoEscoposTexto: assinar({ ...SERVICO, escopos: 'acervo' }), // claim que não é lista
  servicoAcervo: assinar({ ...SERVICO, escopos: ['acervo'] }),
  servicoReprotocolo: assinar({ ...SERVICO, escopos: ['reprotocolo'] }),
  servicoVazio: assinar({ ...SERVICO, escopos: [] }),
  sessao: assinar({ id: 'm1', nome: 'Master', email: 'master@exemplo.com', perfil: 'master' }),
};

const get = (caminho, token) => fetch(`${base}${caminho}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
const mcp = (token) => fetch(`${base}/mcp`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
});

test('S-18: token do conector sem escopos → 401 em qualquer área da API e no /mcp, com a orientação de reconectar', async () => {
  for (const caminho of ['/api/usuarios', '/api/clientes', '/api/acervo', '/api/reprotocolo']) {
    const r = await get(caminho, TOKENS.servicoSemEscopos);
    assert.equal(r.status, 401, caminho);
    const corpo = await r.json();
    assert.equal(corpo.ok, false);
    assert.match(corpo.erro, /reconecte o conector/i);
  }
  const r = await mcp(TOKENS.servicoSemEscopos);
  assert.equal(r.status, 401, '/mcp');
  assert.match((await r.json()).erro, /reconecte o conector/i);
});

test('S-18: claim `escopos` que não é lista também conta como "sem escopos"', async () => {
  assert.equal((await get('/api/usuarios', TOKENS.servicoEscoposTexto)).status, 401);
  assert.equal((await mcp(TOKENS.servicoEscoposTexto)).status, 401);
});

test('S-18: token do conector COM escopos continua funcionando: /mcp responde, áreas dos escopos passam, o resto é 403', async () => {
  const lista = await mcp(TOKENS.servicoAcervo);
  assert.equal(lista.status, 200);
  assert.match(await lista.text(), /listar_teses/);
  assert.equal((await mcp(TOKENS.servicoReprotocolo)).status, 200);

  assert.equal((await get('/api/acervo', TOKENS.servicoAcervo)).status, 200);
  assert.equal((await get('/api/reprotocolo', TOKENS.servicoReprotocolo)).status, 200);
  assert.equal((await get('/api/reprotocolo', TOKENS.servicoAcervo)).status, 403, 'sem o escopo da área');
  assert.equal((await get('/api/usuarios', TOKENS.servicoAcervo)).status, 403, 'fora dos escopos');
  assert.equal((await get('/api/clientes', TOKENS.servicoReprotocolo)).status, 403);
  assert.equal((await get('/api/usuarios', TOKENS.servicoVazio)).status, 403, 'lista vazia não abre nada além do /mcp');
  assert.equal((await mcp(TOKENS.servicoVazio)).status, 200);
});

test('S-18: sessão normal do AM (sem escopos, e-mail de pessoa) não é afetada; sem token segue 401', async () => {
  assert.equal((await get('/api/usuarios', TOKENS.sessao)).status, 200);
  assert.equal((await get('/api/clientes', TOKENS.sessao)).status, 200);
  assert.equal((await get('/api/acervo', TOKENS.sessao)).status, 200, 'sessão do AM passa em exigirEscopo');
  assert.equal((await get('/api/usuarios')).status, 401);
  assert.equal((await mcp()).status, 401);
});

test('S-18: tokenConectorSemEscopos identifica só a conta de serviço sem lista de escopos (e-mail sem distinção de maiúsculas)', () => {
  assert.equal(tokenConectorSemEscopos({ email: CONTA_SERVICO_EMAIL }), true);
  assert.equal(tokenConectorSemEscopos({ email: CONTA_SERVICO_EMAIL.toUpperCase() }), true);
  assert.equal(tokenConectorSemEscopos({ email: CONTA_SERVICO_EMAIL, escopos: [] }), false);
  assert.equal(tokenConectorSemEscopos({ email: CONTA_SERVICO_EMAIL, escopos: ['acervo'] }), false);
  assert.equal(tokenConectorSemEscopos({ email: 'master@exemplo.com' }), false);
  assert.equal(tokenConectorSemEscopos({}), false);
  assert.equal(tokenConectorSemEscopos(undefined), false);
});

test('S-18: escoposDoToken deixou de tratar o token sem escopos como "acervo" — falha fechada (nenhum escopo)', () => {
  assert.deepEqual(escoposDoToken({ email: CONTA_SERVICO_EMAIL }), []);
  assert.equal(escoposDoToken({ email: 'master@exemplo.com' }), null, 'sessão do AM: sem restrição');
  assert.deepEqual(escoposDoToken({ email: CONTA_SERVICO_EMAIL, escopos: ['reprotocolo', 'xyz'] }), ['reprotocolo']);
});
