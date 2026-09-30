// S-01: checagem de Origin contra CSRF. Nada de banco real nem de rede externa: um express
// temporário em porta local, com as mesmas peças do src/index.js (cors, cookies, json, auditar,
// exigirOrigemConfiavel com a configuração padrão) e as rotas reais de login/refresh/2FA sobre
// um banco falso.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcrypt';
import { definirCarregador, carregadorEcoDoToken } from './sessao.js';
definirCarregador(carregadorEcoDoToken); // S-03: nestes testes a conta vale o que o token diz (sem banco)

process.env.JWT_SECRET = 'segredo-de-teste';
process.env.JWT_REFRESH_SECRET = 'segredo-refresh-de-teste';
// Valores fictícios equivalentes aos de produção (frontend e API em subdomínios diferentes).
const FRONT = 'https://am-frontend-teste.up.railway.app';
process.env.FRONTEND_URL = `${FRONT}/`; // barra no fim: precisa ser normalizada

const { db } = await import('../db/index.js');
const senhaHash = await bcrypt.hash('senha-de-teste-123', 4);
let usuarios = { 'u1': { id: 'u1', nome: 'Fulano', email: 'fulano@exemplo.test', perfil: 'master', senha_hash: senhaHash, ativo: true, totp_ativo: false, master_id: null, pode_marcar_restrito: false } };
const consultas = [];
db.queryOne = async (sql, params) => {
  consultas.push(sql);
  if (/WHERE email/.test(sql)) return Object.values(usuarios).find(u => u.email === params[0]) || null;
  if (/totp_ativo FROM usuarios/.test(sql)) return usuarios[params[0]] ? { totp_ativo: usuarios[params[0]].totp_ativo } : null;
  return null;
};
db.execute = async (sql, params) => { consultas.push(sql); if (/SET totp_secret/.test(sql)) usuarios[params[1]].totp_secret = params[0]; return { rowCount: 1 }; };
db.query = async () => [];

const { exigirOrigemConfiavel, ISENCOES_PADRAO, normalizarOrigem, listarOrigensPermitidas } = await import('./origem.js');
const { auditar } = await import('./auditoria.js');
const { authRouter } = await import('../routes/auth.js');
const { autenticar } = await import('./auth.js');

const logs = [];
const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(auditar);
app.use(exigirOrigemConfiavel({ permitida: process.env.FRONTEND_URL, log: (m) => logs.push(m) }));

const executadas = [];
const registra = (nome) => (req, res) => { executadas.push(nome); res.json({ ok: true, nome, corpo: req.body }); };
app.use('/api/auth', authRouter);
// Rotas de mentira nos mesmos caminhos das reais, para provar a isenção/recusa por caminho.
app.post('/api/publicacoes/importar', registra('importar'));
app.post('/api/publicacoes/importar-browser', autenticar, registra('importar-browser'));
app.post('/api/publicacoes/importar/', registra('importar-barra'));
app.post('/api/processos/sync-todos', autenticar, registra('sync-todos'));
app.post('/api/clientes/:id/documentos', autenticar, registra('upload'));
app.put('/api/clientes/:id', autenticar, registra('put'));
app.patch('/api/tarefas/:id', autenticar, registra('patch'));
app.delete('/api/tarefas/:id', autenticar, registra('delete'));
app.get('/api/processos', autenticar, registra('get'));
app.post('/api/webhook/digisac', registra('webhook'));
app.post('/api/integracoes/camila/x', registra('integracoes'));
app.post('/api/integracoes/v1/camila/leads/abc/mensagem', registra('chave-api'));
app.post('/oauth/authorize', registra('oauth-authorize'));
app.post('/oauth/token', registra('oauth-token'));
app.post('/mcp', registra('mcp'));
app.post('/mcpx', registra('mcpx'));
app.post('/oauthx/token', registra('oauthx'));
app.post('/api/webhookx', registra('webhookx'));

const servidor = app.listen(0);
after(() => servidor.close());
const base = `http://127.0.0.1:${servidor.address().port}`;

const token = (await import('jsonwebtoken')).default.sign({ id: 'u1', perfil: 'master', email: 'fulano@exemplo.test' }, process.env.JWT_SECRET, { expiresIn: '1h' });
const COOKIE = `am_token=${token}`;

