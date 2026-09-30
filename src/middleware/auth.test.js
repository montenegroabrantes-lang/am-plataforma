import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'segredo-de-teste';

const { autenticar, apenasMaster, apenasMaster01, exigirEscopo } = await import('./auth.js');
const { definirCarregador, carregadorEcoDoToken } = await import('./sessao.js');
// S-03: o `autenticar` consulta a conta no banco; aqui a "conta" é o que o próprio token diz (o teste da
// sessão revogável em si está em routes/auth.test.js).
definirCarregador(carregadorEcoDoToken);
const { normalizarEscopos, escoposDoToken, areaPermitidaAoToken, CONTA_SERVICO_EMAIL } = await import('../oauth/escopos.js');

// ── Helpers de mock req/res/next ──
function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b)   { this.body = b;       return this; },
  };
}
function mockNext() {
  const fn = () => { fn.chamado = true; };
  fn.chamado = false;
  return fn;
}

const tokenValido = (payload = { id: '1', perfil: 'master' }) =>
  jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });

// ── autenticar ──
test('autenticar: token válido no cookie → next() e req.user preenchido', async () => {
  const req = { cookies: { am_token: tokenValido({ id: '42', perfil: 'junior' }) }, headers: {} };
  const res = mockRes();
  const next = mockNext();

  await autenticar(req, res, next);

  assert.ok(next.chamado, 'next() deveria ter sido chamado');
  assert.equal(req.user.id, '42');
  assert.equal(req.user.perfil, 'junior');
});

test('autenticar: token válido no header Authorization → next()', async () => {
  const req = { cookies: {}, headers: { authorization: `Bearer ${tokenValido()}` } };
  const res = mockRes();
  const next = mockNext();

  await autenticar(req, res, next);

  assert.ok(next.chamado);
  assert.equal(res.statusCode, null, 'não deveria responder erro');
});

test('autenticar: sem token → 401 e next() NÃO chamado', async () => {
  const req = { cookies: {}, headers: {} };
  const res = mockRes();
  const next = mockNext();

  await autenticar(req, res, next);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.ok, false);
  assert.equal(next.chamado, false);
});

test('autenticar: token inválido → 401', async () => {
  const req = { cookies: { am_token: 'lixo.invalido.token' }, headers: {} };
  const res = mockRes();
  const next = mockNext();

  await autenticar(req, res, next);

  assert.equal(res.statusCode, 401);
  assert.equal(next.chamado, false);
});

test('autenticar: token expirado → 401', async () => {
  const expirado = jwt.sign({ id: '1' }, process.env.JWT_SECRET, { expiresIn: -10 });
  const req = { cookies: { am_token: expirado }, headers: {} };
  const res = mockRes();
  const next = mockNext();

  await autenticar(req, res, next);

  assert.equal(res.statusCode, 401);
});

// ── apenasMaster ──
test('apenasMaster: perfil master → next()', () => {
  const req = { user: { perfil: 'master' } };
  const res = mockRes();
  const next = mockNext();

  apenasMaster(req, res, next);

  assert.ok(next.chamado);
});

test('apenasMaster: perfil junior → 403', () => {
  const req = { user: { perfil: 'junior' } };
  const res = mockRes();
  const next = mockNext();

  apenasMaster(req, res, next);

  assert.equal(res.statusCode, 403);
  assert.equal(next.chamado, false);
});

// ── apenasMaster01 (pode marcar processo restrito) ──
test('apenasMaster01: pode_marcar_restrito=true → next()', () => {
  const req = { user: { pode_marcar_restrito: true } };
  const res = mockRes();
  const next = mockNext();

  apenasMaster01(req, res, next);

  assert.ok(next.chamado);
});

test('apenasMaster01: pode_marcar_restrito=false → 403', () => {
  const req = { user: { pode_marcar_restrito: false } };
  const res = mockRes();
  const next = mockNext();

  apenasMaster01(req, res, next);

  assert.equal(res.statusCode, 403);
  assert.equal(next.chamado, false);
});

