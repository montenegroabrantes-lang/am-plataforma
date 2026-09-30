// S-20 — limites de taxa por usuário / por integração:
//   IA paga (classificar, diagnosticar, testar provedor): só Master + 20 por hora por usuário, contador por rota;
//   /mcp: 60 por minuto por Master que autorizou o conector (autorizado_por, NÃO o id da conta de serviço);
//   /api/integracoes: 120 por minuto por IP — a Camila (chave de API) NÃO pode ser afetada;
//   /oauth/token, /oauth/register e /api/webhook: por IP.
// Sem banco real, sem IA real, sem rede: db e ai são dublês.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import 'express-async-errors';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'segredo-de-teste';
process.env.CAMILA_CLIENT_LOOKUP_API_KEY = 'chave-camila-de-teste';

const { db } = await import('../db/index.js');
db.query = async () => [];                     // nenhum cliente encontrado
db.queryOne = async () => null;                // processo / movimentação inexistente (404 barato)
db.execute = async () => { throw new Error('gravação inesperada'); };
const { ai } = await import('../services/ai/index.js');
ai.classificar = ai.diagnosticar = async () => { throw new Error('IA real proibida nos testes'); };

const { autenticar } = await import('../middleware/auth.js');
const { processosRouter } = await import('./processos.js');
const { movimentacoesRouter } = await import('./movimentacoes.js');
const { configAiRouter } = await import('./config.ai.js');
const { autenticarIntegracaoCamila, integracaoCamilaRouter } = await import('./integracaoCamila.js');
const { limiteMcp, limiteIntegracoes, limiteWebhook, limiteOauthToken, limiteOauthRegistro, chaveMcp } = await import('../middleware/limites.js');

const app = express();
app.set('trust proxy', 1); // como em produção: o IP do cliente vem do X-Forwarded-For do proxy
app.use(express.json());
app.use('/api/processos', autenticar, processosRouter);
app.use('/api/movimentacoes', autenticar, movimentacoesRouter);
app.use('/api/config/ai', autenticar, configAiRouter);
// mesma ordem de montagem do index.js: limitador ANTES do roteador
app.use('/api/integracoes', limiteIntegracoes);
app.use('/api/integracoes/camila', autenticarIntegracaoCamila, integracaoCamilaRouter);
app.use('/api/webhook', limiteWebhook);
app.post('/api/webhook/datajud', (_req, res) => res.json({ ok: true }));
app.use('/mcp', limiteMcp, autenticar, (_req, res) => res.json({ ok: true }));
app.use('/oauth/token', limiteOauthToken);
app.use('/oauth/register', limiteOauthRegistro);
app.all('/oauth/token', (_req, res) => res.status(400).json({ error: 'invalid_grant' }));
app.all('/oauth/register', (_req, res) => res.status(201).json({ client_id: 'x' }));
app.use((err, _req, res, _next) => res.status(500).json({ ok: false, erro: err.message }));
const servidor = app.listen(0);
const base = `http://127.0.0.1:${servidor.address().port}`;
after(() => servidor.close());

const assinar = p => jwt.sign(p, process.env.JWT_SECRET, { expiresIn: '1h' });
const T = {
  master: assinar({ id: 'm1', perfil: 'master', email: 'master@exemplo.com' }),
  outroMaster: assinar({ id: 'm2', perfil: 'master', email: 'outro@exemplo.com' }),
  junior: assinar({ id: 'j1', perfil: 'junior', email: 'junior@exemplo.com' }),
};
const SERVICO = '99999999-9999-4999-8999-999999999999';
const conector = (autorizadoPor) => assinar({ id: SERVICO, perfil: 'master', email: 'integracao-claude@abrantesemontenegro.com.br', escopos: ['acervo'], autorizado_por: autorizadoPor });

async function chamar(metodo, caminho, token, { corpo, ip, cabecalhos } = {}) {
  const r = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(corpo ? { 'Content-Type': 'application/json' } : {}),
      ...(ip ? { 'X-Forwarded-For': ip } : {}),
      ...cabecalhos,
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await r.text();
  let corpoResp; try { corpoResp = JSON.parse(texto); } catch { corpoResp = texto; }
  return { status: r.status, corpo: corpoResp, cabecalhos: r.headers };
}
// n chamadas em sequência; devolve os status
async function repetir(n, fn) { const s = []; for (let i = 0; i < n; i++) s.push((await fn(i)).status); return s; }

const PID = '11111111-1111-4111-8111-111111111111';
const MID = '22222222-2222-4222-8222-222222222222';
const rotasIA = {
  classificar: (t) => chamar('POST', `/api/processos/${PID}/classificar`, t),
  diagnosticar: (t) => chamar('POST', `/api/movimentacoes/${MID}/diagnosticar`, t),
  testar: (t) => chamar('GET', '/api/config/ai/test?provider=inexistente', t), // 400 sem chamar provedor
};

