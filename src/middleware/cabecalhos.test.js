// S-19 (servidor): cabeçalhos de segurança do backend, sem X-Powered-By, sem interferir no CORS,
// e a montagem em src/index.js.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import cors from 'cors';

const { cabecalhosSeguranca } = await import('./cabecalhos.js');
const { criarHealth } = await import('../health.js');

const FRONT = 'https://am-web.exemplo.com';
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(cabecalhosSeguranca());
app.use(cors({ origin: FRONT, credentials: true }));
app.get('/health', criarHealth({ pronto: () => true, banco: { query: async () => [] } }));
const servidor = app.listen(0);
const base = `http://127.0.0.1:${servidor.address().port}`;
after(() => servidor.close());

test('/health traz os cabeçalhos de segurança e não traz X-Powered-By', async () => {
  const r = await fetch(`${base}/health`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('strict-transport-security'), 'max-age=15552000; includeSubDomains'); // 180 dias, sem preload
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(r.headers.get('x-dns-prefetch-control'), 'off');
  assert.equal(r.headers.get('x-permitted-cross-domain-policies'), 'none');
  assert.equal(r.headers.get('x-xss-protection'), '0');
  assert.equal(r.headers.get('x-powered-by'), null);
  assert.doesNotMatch(r.headers.get('strict-transport-security'), /preload/);
});

test('a API (JSON) não recebe CSP, COOP nem CORP: o frontend é de outro site e o fluxo do Claude atravessa origens', async () => {
  const r = await fetch(`${base}/health`);
  assert.equal(r.headers.get('content-security-policy'), null);
  assert.equal(r.headers.get('cross-origin-opener-policy'), null);
  assert.equal(r.headers.get('cross-origin-resource-policy'), null);
});

test('os cabeçalhos não interferem no CORS (preflight do frontend continua com credenciais)', async () => {
  const pre = await fetch(`${base}/health`, { method: 'OPTIONS', headers: { Origin: FRONT, 'Access-Control-Request-Method': 'POST' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), FRONT);
  assert.equal(pre.headers.get('access-control-allow-credentials'), 'true');
  assert.equal(pre.headers.get('x-frame-options'), 'DENY');
  const r = await fetch(`${base}/health`, { headers: { Origin: FRONT } });
  assert.equal(r.headers.get('access-control-allow-origin'), FRONT);
  assert.equal(r.headers.get('strict-transport-security'), 'max-age=15552000; includeSubDomains');
});

test('HSTS configurável e X-Powered-By removido mesmo se algum código o definir antes', async () => {
  const outro = express();
  outro.use((_req, res, next) => { res.setHeader('X-Powered-By', 'Express'); next(); });
  outro.use(cabecalhosSeguranca({ hstsSegundos: 60 }));
  outro.get('/x', (_req, res) => res.json({ ok: true }));
  const s = outro.listen(0);
  try {
    const r = await fetch(`http://127.0.0.1:${s.address().port}/x`);
    assert.equal(r.headers.get('strict-transport-security'), 'max-age=60; includeSubDomains');
    assert.equal(r.headers.get('x-powered-by'), null);
  } finally {
    s.close();
  }
});

// Montagem real: index.js não pode subir neste teste (abre banco e workers), então confere o texto.
test('src/index.js: cabeçalhos e disable(x-powered-by) antes do CORS; limite por e-mail no login; trust proxy configurável', () => {
  const fonte = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  const posCabecalhos = fonte.indexOf('app.use(cabecalhosSeguranca())');
  const posCors = fonte.indexOf('app.use(cors(');
  assert.ok(posCabecalhos > 0, 'cabecalhosSeguranca montado');
  assert.ok(posCors > posCabecalhos, 'antes do CORS (a API toda e as respostas de erro do CORS levam os cabeçalhos)');
  assert.match(fonte, /app\.disable\('x-powered-by'\)/);
  assert.match(fonte, /app\.use\('\/api\/auth\/login',\s+loginLimiter,\s*limiteLoginPorEmail\(\)\)/);
  assert.match(fonte, /TRUST_PROXY_SALTOS/);
  assert.match(fonte, /\[BOOT\] trust proxy:/, 'o boot registra o salto de proxy e o estado dos limites por IP');
  assert.match(fonte, /app\.set\('trust proxy', saltosProxy > 0 \? saltosProxy : 1\)/);
});