// ── escopos do conector Claude (OAuth) ──
test('normalizarEscopos: aceita string OAuth, lista ou lixo e devolve só escopos válidos', () => {
  assert.deepEqual(normalizarEscopos('reprotocolo acervo'), ['acervo', 'reprotocolo']);
  assert.deepEqual(normalizarEscopos(['reprotocolo', 'reprotocolo', 'admin']), ['reprotocolo']);
  assert.deepEqual(normalizarEscopos(undefined), []);
  assert.deepEqual(normalizarEscopos('*'), []);
});

test('escoposDoToken: sessão do AM sem restrição; token antigo do conector = nenhum escopo (S-18: autenticar já o recusa)', () => {
  assert.equal(escoposDoToken({ id: '1', perfil: 'master', email: 'alguem@exemplo.com' }), null);
  assert.deepEqual(escoposDoToken({ id: 's', perfil: 'master', email: CONTA_SERVICO_EMAIL }), []);
  assert.deepEqual(escoposDoToken({ id: 's', perfil: 'master', escopos: ['reprotocolo', 'xyz'] }), ['reprotocolo']);
});

test('areaPermitidaAoToken: /mcp sempre; demais só pelo prefixo do escopo (sem casar prefixo parcial)', () => {
  assert.equal(areaPermitidaAoToken('/mcp', []), true);
  assert.equal(areaPermitidaAoToken('/api/reprotocolo', ['reprotocolo']), true);
  assert.equal(areaPermitidaAoToken('/api/reprotocolo', ['acervo']), false);
  assert.equal(areaPermitidaAoToken('/api/acervo', ['acervo']), true);
  assert.equal(areaPermitidaAoToken('/api/acervo-falso', ['acervo']), false);
  assert.equal(areaPermitidaAoToken('/api/tarefas', ['acervo', 'reprotocolo']), false);
});

test('autenticar: token com escopos fora da área do escopo → 403; sessão comum não é afetada', async () => {
  const comEscopo = tokenValido({ id: 's', perfil: 'master', escopos: ['acervo'] });
  const res = mockRes();
  const next = mockNext();
  await autenticar({ cookies: {}, headers: { authorization: `Bearer ${comEscopo}` }, baseUrl: '/api/clientes' }, res, next);
  assert.equal(res.statusCode, 403);
  assert.equal(next.chamado, false);

  const res2 = mockRes();
  const next2 = mockNext();
  await autenticar({ cookies: {}, headers: { authorization: `Bearer ${comEscopo}` }, baseUrl: '/api/acervo' }, res2, next2);
  assert.ok(next2.chamado);

  const res3 = mockRes();
  const next3 = mockNext();
  await autenticar({ cookies: { am_token: tokenValido() }, headers: {}, baseUrl: '/api/clientes' }, res3, next3);
  assert.ok(next3.chamado, 'sessão sem claim de escopo segue como antes');
});

test('exigirEscopo: sessão Master passa; conector sem o escopo → 403 com orientação; com escopo passa', () => {
  const middleware = exigirEscopo('reprotocolo');

  const next1 = mockNext();
  middleware({ user: { id: '1', perfil: 'master', email: 'dono@exemplo.com' } }, mockRes(), next1);
  assert.ok(next1.chamado);

  const res2 = mockRes();
  const next2 = mockNext();
  middleware({ user: { id: 's', perfil: 'master', email: CONTA_SERVICO_EMAIL } }, res2, next2);
  assert.equal(res2.statusCode, 403);
  assert.equal(res2.body.escopo_necessario, 'reprotocolo');
  assert.equal(next2.chamado, false);

  const next3 = mockNext();
  middleware({ user: { id: 's', perfil: 'master', escopos: ['acervo', 'reprotocolo'] } }, mockRes(), next3);
  assert.ok(next3.chamado);
});
