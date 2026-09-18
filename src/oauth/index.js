// Servidor de autorização OAuth 2.1 mínimo para o conector MCP do Acervo.
// Objetivo único: permitir que o app Claude "vincule" o conector /mcp via
// fluxo padrão (metadata + dynamic client registration + authorization code
// com PKCE), sem expor a senha do escritório nem exigir colar token manualmente.
//
// Modelo: o Master faz login com as próprias credenciais do AM Plataforma na
// tela de autorização; ao aprovar, é emitido um token da conta de serviço
// "integracao-claude" (perfil master dedicado, sem login por senha), que é o
// token efetivamente usado pelas ferramentas MCP. Login pessoal só autoriza —
// não concede às ferramentas os dados restritos de outros masters.
import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { db } from '../db/index.js';

export const oauthRouter = Router();

const CONTA_SERVICO_EMAIL = 'integracao-claude@abrantesemontenegro.com.br';
const TOKEN_TTL = '180d';
const CODE_TTL_MS = 5 * 60 * 1000;

// Armazenamento em memória — suficiente para um servidor de instância única.
// Reiniciar o processo (novo deploy) derruba clientes e códigos pendentes;
// o app Claude simplesmente refaz o registro na próxima tentativa de vincular.
const clientes = new Map();     // client_id -> { redirect_uris }
const codigos = new Map();      // code -> { client_id, redirect_uri, code_challenge, code_challenge_method, expiresAt }

function baseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  return `${proto}://${req.headers.host}`;
}

function limpar(mapa) {
  const agora = Date.now();
  for (const [k, v] of mapa) if (v.expiresAt && v.expiresAt < agora) mapa.delete(k);
}

// --- Metadados de descoberta (RFC 8414 e RFC 9728) ---

