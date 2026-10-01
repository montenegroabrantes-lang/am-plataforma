// S-23 no conector MCP: as ferramentas que gravam links no acervo só aceitam https://.
// A ferramenta recusa antes de chamar a API (a rota do acervo também confere e devolve 422).
// Harness igual ao de index.test.js: a API é simulada no mesmo processo.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import { definirCarregador, carregadorEcoDoToken } from '../middleware/sessao.js';
definirCarregador(carregadorEcoDoToken); // S-03: nestes testes a conta vale o que o token diz (sem banco)

process.env.JWT_SECRET = 'segredo-de-teste';

const app = express();
app.use(express.json());
const servidor = app.listen(0);
const porta = servidor.address().port;
after(() => servidor.close());
process.env.PORT = String(porta);

const { db } = await import('../db/index.js');
for (const metodo of ['query', 'queryOne', 'execute']) {
  db[metodo] = async () => { throw new Error('banco real proibido nos testes'); };
}
const { mcpRouter } = await import('./index.js');

const recebidas = [];
app.post('/api/acervo/pecas', (req, res) => { recebidas.push({ caminho: req.path, corpo: req.body }); res.status(201).json({ ok: true }); });
app.post('/api/acervo/precedentes', (req, res) => { recebidas.push({ caminho: req.path, corpo: req.body }); res.status(201).json({ ok: true }); });
app.patch('/api/acervo/precedentes/:id/conferir', (req, res) => { recebidas.push({ caminho: req.path, corpo: req.body }); res.json({ ok: true }); });
app.use('/mcp', mcpRouter);

const token = jwt.sign({ id: 'svc', perfil: 'master', escopos: ['acervo'] }, process.env.JWT_SECRET, { expiresIn: '1h' });

let seq = 0;
async function rpc(method, params = {}) {
  const r = await fetch(`http://127.0.0.1:${porta}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method, params }),
  });
  const texto = await r.text();
  const dados = texto.includes('data:')
    ? JSON.parse(texto.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5)).join(''))
    : JSON.parse(texto);
  return { status: r.status, dados };
}
const chamar = (name, args) => rpc('tools/call', { name, arguments: args });
const falhou = r => Boolean(r.dados.error || r.dados.result?.isError);

const PECA = { teses: ['fgts'], titulo: 'Peça de teste', tipo_peca: 'inicial', ente: 'estado-paraiba', instancia: '1grau' };
const PRECEDENTE = { teses: ['fgts'], orgao: 'Turma Recursal', instancia: 'turma-recursal', data_julgamento: '2026-09-01', ratio: 'Fundamento fictício.', resultado: 'provido', favoravel: true };
const ID = '66666666-6666-4666-8666-666666666666';
const RUINS = ['javascript:alert(1)', 'data:text/html,x', 'http://exemplo.test/x', 'ftp://exemplo.test/x', 'exemplo.test/x', 'https://u:p@exemplo.test/'];

test('as ferramentas continuam listadas, com os campos de link', async () => {
  const { dados } = await rpc('tools/list');
  const f = Object.fromEntries(dados.result.tools.map(t => [t.name, t]));
  assert.ok(f.criar_peca.inputSchema.properties.drive_url);
  assert.ok(f.criar_precedente.inputSchema.properties.fonte_primaria_url);
  assert.ok(f.conferir_precedente.inputSchema.required.includes('fonte_primaria_url'));
});

test('criar_peca: drive_url fora de https é recusado sem chamar a API; https e vazio passam', async () => {
  recebidas.length = 0;
  for (const ruim of RUINS) assert.ok(falhou(await chamar('criar_peca', { ...PECA, drive_url: ruim })), ruim);
  assert.equal(recebidas.length, 0);

  const ok = await chamar('criar_peca', { ...PECA, drive_url: 'https://drive.google.com/file/d/abc/view' });
  assert.equal(falhou(ok), false);
  assert.equal(recebidas.at(-1).corpo.drive_url, 'https://drive.google.com/file/d/abc/view');

  assert.equal(falhou(await chamar('criar_peca', { ...PECA, drive_url: '' })), false, 'vazio = sem link');
  assert.equal(falhou(await chamar('criar_peca', PECA)), false, 'ausente = sem link');
});

test('criar_precedente: fonte_primaria_url e drive_url fora de https são recusados', async () => {
  recebidas.length = 0;
  for (const ruim of RUINS) {
    assert.ok(falhou(await chamar('criar_precedente', { ...PRECEDENTE, fonte_primaria_url: ruim })), `fonte ${ruim}`);
    assert.ok(falhou(await chamar('criar_precedente', { ...PRECEDENTE, drive_url: ruim })), `drive ${ruim}`);
  }
  assert.equal(recebidas.length, 0);
  assert.equal(falhou(await chamar('criar_precedente', { ...PRECEDENTE, fonte_primaria_url: 'https://www.stf.jus.br/x', drive_url: 'https://drive.google.com/y' })), false);
  assert.equal(recebidas.length, 1);
});

test('conferir_precedente: URL obrigatória e só https', async () => {
  recebidas.length = 0;
  for (const ruim of [...RUINS, '']) assert.ok(falhou(await chamar('conferir_precedente', { id: ID, fonte_primaria_url: ruim })), JSON.stringify(ruim));
  assert.ok(falhou(await chamar('conferir_precedente', { id: ID })));
  assert.equal(recebidas.length, 0);
  const ok = await chamar('conferir_precedente', { id: ID, fonte_primaria_url: 'https://www.stf.jus.br/processos/1' });
  assert.equal(falhou(ok), false);
  assert.deepEqual(recebidas[0].corpo, { fonte_primaria_url: 'https://www.stf.jus.br/processos/1' });
});