// ───────────────────────────── IA: só Master + 20/h por usuário ─────────────────────────────
test('IA: júnior → 403 nas três rotas pagas (antes do limitador e sem consumir o balde de ninguém)', async () => {
  for (const [nome, chamarRota] of Object.entries(rotasIA)) {
    assert.deepEqual(await repetir(25, () => chamarRota(T.junior)), Array(25).fill(403), nome);
  }
  // o Master ainda tem o balde inteiro
  assert.equal((await rotasIA.testar(T.master)).status, 400);
});

test('IA: a 21ª chamada do Master na mesma hora → 429 em /classificar, /diagnosticar e /config/ai/test', async () => {
  const esperado = { classificar: 404, diagnosticar: 404, testar: 400 };
  for (const [nome, chamarRota] of Object.entries(rotasIA)) {
    const primeiras = await repetir(20, () => chamarRota(T.outroMaster));
    assert.deepEqual(primeiras, Array(20).fill(esperado[nome]), `${nome}: as 20 primeiras passam`);
    const r = await chamarRota(T.outroMaster);
    assert.equal(r.status, 429, `${nome}: a 21ª é barrada`);
    assert.match(r.corpo.erro, /20 por hora/);
    assert.ok(r.cabecalhos.get('ratelimit') || r.cabecalhos.get('ratelimit-policy') || r.cabecalhos.get('ratelimit-limit'), 'cabeçalhos RateLimit presentes');
  }
});

test('IA: o contador é por usuário (outro Master segue livre) e por rota (classificar cheio não trava diagnosticar)', async () => {
  // m2 esgotou as três rotas no teste anterior; m1 (só usou 'testar' 1 vez) segue livre nas três
  for (const [nome, chamarRota] of Object.entries(rotasIA)) assert.notEqual((await chamarRota(T.master)).status, 429, nome);
});

test('IA: o limite é por USUÁRIO, não por IP (dois Masters no mesmo IP têm baldes separados)', async () => {
  const a = assinar({ id: 'ma', perfil: 'master' }); const b = assinar({ id: 'mb', perfil: 'master' });
  await repetir(20, () => chamar('POST', `/api/processos/${PID}/classificar`, a, { ip: '203.0.113.7' }));
  assert.equal((await chamar('POST', `/api/processos/${PID}/classificar`, a, { ip: '203.0.113.7' })).status, 429);
  assert.equal((await chamar('POST', `/api/processos/${PID}/classificar`, b, { ip: '203.0.113.7' })).status, 404);
  // e trocar de IP não zera o balde de quem já estourou
  assert.equal((await chamar('POST', `/api/processos/${PID}/classificar`, a, { ip: '203.0.113.99' })).status, 429);
});

test('IA: sem token → 401 (não chega ao limitador)', async () => {
  for (const chamarRota of Object.values(rotasIA)) assert.equal((await chamarRota(null)).status, 401);
});

