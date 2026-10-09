// Ferramentas MCP: confere a "fiação" — cada ferramenta chama a rota certa da própria API,
// com os parâmetros certos e o MESMO token recebido (é a rota que aplica Master/escopo/
// auditoria; ver src/routes/reprotocolo.test.js). A API aqui é simulada no mesmo processo.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';

process.env.JWT_SECRET = 'segredo-de-teste';

const app = express();
app.use(cookieParser()); // como no index.js: o cookie am_token chega ao autenticar se o /mcp deixar
app.use(express.json());
const servidor = app.listen(0);
const porta = servidor.address().port;
after(() => servidor.close());
// O servidor MCP monta a URL da API a partir de PORT no carregamento do módulo.
process.env.PORT = String(porta);

const { db } = await import('../db/index.js');
for (const metodo of ['query', 'queryOne', 'execute']) {
  db[metodo] = async () => { throw new Error('banco real proibido nos testes'); };
}
const { mcpRouter, enxugar } = await import('./index.js');
const { definirCarregador, carregadorEcoDoToken } = await import('../middleware/sessao.js');
definirCarregador(carregadorEcoDoToken); // S-03: a conta é a que o token diz (sessão revogável testada em auth.test.js)

const recebidas = [];
app.get('/api/reprotocolo/levantamento', (req, res) => {
  recebidas.push({ caminho: req.path, query: req.query, auth: req.headers.authorization });
  res.json({ ok: true, somente_leitura: true, prontos: { total: 2 }, aguardando_autorizacao: { total: 364 } });
});
app.get('/api/reprotocolo/:id/vinculo-oficial', (req, res) => {
  recebidas.push({ caminho: req.path, query: req.query, auth: req.headers.authorization });
  if (req.params.id.startsWith('22222222')) return res.status(404).json({ ok: false, erro: 'Tarefa não encontrada' });
  res.json({ ok: true, status: 'sem_fonte_oficial' });
});
app.get('/api/acervo/teses', (req, res) => {
  recebidas.push({ caminho: req.path, auth: req.headers.authorization });
  res.json({ ok: true, teses: [] });
});
app.get('/api/comunicacao/localizar', (req, res) => {
  recebidas.push({ caminho: req.path, query: req.query, auth: req.headers.authorization });
  res.json({ ok: true, processos: [], clientes: [], contatos_digisac: [] });
});
app.post('/api/comunicacao/enviar', (req, res) => {
  recebidas.push({ caminho: req.path, corpo: req.body, auth: req.headers.authorization });
  res.json({ ok: true, status: 'enviado' });
});
app.use('/mcp', mcpRouter);

const token = jwt.sign({ id: 'svc', perfil: 'master', escopos: ['acervo', 'reprotocolo'] }, process.env.JWT_SECRET, { expiresIn: '1h' });

let seq = 0;
async function rpc(method, params = {}, { comToken = true } = {}) {
  const r = await fetch(`http://127.0.0.1:${porta}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(comToken ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method, params }),
  });
  const texto = await r.text();
  if (r.status !== 200) return { status: r.status, texto };
  const dados = texto.includes('data:')
    ? JSON.parse(texto.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5)).join(''))
    : JSON.parse(texto);
  return { status: r.status, dados };
}

const chamarFerramenta = (name, args) => rpc('tools/call', { name, arguments: args });
const textoDe = resposta => JSON.parse(resposta.dados.result.content[0].text);

test('/mcp sem token → 401', async () => {
  assert.equal((await rpc('tools/list', {}, { comToken: false })).status, 401);
});

test('/mcp só com o cookie de sessão (sem Bearer) → 401: rota isenta da checagem de Origin não aceita cookie', async () => {
  const chamar = (headers) => fetch(`http://127.0.0.1:${porta}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 900, method: 'tools/list', params: {} }),
  });
  assert.equal((await chamar({ Cookie: `am_token=${token}` })).status, 401);
  assert.equal((await chamar({ Cookie: `am_token=${token}`, Authorization: 'Basic abc' })).status, 401);
  // Com cookie E Bearer válido, vale o Bearer (o cookie é ignorado).
  assert.equal((await chamar({ Cookie: 'am_token=lixo', Authorization: `Bearer ${token}` })).status, 200);
});

test('lista as ferramentas novas como somente leitura, sem perder as do acervo', async () => {
  const { dados } = await rpc('tools/list');
  const ferramentas = Object.fromEntries(dados.result.tools.map(t => [t.name, t]));
  for (const nome of ['listar_teses', 'buscar_acervo', 'criar_peca', 'atualizar_resultado_peca', 'criar_precedente', 'conferir_precedente']) {
    assert.ok(ferramentas[nome], nome);
  }
  assert.equal(ferramentas.levantamento_reprotocolo.annotations.readOnlyHint, true);
  assert.equal(ferramentas.conferir_vinculo_oficial.annotations.readOnlyHint, true);
  assert.equal(ferramentas.conferir_vinculo_oficial.inputSchema.properties.tarefa_ids.maxItems, 5);
  assert.equal(ferramentas.salvar_documento_drive.annotations.readOnlyHint, false);
  assert.deepEqual(ferramentas.salvar_peca_drive.inputSchema.required.sort(), ['blocos', 'nome', 'pasta_id']);
  assert.deepEqual(ferramentas.salvar_documento_drive.inputSchema.required.sort(), ['html', 'nome', 'pasta_id']);
});