oauthRouter.get('/.well-known/oauth-authorization-server', (req, res) => {
  const b = baseUrl(req);
  res.json({
    issuer: b,
    authorization_endpoint: `${b}/oauth/authorize`,
    token_endpoint: `${b}/oauth/token`,
    registration_endpoint: `${b}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['acervo'],
  });
});

oauthRouter.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'], (req, res) => {
  const b = baseUrl(req);
  res.json({
    resource: `${b}/mcp`,
    authorization_servers: [b],
  });
});

// --- Dynamic Client Registration (RFC 7591) — cliente público, sem secret ---

oauthRouter.post('/oauth/register', (req, res) => {
  const { redirect_uris, client_name } = req.body || {};
  if (!Array.isArray(redirect_uris) || redirect_uris.length === 0) {
    return res.status(400).json({ error: 'invalid_client_metadata', error_description: 'redirect_uris é obrigatório.' });
  }
  const client_id = crypto.randomBytes(16).toString('hex');
  clientes.set(client_id, { redirect_uris, client_name: client_name || 'Cliente MCP' });
  res.status(201).json({
    client_id,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  });
});

// --- Authorization endpoint: tela de login do próprio Master ---

function paginaLogin({ erro, campos }) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Autorizar acesso — Acervo AM Plataforma</title>
<style>
body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
form{background:#1e293b;padding:32px;border-radius:12px;width:320px}
h1{font-size:18px;margin:0 0 4px}
p{font-size:13px;color:#94a3b8;margin:0 0 20px}
label{display:block;font-size:13px;margin:12px 0 4px}
input{width:100%;padding:8px;border-radius:6px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;box-sizing:border-box}
button{margin-top:20px;width:100%;padding:10px;border:0;border-radius:6px;background:#2563eb;color:#fff;font-weight:600;cursor:pointer}
.erro{color:#f87171;font-size:13px;margin:8px 0 0}
</style></head><body>
<form method="post">
<h1>Acervo Jurídico</h1>
<p>Entre com sua conta Master do AM Plataforma para autorizar o Claude a acessar o acervo de peças e precedentes.</p>
<label>E-mail</label>
<input type="email" name="email" required autofocus>
<label>Senha</label>
<input type="password" name="senha" required>
${erro ? `<p class="erro">${erro}</p>` : ''}
${campos}
<button type="submit">Autorizar</button>
</form></body></html>`;
}

function ocultos(q) {
  return ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'response_type', 'scope']
    .filter(k => q[k] != null)
    .map(k => `<input type="hidden" name="${k}" value="${String(q[k]).replace(/"/g, '&quot;')}">`)
    .join('');
}

function validarPedido(q) {
  const cliente = clientes.get(q.client_id);
  if (!cliente) return 'client_id desconhecido — refaça a vinculação do conector.';
  if (!q.redirect_uri || !cliente.redirect_uris.includes(q.redirect_uri)) return 'redirect_uri não corresponde ao cliente registrado.';
  if (q.response_type !== 'code') return 'response_type não suportado.';
  if (!q.code_challenge || q.code_challenge_method !== 'S256') return 'PKCE (S256) é obrigatório.';
  return null;
}

oauthRouter.get('/oauth/authorize', (req, res) => {
  limpar(codigos);
  const erroPedido = validarPedido(req.query);
  if (erroPedido) return res.status(400).send(paginaLogin({ erro: erroPedido, campos: '' }));
  res.send(paginaLogin({ erro: null, campos: ocultos(req.query) }));
});

oauthRouter.post('/oauth/authorize', async (req, res) => {
  const q = req.body || {};
  const erroPedido = validarPedido(q);
  if (erroPedido) return res.status(400).send(paginaLogin({ erro: erroPedido, campos: '' }));

  const { email, senha } = q;
  const user = email && senha
    ? await db.queryOne('SELECT * FROM usuarios WHERE email = $1 AND ativo = true', [String(email).toLowerCase().trim()])
    : null;

  if (!user || !(await bcrypt.compare(senha, user.senha_hash))) {
    return res.status(401).send(paginaLogin({ erro: 'Credenciais inválidas.', campos: ocultos(q) }));
  }
  if (user.perfil !== 'master') {
    return res.status(403).send(paginaLogin({ erro: 'Apenas contas Master podem autorizar este conector.', campos: ocultos(q) }));
  }

  const code = crypto.randomBytes(24).toString('hex');
  codigos.set(code, {
    client_id: q.client_id,
    redirect_uri: q.redirect_uri,
    code_challenge: q.code_challenge,
    code_challenge_method: q.code_challenge_method,
    autorizadoPor: user.id,
    expiresAt: Date.now() + CODE_TTL_MS,
  });

  const destino = new URL(q.redirect_uri);
  destino.searchParams.set('code', code);
  if (q.state) destino.searchParams.set('state', q.state);
  res.redirect(destino.toString());
});

// --- Token endpoint ---

async function tokenContaServico() {
  const user = await db.queryOne('SELECT * FROM usuarios WHERE email = $1 AND ativo = true', [CONTA_SERVICO_EMAIL]);
  if (!user) throw new Error('Conta de serviço integracao-claude não encontrada.');
  const payload = {
    id: user.id,
    nome: user.nome,
    email: user.email,
    perfil: user.perfil,
    master_id: user.master_id,
    pode_marcar_restrito: user.pode_marcar_restrito,
  };
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: TOKEN_TTL });
}

oauthRouter.post('/oauth/token', async (req, res) => {
  limpar(codigos);
  const b = req.body || {};

  if (b.grant_type === 'authorization_code') {
    const registro = codigos.get(b.code);
    if (!registro) return res.status(400).json({ error: 'invalid_grant', error_description: 'Código inválido ou expirado.' });
    codigos.delete(b.code);

    if (registro.client_id !== b.client_id || registro.redirect_uri !== b.redirect_uri) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'client_id ou redirect_uri não conferem.' });
    }
    const verificador = crypto.createHash('sha256').update(b.code_verifier || '').digest('base64url');
    if (verificador !== registro.code_challenge) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE inválido.' });
    }

    try {
      const access_token = await tokenContaServico();
      return res.json({ access_token, token_type: 'Bearer', expires_in: 180 * 24 * 3600, scope: 'acervo' });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', error_description: e.message });
    }
  }

  if (b.grant_type === 'refresh_token') {
    try {
      const access_token = await tokenContaServico();
      return res.json({ access_token, token_type: 'Bearer', expires_in: 180 * 24 * 3600, scope: 'acervo' });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', error_description: e.message });
    }
  }

  res.status(400).json({ error: 'unsupported_grant_type' });
});