async function chamar(metodo, caminho, { origin, referer, cookie = true, headers = {}, body } = {}) {
  executadas.length = 0;
  const h = { ...headers };
  if (origin !== undefined) h.Origin = origin;
  if (referer !== undefined) h.Referer = referer;
  if (cookie) h.Cookie = COOKIE;
  if (body !== undefined && !h['Content-Type']) h['Content-Type'] = 'application/json';
  const r = await fetch(`${base}${caminho}`, { method: metodo, headers: h, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json, executou: [...executadas], setCookie: r.headers.getSetCookie?.() ?? [] };
}

// ── normalização ──
test('normalizarOrigem: igualdade de origem, sem barra final e sem valores inválidos', () => {
  assert.equal(normalizarOrigem(`${FRONT}/`), FRONT);
  assert.equal(normalizarOrigem(`${FRONT}/qualquer/caminho?x=1`), FRONT);
  assert.equal(normalizarOrigem('null'), null);
  assert.equal(normalizarOrigem(''), null);
  assert.equal(normalizarOrigem('nao é url'), null);
  assert.equal(normalizarOrigem('file:///etc/passwd'), null);
  assert.deepEqual(listarOrigensPermitidas(`${FRONT}/, http://localhost:3000`), [FRONT, 'http://localhost:3000']);
});

// ── origem legítima passa; forjada é recusada ──
test('origem legítima (frontend, mesmo com barra em FRONTEND_URL) passa em POST/PUT/PATCH/DELETE', async () => {
  for (const [m, c, nome] of [
    ['POST', '/api/processos/sync-todos', 'sync-todos'],
    ['PUT', '/api/clientes/1', 'put'],
    ['PATCH', '/api/tarefas/1', 'patch'],
    ['DELETE', '/api/tarefas/1', 'delete'],
  ]) {
    const r = await chamar(m, c, { origin: FRONT, body: m === 'DELETE' ? undefined : {} });
    assert.equal(r.status, 200, `${m} ${c}`);
    assert.deepEqual(r.executou, [nome]);
  }
});

test('origem forjada é recusada com 403 antes de qualquer handler, em todos os métodos que alteram estado', async () => {
  for (const [m, c] of [
    ['POST', '/api/processos/sync-todos'],
    ['PUT', '/api/clientes/1'],
    ['PATCH', '/api/tarefas/1'],
    ['DELETE', '/api/tarefas/1'],
    ['POST', '/api/auth/logout'],
  ]) {
    const r = await chamar(m, c, { origin: 'https://site-malicioso.invalid', body: m === 'DELETE' ? undefined : {} });
    assert.equal(r.status, 403, `${m} ${c}`);
    assert.equal(r.json.erro, 'Origem não permitida.');
    assert.deepEqual(r.executou, [], 'o handler não pode rodar');
  }
  assert.ok(logs.some(l => l.includes('[CSRF] recusado POST /api/processos/sync-todos origem=https://site-malicioso.invalid')));
  assert.ok(!logs.some(l => /am_token|Cookie/i.test(l)), 'o log não leva cookie/token');
});

test('Origin: null (sandbox/no-referrer) é recusada', async () => {
  const r = await chamar('POST', '/api/processos/sync-todos', { origin: 'null' });
  assert.equal(r.status, 403);
  assert.deepEqual(r.executou, []);
});

test('origens parecidas com a do frontend são recusadas (esquema, porta, sufixo, prefixo)', async () => {
  const host = new URL(FRONT).host;
  for (const o of [
    `${FRONT}.site-malicioso.invalid`,
    `https://${host}.evil.test`,
    `http://${host}`,
    `https://${host}:8443`,
    `https://x${host}`,
    `https://site-malicioso.invalid/${FRONT}`,
    `${FRONT.toUpperCase().replace('HTTPS', 'https')}x`,
  ]) {
    const r = await chamar('POST', '/api/processos/sync-todos', { origin: o });
    assert.equal(r.status, 403, o);
  }
});

test('sem Origin e sem Referer (servidor a servidor) passa; Referer decide quando não há Origin', async () => {
  assert.equal((await chamar('POST', '/api/processos/sync-todos')).status, 200);
  assert.equal((await chamar('POST', '/api/processos/sync-todos', { referer: `${FRONT}/processos/1?a=b` })).status, 200);
  assert.equal((await chamar('POST', '/api/processos/sync-todos', { referer: 'https://site-malicioso.invalid/pagina' })).status, 403);
  assert.equal((await chamar('POST', '/api/processos/sync-todos', { referer: 'lixo' })).status, 403);
  // Origin manda sobre o Referer: Origin ruim com Referer bom continua recusado.
  assert.equal((await chamar('POST', '/api/processos/sync-todos', { origin: 'https://site-malicioso.invalid', referer: `${FRONT}/` })).status, 403);
});

test('GET com Origin estranha não é afetado; OPTIONS (preflight) idem', async () => {
  const r = await chamar('GET', '/api/processos', { origin: 'https://site-malicioso.invalid' });
  assert.equal(r.status, 200);
  const pre = await fetch(`${base}/api/processos/sync-todos`, { method: 'OPTIONS', headers: { Origin: 'https://site-malicioso.invalid', 'Access-Control-Request-Method': 'POST' } });
  assert.notEqual(pre.status, 403);
});

test('upload multipart com Origin estranha é recusado; com a do frontend chega ao handler', async () => {
  const corpo = '--x\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--x--\r\n';
  const h = { 'Content-Type': 'multipart/form-data; boundary=x' };
  const ruim = await chamar('POST', '/api/clientes/1/documentos', { origin: 'https://site-malicioso.invalid', headers: h, body: corpo });
  assert.equal(ruim.status, 403);
  assert.deepEqual(ruim.executou, []);
  const bom = await chamar('POST', '/api/clientes/1/documentos', { origin: FRONT, headers: h, body: corpo });
  assert.equal(bom.status, 200);
});

// ── isenções: só por caminho exato / prefixo previsto ──
test('rotas autenticadas por chave própria ficam isentas (com qualquer Origin ou sem)', async () => {
  for (const [c, nome] of [
    ['/api/publicacoes/importar', 'importar'],
    ['/api/webhook/digisac', 'webhook'],
    ['/api/integracoes/camila/x', 'integracoes'],
    ['/api/integracoes/v1/camila/leads/abc/mensagem', 'chave-api'],
    ['/oauth/authorize', 'oauth-authorize'],
    ['/oauth/token', 'oauth-token'],
    ['/mcp', 'mcp'],
  ]) {
    for (const origin of [undefined, 'https://site-malicioso.invalid', 'null']) {
      const r = await chamar('POST', c, { origin, cookie: false, body: {} });
      assert.equal(r.status, 200, `${c} origin=${origin}`);
      assert.deepEqual(r.executou, [nome]);
    }
  }
});

test('a isenção do /importar é EXATA: importar-browser (cookie) continua protegida', async () => {
  const r = await chamar('POST', '/api/publicacoes/importar-browser', { origin: 'https://site-malicioso.invalid', body: {} });
  assert.equal(r.status, 403);
  assert.deepEqual(r.executou, []);
  assert.equal((await chamar('POST', '/api/publicacoes/importar-browser', { origin: FRONT, body: {} })).status, 200);
  // Variação com barra final também não ganha isenção por engano (cai na checagem).
  assert.equal((await chamar('POST', '/api/publicacoes/importar/', { origin: 'https://site-malicioso.invalid', body: {} })).status, 403);
  // Isenção é por método: PUT/DELETE no caminho exato do importar não são isentos.
  const put = await fetch(`${base}/api/publicacoes/importar`, { method: 'PUT', headers: { Origin: 'https://site-malicioso.invalid' } });
  assert.equal(put.status, 403);
});

test('prefixos parecidos não são isentos: /mcpx, /oauthx e /api/webhookx', async () => {
  for (const c of ['/mcpx', '/oauthx/token', '/api/webhookx']) {
    const r = await chamar('POST', c, { origin: 'https://site-malicioso.invalid', body: {} });
    assert.equal(r.status, 403, c);
    assert.deepEqual(r.executou, []);
  }
});

test('configuração padrão de isenções é exatamente a prevista (nada de prefixo no importar)', () => {
  assert.deepEqual(ISENCOES_PADRAO.prefixos, ['/oauth/', '/mcp', '/api/integracoes/', '/api/webhook/']);
  assert.deepEqual(ISENCOES_PADRAO.exatas, [['POST', '/api/publicacoes/importar']]);
});

// ── Bearer / chaves ──
test('chamada com Authorization: Bearer passa (integração), mesmo sem Origin e com Origin estranha', async () => {
  const r = await chamar('POST', '/api/processos/sync-todos', { cookie: false, headers: { Authorization: `Bearer ${token}` }, origin: 'https://site-malicioso.invalid' });
  assert.equal(r.status, 200);
  assert.equal((await chamar('POST', '/api/processos/sync-todos', { cookie: false, headers: { Authorization: `Bearer ${token}` } })).status, 200);
  // "Bearer" sozinho ou outro esquema não vale como isenção.
  assert.equal((await chamar('POST', '/api/processos/sync-todos', { headers: { Authorization: 'Basic abc' }, origin: 'https://site-malicioso.invalid' })).status, 403);
  assert.equal((await chamar('POST', '/api/processos/sync-todos', { headers: { Authorization: 'Bearer' }, origin: 'https://site-malicioso.invalid' })).status, 403);
});

// ── fluxo de login do frontend ──
test('login → refresh → escrita com a origem do frontend continua funcionando; login com origem forjada é recusado', async () => {
  const login = await chamar('POST', '/api/auth/login', { origin: FRONT, cookie: false, body: { email: 'fulano@exemplo.test', senha: 'senha-de-teste-123' } });
  assert.equal(login.status, 200);
  assert.equal(login.json.ok, true);
  const cookies = login.setCookie.map(c => c.split(';')[0]);
  assert.ok(cookies.some(c => c.startsWith('am_token=')) && cookies.some(c => c.startsWith('am_refresh=')));

  // Refresh automático do frontend (axios manda Origin sozinho).
  const refresh = await chamar('POST', '/api/auth/refresh', { origin: FRONT, cookie: false, headers: { Cookie: cookies.join('; ') }, body: {} });
  assert.equal(refresh.status, 200);
  // 3 refreshes em paralelo (o interceptor do frontend dispara um por requisição com 401).
  const paralelos = await Promise.all([1, 2, 3].map(() => chamar('POST', '/api/auth/refresh', { origin: FRONT, cookie: false, headers: { Cookie: cookies.join('; ') }, body: {} })));
  assert.deepEqual(paralelos.map(p => p.status), [200, 200, 200]);

  const antes = consultas.length;
  const forjado = await chamar('POST', '/api/auth/login', { origin: 'https://site-malicioso.invalid', cookie: false, body: { email: 'fulano@exemplo.test', senha: 'senha-de-teste-123' } });
  assert.equal(forjado.status, 403);
  assert.equal(consultas.length, antes, 'nem chega a consultar o banco');
  assert.deepEqual(forjado.setCookie, []);
});

// ── 2FA setup: não grava por GET vindo de outro site ──
test('GET /2fa/setup de outro site (<img>: sem Origin) não grava; com Origin do frontend serve o frontend antigo', async () => {
  usuarios.u1.totp_secret = 'original';
  const img = await chamar('GET', '/api/auth/2fa/setup'); // navegação/imagem cross-site: cookie sim, Origin não
  assert.equal(img.status, 403);
  assert.equal(usuarios.u1.totp_secret, 'original');
  const outro = await chamar('GET', '/api/auth/2fa/setup', { origin: 'https://site-malicioso.invalid' });
  assert.equal(outro.status, 403);
  assert.equal(usuarios.u1.totp_secret, 'original');
  const legado = await chamar('GET', '/api/auth/2fa/setup', { origin: FRONT });
  assert.equal(legado.status, 200);
  assert.notEqual(usuarios.u1.totp_secret, 'original');
});

test('POST /2fa/setup: origem forjada 403; do frontend 200; com 2FA já ativo 409 (não troca o segredo)', async () => {
  usuarios.u1.totp_secret = 'original';
  assert.equal((await chamar('POST', '/api/auth/2fa/setup', { origin: 'https://site-malicioso.invalid', body: {} })).status, 403);
  assert.equal(usuarios.u1.totp_secret, 'original');
  const ok = await chamar('POST', '/api/auth/2fa/setup', { origin: FRONT, body: {} });
  assert.equal(ok.status, 200);
  assert.ok(ok.json.secret && ok.json.otpauth);
  usuarios.u1.totp_ativo = true; usuarios.u1.totp_secret = 'ativo';
  for (const metodo of ['POST', 'GET']) {
    const r = await chamar(metodo, '/api/auth/2fa/setup', { origin: FRONT, body: metodo === 'POST' ? {} : undefined });
    assert.equal(r.status, 409, metodo);
    assert.equal(usuarios.u1.totp_secret, 'ativo');
  }
  usuarios.u1.totp_ativo = false;
});

// ── guarda da fiação em src/index.js ──
test('src/index.js: sem urlencoded global; checagem de origem montada com FRONTEND_URL depois de auditar', () => {
  const fonte = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  assert.ok(!/app\.use\(\s*express\.urlencoded/.test(fonte), 'urlencoded global voltou');
  const iAuditar = fonte.indexOf('app.use(auditar)');
  const iOrigem = fonte.indexOf('app.use(exigirOrigemConfiavel({ permitida: allowedOrigin }))');
  const iGate = fonte.indexOf('if (!dbOk)');
  assert.ok(iAuditar > 0 && iOrigem > iAuditar && iOrigem < iGate, 'ordem dos middlewares');
  assert.ok(fonte.indexOf('montarUrlencodedOauth(app)') < fonte.indexOf('app.use(oauthRouter)'), 'parser do OAuth antes do oauthRouter');
});
