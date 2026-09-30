import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';
import 'express-async-errors';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { definirCarregador, carregadorEcoDoToken } from '../middleware/sessao.js';
definirCarregador(carregadorEcoDoToken); // S-03: nestes testes a conta vale o que o token diz (sem banco)

// S-22 — /oauth/token não devolve mais a mensagem crua do erro (ela citava a conta de serviço):
// responde só `server_error`, e o detalhe vai para o log com um código. O fluxo do conector
// (register → authorize → token) continua funcionando quando a conta de serviço existe.
// Banco = dublê; nenhuma rede.

process.env.JWT_SECRET = 'segredo-de-teste';

const { db } = await import('../db/index.js');
const { oauthRouter } = await import('./index.js');
const { tratadorGlobalDeErros } = await import('../middleware/erros.js');
const { CONTA_SERVICO_EMAIL } = await import('./escopos.js');

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const MASTER = { id: '11111111-1111-4111-8111-111111111111', nome: 'Master Teste', email: 'master@exemplo.invalid', perfil: 'master', master_id: null, pode_marcar_restrito: true };

let contaDeServico, servidor, base, saidaDoLog;
const consoleOriginal = { error: console.error, log: console.log };

before(async () => {
  MASTER.senha_hash = await bcrypt.hash('SenhaCerta#2026', 4);
  db.queryOne = async (sql, params) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('SELECT * FROM usuarios WHERE email = $1 AND ativo = true')) {
      if (params[0] === MASTER.email) return MASTER;
      if (params[0] === CONTA_SERVICO_EMAIL) return contaDeServico;
      return null;
    }
    throw new Error(`consulta inesperada: ${s.slice(0, 80)}`);
  };
  db.execute = async () => ({ rowCount: 1 });
  db.query = async () => { throw new Error('banco real proibido nos testes'); };

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use((req, _res, next) => { req._ip = '203.0.113.9'; next(); });
  app.use(oauthRouter);
  app.use(tratadorGlobalDeErros);
  servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(async () => { Object.assign(console, consoleOriginal); await new Promise(r => servidor.close(r)); });
beforeEach(() => {
  contaDeServico = null; saidaDoLog = [];
  console.error = (...a) => { saidaDoLog.push(a.join(' ')); };
  console.log = () => {};
});

// register → authorize (login do Master) → devolve { client_id, code, verifier }
async function obterCodigo() {
  const registro = await (await fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [REDIRECT], client_name: 'Claude' }) })).json();
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const corpo = new URLSearchParams({
    client_id: registro.client_id, redirect_uri: REDIRECT, response_type: 'code', state: 'abc',
    code_challenge: challenge, code_challenge_method: 'S256', email: MASTER.email, senha: 'SenhaCerta#2026', escopos: 'acervo',
  });
  const r = await fetch(`${base}/oauth/authorize`, { method: 'POST', body: corpo, redirect: 'manual' });
  assert.equal(r.status, 302);
  const code = new URL(r.headers.get('location')).searchParams.get('code');
  assert.ok(code);
  return { client_id: registro.client_id, code, verifier };
}
const trocar = ({ client_id, code, verifier }) => fetch(`${base}/oauth/token`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ grant_type: 'authorization_code', client_id, redirect_uri: REDIRECT, code, code_verifier: verifier }),
});

test('conta de serviço ausente: 500 `server_error` SEM descrição; o detalhe fica só no log, com código', async () => {
  const pedido = await obterCodigo();
  const r = await trocar(pedido);
  const corpo = await r.json();
  assert.equal(r.status, 500);
  assert.deepEqual(corpo, { error: 'server_error' });
  assert.equal(JSON.stringify(corpo).includes('integracao-claude'), false);
  const linha = saidaDoLog.find(l => /^\[ERROR\] codigo=[0-9A-F]{8} /.test(l));
  assert.ok(linha, 'o erro completo vai para o log com código');
  assert.match(linha, /Conta de serviço integracao-claude não encontrada/);
});

test('conta de serviço presente: o conector continua recebendo o token (fluxo inteiro)', async () => {
  contaDeServico = { ...MASTER, id: '99999999-9999-4999-8999-999999999999', email: CONTA_SERVICO_EMAIL };
  const pedido = await obterCodigo();
  const r = await trocar(pedido);
  const corpo = await r.json();
  assert.equal(r.status, 200);
  assert.equal(corpo.token_type, 'Bearer');
  assert.equal(corpo.scope, 'acervo');
  const payload = jwt.verify(corpo.access_token, process.env.JWT_SECRET);
  assert.deepEqual(payload.escopos, ['acervo']);
});

test('erros de validação do /oauth/token continuam com a descrição (são do cliente, não do servidor)', async () => {
  const r = await fetch(`${base}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'authorization_code', code: 'invalido' }) });
  const corpo = await r.json();
  assert.equal(r.status, 400);
  assert.equal(corpo.error, 'invalid_grant');
  assert.match(corpo.error_description, /inválido ou expirado/);
});