// ───────────────────────────── /mcp: 60/min por Master que autorizou ─────────────────────────────
test('/mcp: 60 por minuto; a 61ª → 429', async () => {
  const t = conector('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  const s = await repetir(61, () => chamar('POST', '/mcp', t));
  assert.deepEqual(s.slice(0, 60), Array(60).fill(200));
  assert.equal(s[60], 429);
});

test('/mcp: o balde é o `autorizado_por`, NÃO o id da conta de serviço (todos os conectores usam o mesmo id)', async () => {
  const anaEsgotou = conector('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'); // já estourou no teste anterior
  const outro = conector('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  assert.equal((await chamar('POST', '/mcp', anaEsgotou)).status, 429);
  assert.equal((await chamar('POST', '/mcp', outro)).status, 200, 'outro Master autorizador tem balde próprio, mesmo com o mesmo id de serviço');
  assert.equal((await chamar('POST', '/mcp', T.master)).status, 200, 'sessão comum conta pelo id do usuário');
});

test('chaveMcp: escolhe o balde pelo token (autorizado_por > id > IP) sem confiar em token inválido', () => {
  const req = (h, cookies) => ({ headers: h, cookies, ip: '198.51.100.4' });
  assert.equal(chaveMcp(req({ authorization: `Bearer ${conector('u-1')}` })), 'u:u-1');
  assert.equal(chaveMcp(req({ authorization: `Bearer ${T.master}` })), 'u:m1');
  assert.equal(chaveMcp(req({}, { am_token: T.master })), 'u:m1', 'cookie também vale (como o autenticar de hoje)');
  assert.equal(chaveMcp(req({ authorization: 'Bearer lixo' })), 'ip:198.51.100.4');
  assert.equal(chaveMcp(req({})), 'ip:198.51.100.4');
  const forjado = jwt.sign({ id: 'x', autorizado_por: 'vitima' }, 'outro-segredo');
  assert.equal(chaveMcp(req({ authorization: `Bearer ${forjado}` })), 'ip:198.51.100.4', 'token assinado com outro segredo cai no IP, não vira balde alheio');
});

// ───────────────────────────── /api/integracoes: Camila NÃO é afetada ─────────────────────────────
test('Camila → AM (x-api-key): responde 200 dentro do limite; chave errada segue 401; nada exige Origin nem cookie', async () => {
  const chave = { 'x-api-key': 'chave-camila-de-teste' };
  const ok = await chamar('GET', '/api/integracoes/camila/cliente?telefone=83999990000', null, { cabecalhos: chave, ip: '198.51.100.20' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.corpo, { ok: true, encontrado: false });
  assert.equal((await chamar('GET', '/api/integracoes/camila/cliente?telefone=83999990000', null, { cabecalhos: { 'x-api-key': 'errada' }, ip: '198.51.100.20' })).status, 401);
  // o uso normal da Camila (consulta em cache por 5 min) fica MUITO abaixo do limite: 30 chamadas seguidas passam
  const s = await repetir(30, () => chamar('GET', '/api/integracoes/camila/cliente?telefone=83999990000', null, { cabecalhos: chave, ip: '198.51.100.20' }));
  assert.deepEqual(s, Array(30).fill(200));
});

test('/api/integracoes: 120 por minuto por IP; a 121ª → 429, e outro IP segue livre', async () => {
  const chave = { 'x-api-key': 'chave-camila-de-teste' };
  const mesmoIp = (i) => chamar('GET', '/api/integracoes/camila/cliente?telefone=83988887777', null, { cabecalhos: chave, ip: '198.51.100.50' });
  const s = await repetir(121, mesmoIp);
  assert.deepEqual(s.slice(0, 120), Array(120).fill(200));
  assert.equal(s[120], 429);
  const outroIp = await chamar('GET', '/api/integracoes/camila/cliente?telefone=83988887777', null, { cabecalhos: chave, ip: '198.51.100.51' });
  assert.equal(outroIp.status, 200);
});

// ───────────────────────────── webhook e OAuth (por IP) ─────────────────────────────
test('/api/webhook: 60 por minuto por IP; a 61ª → 429', async () => {
  const s = await repetir(61, () => chamar('POST', '/api/webhook/datajud', null, { corpo: { numeroProcesso: '1' }, ip: '198.51.100.60' }));
  assert.deepEqual(s.slice(0, 60), Array(60).fill(200));
  assert.equal(s[60], 429);
});

test('/oauth/token: 30 por 15 min por IP, só POST (GET de descoberta não conta); /oauth/register: 10 por hora', async () => {
  const gets = await repetir(40, () => chamar('GET', '/oauth/token', null, { ip: '198.51.100.70' }));
  assert.ok(gets.every(s => s === 400), 'GET não é contado nem barrado');
  const posts = await repetir(31, () => chamar('POST', '/oauth/token', null, { corpo: { grant_type: 'authorization_code' }, ip: '198.51.100.70' }));
  assert.deepEqual(posts.slice(0, 30), Array(30).fill(400));
  assert.equal(posts[30], 429);
  const reg = await repetir(11, () => chamar('POST', '/oauth/register', null, { corpo: { redirect_uris: ['https://x.invalid/cb'] }, ip: '198.51.100.71' }));
  assert.deepEqual(reg.slice(0, 10), Array(10).fill(201));
  assert.equal(reg[10], 429);
});

// ───────────────────────────── ligação no index.js ─────────────────────────────
test('index.js monta os limitadores ANTES dos roteadores (a integração não pode perdê-los)', () => {
  const fonte = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  const antes = (limite, roteador) => {
    const i = fonte.indexOf(limite); const j = fonte.indexOf(roteador);
    assert.ok(i > 0, `falta: ${limite}`); assert.ok(j > 0, `falta: ${roteador}`); assert.ok(i < j, `${limite} deve vir antes de ${roteador}`);
  };
  antes("app.use('/api/integracoes', limiteIntegracoes)", "app.use('/api/integracoes/camila'");
  antes("app.use('/api/webhook',       limiteWebhook)", "app.use('/api/webhook',       webhookRouter)");
  assert.match(fonte, /app\.use\('\/mcp',\s+limiteMcp, mcpRouter\)/);
  antes("app.use('/oauth/token',       limiteOauthToken)", 'app.use(oauthRouter)');
  antes("app.use('/oauth/register',    limiteOauthRegistro)", 'app.use(oauthRouter)');
});
