// /mcp com a chave de integração do acervo (26/11/2026): Bearer am_live_… autentica pela chave,
// exige permissão do acervo, lista só as ferramentas do acervo e repassa a chave às rotas
// /api/integracoes/v1/acervo (que aplicam o recorte da chave). A API aqui é simulada.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createHash } from 'crypto';

process.env.JWT_SECRET = 'segredo-de-teste';

const app = express();
app.use(express.json());
const servidor = app.listen(0);
const porta = servidor.address().port;
after(() => servidor.close());
process.env.PORT = String(porta);

const CHAVES = { am_live_acervo: ['acervo_leitura', 'acervo_edicao'], am_live_processos: ['processos'] };
const hash = c => createHash('sha256').update(c).digest('hex');
const { db } = await import('../db/index.js');
db.query = async () => { throw new Error('banco real proibido nos testes'); };
db.queryOne = async (sql, params = []) => {
  if (!/FROM chaves_api_externas/.test(sql)) throw new Error('consulta inesperada');
  const [achada] = Object.entries(CHAVES).filter(([c]) => hash(c) === params[0]);
  return achada ? { id: 'chave-1', master_id: 'm1', permissoes: achada[1] } : null;
};
db.execute = async () => ({ rows: [] });

const { mcpRouter, FORA_DA_CHAVE } = await import('./index.js');

const recebidas = [];
const registrar = (req, res, corpo) => { recebidas.push({ metodo: req.method, caminho: req.originalUrl, chave: req.headers['x-am-api-key'], auth: req.headers.authorization, corpo: req.body }); res.json(corpo); };
app.get('/api/integracoes/v1/acervo/teses', (req, res) => registrar(req, res, { ok: true, teses: [{ slug: 'fgts-nulidade' }] }));
app.get('/api/integracoes/v1/acervo/', (req, res) => registrar(req, res, { ok: true, pecas: [], precedentes: [] }));
app.patch('/api/integracoes/v1/acervo/teses/:slug', (req, res) => registrar(req, res, { ok: true, tese: { slug: req.params.slug } }));
app.use('/api', (req, res) => registrar(req, res.status(418), { ok: false, erro: 'rota fora da integração chamada' }));
app.use('/mcp', mcpRouter);

let seq = 0;
async function rpc(chave, method, params = {}) {
  const r = await fetch(`http://127.0.0.1:${porta}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${chave}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method, params }),
  });
  const texto = await r.text();
  if (r.status !== 200) return { status: r.status, texto };
  const dados = texto.includes('data:')
    ? JSON.parse(texto.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5)).join(''))
    : JSON.parse(texto);
  return { status: r.status, dados };
}
const textoDe = r => JSON.parse(r.dados.result.content[0].text);

test('chave inexistente → 401; chave sem permissão do acervo → 403', async () => {
  assert.equal((await rpc('am_live_nao_existe', 'tools/list')).status, 401);
  assert.equal((await rpc('am_live_processos', 'tools/list')).status, 403);
});

test('lista as ferramentas do acervo e esconde Drive, prazos, protocolos, re-protocolo e WhatsApp', async () => {
  const { status, dados } = await rpc('am_live_acervo', 'tools/list');
  assert.equal(status, 200);
  const nomes = new Set(dados.result.tools.map(t => t.name));
  for (const n of ['listar_teses', 'buscar_acervo', 'criar_peca', 'atualizar_peca', 'criar_precedente', 'atualizar_precedente', 'conferir_precedente', 'criar_tese', 'atualizar_tese']) {
    assert.ok(nomes.has(n), n);
  }
  for (const n of FORA_DA_CHAVE) assert.ok(!nomes.has(n), `${n} não deveria aparecer`);
});

test('ferramentas chamam /api/integracoes/v1/acervo com a chave no X-AM-API-Key, nunca como Bearer', async () => {
  recebidas.length = 0;
  const r1 = await rpc('am_live_acervo', 'tools/call', { name: 'listar_teses', arguments: {} });
  assert.equal(r1.dados.result.isError, false);
  assert.equal(textoDe(r1).teses[0].slug, 'fgts-nulidade');
  const r2 = await rpc('am_live_acervo', 'tools/call', { name: 'buscar_acervo', arguments: { q: 'Tema 1308', aba: 'precedentes' } });
  assert.equal(r2.dados.result.isError, false);
  const r3 = await rpc('am_live_acervo', 'tools/call', { name: 'atualizar_tese', arguments: { slug: 'fgts-nulidade', label: 'FGTS — nulidade' } });
  assert.equal(r3.dados.result.isError, false);
  assert.deepEqual(recebidas.map(x => `${x.metodo} ${x.caminho.split('?')[0]}`), [
    'GET /api/integracoes/v1/acervo/teses',
    'GET /api/integracoes/v1/acervo/',
    'PATCH /api/integracoes/v1/acervo/teses/fgts-nulidade',
  ]);
  for (const x of recebidas) { assert.equal(x.chave, 'am_live_acervo'); assert.equal(x.auth, undefined); }
});

test('ferramenta de fora do acervo chamada pelo nome → erro, sem chamar a API', async () => {
  recebidas.length = 0;
  const r = await rpc('am_live_acervo', 'tools/call', { name: 'levantamento_reprotocolo', arguments: {} });
  assert.ok(r.dados.error || r.dados.result?.isError);
  assert.equal(recebidas.length, 0);
});
