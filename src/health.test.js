import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import { criarHealth } from './health.js';

// Sobe o handler de verdade num servidor Express local (porta efêmera), como faz mcp/index.test.js.
function servidorCom({ pronto, banco }) {
  const app = express();
  app.get('/health', criarHealth({ pronto, banco, env: 'test' }));
  const servidor = app.listen(0);
  servidores.push(servidor);
  return `http://127.0.0.1:${servidor.address().port}/health`;
}
const servidores = [];
after(() => servidores.forEach(s => s.close()));

const bancoOk = { async query() { return [{ '?column?': 1 }]; } };
const bancoCaido = { async query() { throw new Error('connection refused'); } };

test('/health: durante o boot (esquema não pronto) responde 503 e nem consulta o banco', async () => {
  let consultou = false;
  const url = servidorCom({ pronto: () => false, banco: { async query() { consultou = true; return []; } } });
  const resp = await fetch(url);
  assert.equal(resp.status, 503);
  assert.deepEqual(await resp.json(), { ok: false, db: false, iniciando: true, env: 'test' });
  assert.equal(consultou, false);
});

test('/health: pronto e banco respondendo devolve 200', async () => {
  const resp = await fetch(servidorCom({ pronto: () => true, banco: bancoOk }));
  assert.equal(resp.status, 200);
  assert.deepEqual(await resp.json(), { ok: true, db: true, env: 'test' });
});

test('/health: pronto mas banco caído devolve 503 (sem "iniciando")', async () => {
  const resp = await fetch(servidorCom({ pronto: () => true, banco: bancoCaido }));
  assert.equal(resp.status, 503);
  const corpo = await resp.json();
  assert.equal(corpo.ok, false);
  assert.equal(corpo.iniciando, undefined);
});

test('/health: acompanha a transição do boot (503 e depois 200 quando o esquema fica pronto)', async () => {
  let dbOk = false;
  const url = servidorCom({ pronto: () => dbOk, banco: bancoOk });
  assert.equal((await fetch(url)).status, 503);
  dbOk = true;
  assert.equal((await fetch(url)).status, 200);
});

test('railway.json: healthcheck em /health com prazo que cobre o boot completo (>= 120 s)', () => {
  const { deploy } = JSON.parse(readFileSync(new URL('../railway.json', import.meta.url), 'utf8'));
  assert.equal(deploy.healthcheckPath, '/health');
  assert.ok(deploy.healthcheckTimeout >= 120, `healthcheckTimeout=${deploy.healthcheckTimeout}`);
});

test('index.js: /health usa a prontidão (dbOk) e não há mais "conectou uma vez" que liberava 200 antes das migrações', () => {
  const fonte = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
  assert.match(fonte, /criarHealth\(\{ pronto: \(\) => dbOk, banco: db \}\)/);
  assert.doesNotMatch(fonte, /dbJaConectouUmaVez/);
});
