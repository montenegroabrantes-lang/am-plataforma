import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'segredo-de-teste';

const { autenticar, apenasMaster, apenasMaster01 } = await import('./auth.js');

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
test('autenticar: token válido no cookie → next() e req.user preenchido', () => {
  const req = { cookies: { am_token: tokenValido({ id: '42', perfil: 'junior' }) }, headers: {} };
  const res = mockRes();
  const next = mockNext();

  autenticar(req, res, next);

  assert.ok(next.chamado, 'next() deveria ter sido chamado');
  assert.equal(req.user.id, '42');
  assert.equal(req.user.perfil, 'junior');
});

test('autenticar: token válido no header Authorization → next()', () => {
  const req = { cookies: {}, headers: { authorization: `Bearer ${tokenValido()}` } };
  const res = mockRes();
  const next = mockNext();

  autenticar(req, res, next);

  assert.ok(next.chamado);
  assert.equal(res.statusCode, null, 'não deveria responder erro');
});

test('autenticar: sem token → 401 e next() NÃO chamado', () => {
  const req = { cookies: {}, headers: {} };
  const res = mockRes();
  const next = mockNext();

  autenticar(req, res, next);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.ok, false);
  assert.equal(next.chamado, false);
});

test('autenticar: token inválido → 401', () => {
  const req = { cookies: { am_token: 'lixo.invalido.token' }, headers: {} };
  const res = mockRes();
  const next = mockNext();

  autenticar(req, res, next);

  assert.equal(res.statusCode, 401);
  assert.equal(next.chamado, false);
});

test('autenticar: token expirado → 401', () => {
  const expirado = jwt.sign({ id: '1' }, process.env.JWT_SECRET, { expiresIn: -10 });
  const req = { cookies: { am_token: expirado }, headers: {} };
  const res = mockRes();
  const next = mockNext();

  autenticar(req, res, next);

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
