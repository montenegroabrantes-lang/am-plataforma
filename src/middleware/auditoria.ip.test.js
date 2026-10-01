// `auditar` grava req.ip (que segue o `trust proxy`), não o primeiro valor do X-Forwarded-For,
// que é escrito pelo próprio cliente (S-02, item 3a; S-13, item 1).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

const { auditar } = await import('./auditoria.js');

test('auditar: usa req.ip quando existe', () => {
  const req = { ip: '203.0.113.5', headers: { 'x-forwarded-for': '1.1.1.1, 203.0.113.5' }, socket: { remoteAddress: '10.0.0.1' } };
  auditar(req, {}, () => {});
  assert.equal(req._ip, '203.0.113.5');
});

test('auditar: sem req.ip cai no endereço da conexão (nunca no cabeçalho escrito pelo cliente)', () => {
  const req = { headers: { 'x-forwarded-for': '1.1.1.1' }, socket: { remoteAddress: '10.0.0.1' } };
  auditar(req, {}, () => {});
  assert.equal(req._ip, '10.0.0.1');
});

const app = express();
app.set('trust proxy', 1); // como em index.js
app.use(auditar);
app.get('/ip', (req, res) => res.json({ ip: req._ip }));
const servidor = app.listen(0);
after(() => servidor.close());

test('auditar com trust proxy 1: o cabeçalho forjado pelo cliente não vira o IP gravado', async () => {
  const r = await fetch(`http://127.0.0.1:${servidor.address().port}/ip`, { headers: { 'X-Forwarded-For': '9.9.9.9, 203.0.113.77' } });
  assert.equal((await r.json()).ip, '203.0.113.77', 'vale o valor acrescentado pelo proxy (o último), não o primeiro');
});
