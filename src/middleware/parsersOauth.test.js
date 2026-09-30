// S-01: parser de formulário só no OAuth. Fluxo do conector sem banco real:
// register (JSON) → GET authorize → POST authorize (formulário, mesma origem do formulário) →
// token com PKCE → /mcp com Bearer. E um formulário HTML de outro site NÃO chega a rota comum.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcrypt';

process.env.JWT_SECRET = 'segredo-de-teste';
const FRONT = 'https://am-frontend-teste.up.railway.app';
process.env.FRONTEND_URL = FRONT;

const { db } = await import('../db/index.js');
const hash = await bcrypt.hash('senha-de-teste-123', 4);
const usuarios = [
  { id: 'm1', nome: 'Master', email: 'master@exemplo.test', perfil: 'master', senha_hash: hash, ativo: true },
  { id: 'svc', nome: 'Serviço', email: 'integracao-claude@am-advogados.local', perfil: 'master', senha_hash: 'x', ativo: true },
];
db.queryOne = async (sql, params) => usuarios.find(u => u.email === params[0]) || null;
db.execute = async () => ({ rowCount: 1 });
db.query = async () => [];

const { montarUrlencodedOauth } = await import('./parsersOauth.js');
const { exigirOrigemConfiavel } = await import('./origem.js');
const { auditar } = await import('./auditoria.js');
const { oauthRouter } = await import('../oauth/index.js');
const { CONTA_SERVICO_EMAIL } = await import('../oauth/escopos.js');
usuarios[1].email = CONTA_SERVICO_EMAIL;

const app = express();
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(auditar);
app.use(exigirOrigemConfiavel({ permitida: FRONT }));
const recebidos = [];
app.post('/api/processos/sync-todos', (req, res) => { recebidos.push(req.body); res.json({ ok: true }); });
app.post('/api/estimativas/leads/:contactId/passar-atendente', (req, res) => { recebidos.push(req.body); res.json({ ok: true }); });
montarUrlencodedOauth(app);
app.use(oauthRouter);
const servidor = app.listen(0);
after(() => servidor.close());
const base = `http://127.0.0.1:${servidor.address().port}`;

const form = (o) => new URLSearchParams(o).toString();
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };

test('formulário HTML de outro site chega SEM corpo à rota comum (e é recusado pela Origin)', async () => {
  recebidos.length = 0;
  // Sem Origin (ex.: navegador antigo/servidor): passa pela origem, mas o corpo de formulário não é lido.
  const r = await fetch(`${base}/api/estimativas/leads/abc/passar-atendente`, { method: 'POST', headers: FORM, body: form({ valor: '99999' }) });
  assert.equal(r.status, 200);
  assert.deepEqual(recebidos, [{}], 'o parser urlencoded não pode ser global');
  // Com Origin de outro site: 403.
  const r2 = await fetch(`${base}/api/processos/sync-todos`, { method: 'POST', headers: { ...FORM, Origin: 'https://site-malicioso.invalid' }, body: form({ a: '1' }) });
  assert.equal(r2.status, 403);
});

test('conector: register → authorize (GET e POST de formulário) → token PKCE, com o parser só no OAuth', async () => {
  const redirect = 'https://claude.ai/api/mcp/auth_callback';
  const reg = await (await fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: [redirect], client_name: 'Claude' }) })).json();
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const pedido = { client_id: reg.client_id, redirect_uri: redirect, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 'st' };

  const pagina = await fetch(`${base}/oauth/authorize?${form(pedido)}`);
  assert.equal(pagina.status, 200);

  // POST do formulário da própria página: com Origin da API (mesma origem), com Origin null
  // (Referrer-Policy: no-referrer) e sem Origin: /oauth/ é isento e as credenciais vão no corpo.
  for (const origin of [base, 'null', undefined]) {
    const r = await fetch(`${base}/oauth/authorize`, {
      method: 'POST', redirect: 'manual',
      headers: { ...FORM, ...(origin ? { Origin: origin } : {}) },
      body: form({ ...pedido, email: 'master@exemplo.test', senha: 'senha-de-teste-123', escopos: 'acervo' }),
    });
    assert.equal(r.status, 302, `origin=${origin}`);
    const code = new URL(r.headers.get('location')).searchParams.get('code');
    assert.ok(code);
    if (origin !== base) continue;
    const tk = await fetch(`${base}/oauth/token`, {
      method: 'POST', headers: FORM,
      body: form({ grant_type: 'authorization_code', code, client_id: reg.client_id, redirect_uri: redirect, code_verifier: verifier }),
    });
    assert.equal(tk.status, 200);
    const j = await tk.json();
    assert.equal(j.token_type, 'Bearer');
    assert.ok(j.access_token);
  }
});

test('OAuth: o formulário continua lido pelo parser e corpo maior que 32 KB é recusado', async () => {
  const r = await fetch(`${base}/oauth/authorize`, { method: 'POST', headers: FORM, body: form({ email: 'a@b.c', senha: 'x', client_id: 'nao-existe' }) });
  assert.equal(r.status, 400); // pedido inválido chegou como formulário lido pelo parser (client_id desconhecido)
  const grande = await fetch(`${base}/oauth/token`, { method: 'POST', headers: FORM, body: form({ grant_type: 'authorization_code', lixo: 'a'.repeat(40 * 1024) }) });
  assert.equal(grande.status, 413);
});