test('levantamento_reprotocolo: padrão = resumo; repassa o mesmo token', async () => {
  recebidas.length = 0;
  const r = await chamarFerramenta('levantamento_reprotocolo', {});
  assert.equal(r.dados.result.isError, false);
  assert.equal(textoDe(r).prontos.total, 2);
  assert.equal(recebidas[0].caminho, '/api/reprotocolo/levantamento');
  assert.deepEqual(recebidas[0].query, { detalhe: 'resumo' });
  assert.equal(recebidas[0].auth, `Bearer ${token}`);
});

test('levantamento_reprotocolo: modo itens leva ente, seção e limite (20 por padrão)', async () => {
  recebidas.length = 0;
  await chamarFerramenta('levantamento_reprotocolo', { detalhe: 'itens', ente: 'Paraíba', secao: 'aguardando' });
  assert.deepEqual(recebidas[0].query, { secao: 'aguardando', detalhe: 'itens', ente: 'Paraíba', limite: '20' });
});

test('conferir_vinculo_oficial: um por vez, sem repetir id, e mostra o HTTP de cada caso', async () => {
  recebidas.length = 0;
  const a = '11111111-1111-4111-8111-111111111111';
  const b = '22222222-2222-4222-8222-222222222222';
  const r = await chamarFerramenta('conferir_vinculo_oficial', { tarefa_ids: [a, b, a], atualizar: true });
  assert.deepEqual(recebidas.map(x => x.caminho), [`/api/reprotocolo/${a}/vinculo-oficial`, `/api/reprotocolo/${b}/vinculo-oficial`]);
  assert.deepEqual(recebidas[0].query, { atualizar: '1' });
  const { resultados } = textoDe(r);
  assert.deepEqual(resultados.map(x => x.http), [200, 404]);
  assert.equal(r.dados.result.isError, false, 'só é erro quando todos falham');
});

test('conferir_vinculo_oficial: mais de 5 casos é recusado antes de chamar a API', async () => {
  recebidas.length = 0;
  const ids = Array.from({ length: 6 }, (_, i) => `1111111${i}-1111-4111-8111-111111111111`);
  const r = await chamarFerramenta('conferir_vinculo_oficial', { tarefa_ids: ids });
  assert.ok(r.dados.error || r.dados.result?.isError, 'deve falhar na validação');
  assert.equal(recebidas.length, 0);
});

test('ferramentas do acervo continuam chamando /api/acervo', async () => {
  recebidas.length = 0;
  await chamarFerramenta('listar_teses', {});
  assert.equal(recebidas[0].caminho, '/api/acervo/teses');
});

test('localizar_cliente (leitura) e enviar_whatsapp_cliente (escrita) chamam /api/comunicacao com o mesmo token', async () => {
  const { dados } = await rpc('tools/list');
  const ferramentas = Object.fromEntries(dados.result.tools.map(t => [t.name, t]));
  assert.equal(ferramentas.localizar_cliente.annotations.readOnlyHint, true);
  assert.equal(ferramentas.enviar_whatsapp_cliente.annotations.readOnlyHint, false);
  assert.deepEqual(ferramentas.enviar_whatsapp_cliente.inputSchema.required, ['texto']);

  recebidas.length = 0;
  await chamarFerramenta('localizar_cliente', { processo: '0809017-10.2024.8.15.2001' });
  assert.equal(recebidas[0].caminho, '/api/comunicacao/localizar');
  assert.deepEqual(recebidas[0].query, { processo: '0809017-10.2024.8.15.2001' });
  assert.equal(recebidas[0].auth, `Bearer ${token}`);

  recebidas.length = 0;
  const cliente = '33333333-3333-4333-8333-333333333333';
  const r = await chamarFerramenta('enviar_whatsapp_cliente', { cliente_id: cliente, texto: 'Olá' });
  assert.equal(r.dados.result.isError, false);
  assert.equal(recebidas[0].caminho, '/api/comunicacao/enviar');
  assert.deepEqual(recebidas[0].corpo, { cliente_id: cliente, texto: 'Olá' });
});

test('enxugar: remove null e listas vazias, mas mantém false e 0 (carregam informação)', () => {
  assert.deepEqual(
    enxugar({ a: null, b: [], c: false, d: 0, e: { f: null, g: [{ h: undefined, i: 'x' }] }, j: '' }),
    { c: false, d: 0, e: { g: [{ i: 'x' }] }, j: '' },
  );
});
