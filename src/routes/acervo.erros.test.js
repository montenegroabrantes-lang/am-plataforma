import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import 'express-async-errors';

// S-22 no Acervo: erro inesperado do banco não devolve mais `err.message` no campo `mensagem`;
// erro de validação (com `status`) continua com a mensagem em português.

const { db } = await import('../db/index.js');
db.queryOne = async () => { throw new Error('queryOne proibido'); };
db.execute = async () => ({ rowCount: 0, rows: [] });
let falhaDoBanco;
db.query = async () => { throw falhaDoBanco; };

const { acervoRouter } = await import('./acervo.js');
const { tratadorGlobalDeErros } = await import('../middleware/erros.js');

const ID = '11111111-1111-4111-8111-111111111111';
let servidor, base;
const consoleErrorOriginal = console.error;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'u', perfil: 'master', pode_marcar_restrito: true }; req._ip = '127.0.0.1'; next(); });
  app.use('/api/acervo', acervoRouter);
  app.use(tratadorGlobalDeErros);
  servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(async () => { console.error = consoleErrorOriginal; await new Promise(r => servidor.close(r)); });
beforeEach(() => { console.error = () => {}; falhaDoBanco = new Error('relation "acervo_precedentes" does not exist (senha=hunter2)'); });

const conferir = (corpo) => fetch(`${base}/api/acervo/precedentes/${ID}/conferir`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });

test('erro inesperado do banco → 500 `interno` com código, sem a mensagem do Postgres', async () => {
  const r = await conferir({ fonte_primaria_url: 'https://www.stf.jus.br/x' });
  const corpo = await r.json();
  assert.equal(r.status, 500);
  assert.equal(corpo.erro, 'interno');
  assert.match(corpo.mensagem, /^Erro interno\. Código [0-9A-F]{8}\.$/);
  assert.equal(JSON.stringify(corpo).includes('acervo_precedentes'), false);
  assert.equal(JSON.stringify(corpo).includes('hunter2'), false);
});

test('erro de validação continua com a mensagem em português (status 422)', async () => {
  const r = await conferir({});
  const corpo = await r.json();
  assert.equal(r.status, 422);
  assert.equal(corpo.erro, 'validacao');
  assert.match(corpo.mensagem, /fonte primária/);
});
