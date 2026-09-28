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
//
// Escopos (28/09/2026): a tela de autorização lista as permissões (ver ./escopos.js) e o
// Master marca quais concede — "acervo" vem marcado por padrão, "reprotocolo" só se o cliente
// pediu ou se o Master marcar. O token passa a carregar `escopos` e fica confinado a /mcp e às
// áreas desses escopos (middleware/auth.js). Para acrescentar uma permissão a um conector já
// vinculado: desconectar e conectar de novo no Claude, marcando a permissão nesta tela.
import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { db } from '../db/index.js';
import { registrarAuditoria } from '../middleware/auditoria.js';
import { CONTA_SERVICO_EMAIL, ESCOPOS, ESCOPOS_PADRAO, ESCOPOS_VALIDOS, normalizarEscopos } from './escopos.js';

export const oauthRouter = Router();

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
    // Só authorization_code: este servidor nunca emite refresh_token (ver /oauth/token).
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ESCOPOS_VALIDOS,
  });
});

oauthRouter.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'], (req, res) => {
  const b = baseUrl(req);
  res.json({
    resource: `${b}/mcp`,
    authorization_servers: [b],
    scopes_supported: ESCOPOS_VALIDOS,
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
    grant_types: ['authorization_code'],
    response_types: ['code'],
  });
});

// --- Authorization endpoint: tela de login do próprio Master ---

function esc(valor) {
  return String(valor ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Permissões marcáveis. `marcados` = o que o cliente pediu (ou o padrão) / o que o Master já
// tinha marcado antes de um erro de senha.
function camposEscopos(marcados) {
  if (!marcados) return '';
  return `<fieldset><legend>Permissões concedidas ao Claude</legend>${ESCOPOS_VALIDOS.map(e => `
<label class="escopo"><input type="checkbox" name="escopos" value="${esc(e)}"${marcados.includes(e) ? ' checked' : ''}>
<span><strong>${esc(ESCOPOS[e].rotulo)}</strong><br><small>${esc(ESCOPOS[e].descricao)}</small></span></label>`).join('')}
</fieldset>`;
}

function paginaLogin({ erro, campos, escopos = null }) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Autorizar conector Claude — AM Plataforma</title>
<style>
body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
form{background:#1e293b;padding:32px;border-radius:12px;width:320px}
h1{font-size:18px;margin:0 0 4px}
p{font-size:13px;color:#94a3b8;margin:0 0 20px}
label{display:block;font-size:13px;margin:12px 0 4px}
input{width:100%;padding:8px;border-radius:6px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;box-sizing:border-box}
button{margin-top:20px;width:100%;padding:10px;border:0;border-radius:6px;background:#2563eb;color:#fff;font-weight:600;cursor:pointer}
.erro{color:#f87171;font-size:13px;margin:8px 0 0}
fieldset{border:1px solid #334155;border-radius:8px;margin:16px 0 0;padding:8px 12px}
legend{font-size:13px;color:#94a3b8;padding:0 4px}
label.escopo{display:flex;gap:8px;align-items:flex-start;margin:8px 0}
label.escopo input{width:auto;margin-top:3px}
small{color:#94a3b8}
</style></head><body>
<form method="post">
<h1>AM Plataforma — conector Claude</h1>
<p>Entre com sua conta Master do AM Plataforma e marque o que o Claude poderá acessar.</p>
<label>E-mail</label>
<input type="email" name="email" required autofocus>
<label>Senha</label>
<input type="password" name="senha" required>
${camposEscopos(escopos)}
${erro ? `<p class="erro">${esc(erro)}</p>` : ''}
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
  const pedidos = normalizarEscopos(req.query.scope);
  res.send(paginaLogin({ erro: null, campos: ocultos(req.query), escopos: pedidos.length ? pedidos : ESCOPOS_PADRAO }));
});

oauthRouter.post('/oauth/authorize', async (req, res) => {
  const q = req.body || {};
  const erroPedido = validarPedido(q);
  if (erroPedido) return res.status(400).send(paginaLogin({ erro: erroPedido, campos: '' }));

  // Só o que o Master marcou na tela (nunca mais do que o catálogo conhece).
  const escopos = normalizarEscopos(q.escopos);
  if (!escopos.length) {
    return res.status(400).send(paginaLogin({ erro: 'Marque ao menos uma permissão.', campos: ocultos(q), escopos }));
  }

  const { email, senha } = q;
  const user = email && senha
    ? await db.queryOne('SELECT * FROM usuarios WHERE email = $1 AND ativo = true', [String(email).toLowerCase().trim()])
    : null;

  if (!user || !(await bcrypt.compare(senha, user.senha_hash))) {
    return res.status(401).send(paginaLogin({ erro: 'Credenciais inválidas.', campos: ocultos(q), escopos }));
  }
  if (user.perfil !== 'master') {
    return res.status(403).send(paginaLogin({ erro: 'Apenas contas Master podem autorizar este conector.', campos: ocultos(q), escopos }));
  }

  const code = crypto.randomBytes(24).toString('hex');
  codigos.set(code, {
    client_id: q.client_id,
    redirect_uri: q.redirect_uri,
    code_challenge: q.code_challenge,
    code_challenge_method: q.code_challenge_method,
    autorizadoPor: user.id,
    escopos,
    expiresAt: Date.now() + CODE_TTL_MS,
  });
  await registrarAuditoria({
    usuarioId: user.id, acao: 'autorizar_conector_claude', entidade: 'oauth',
    valorDepois: { escopos, cliente: clientes.get(q.client_id)?.client_name || null }, ip: req._ip,
  });

  const destino = new URL(q.redirect_uri);
  destino.searchParams.set('code', code);
  if (q.state) destino.searchParams.set('state', q.state);
  res.redirect(destino.toString());
});

// --- Token endpoint ---

async function tokenContaServico({ escopos, autorizadoPor }) {
  const user = await db.queryOne('SELECT * FROM usuarios WHERE email = $1 AND ativo = true', [CONTA_SERVICO_EMAIL]);
  if (!user) throw new Error('Conta de serviço integracao-claude não encontrada.');
  const payload = {
    id: user.id,
    nome: user.nome,
    email: user.email,
    perfil: user.perfil,
    master_id: user.master_id,
    pode_marcar_restrito: user.pode_marcar_restrito,
    // Confinamento: com este claim o token só entra em /mcp e nas áreas destes escopos.
    escopos,
    autorizado_por: autorizadoPor,
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
      const escopos = normalizarEscopos(registro.escopos);
      const access_token = await tokenContaServico({ escopos, autorizadoPor: registro.autorizadoPor });
      // `scope` informa ao cliente o que foi de fato concedido (pode diferir do pedido — RFC 6749 §3.3).
      return res.json({ access_token, token_type: 'Bearer', expires_in: 180 * 24 * 3600, scope: escopos.join(' ') });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', error_description: e.message });
    }
  }

  if (b.grant_type === 'refresh_token') {
    // Este servidor NUNCA emite refresh_token (a resposta do authorization_code acima não traz
    // um). Antes, este ramo emitia um token novo da conta de serviço (perfil master, 180 dias)
    // sem validar refresh token nenhum — qualquer pessoa na internet obtinha um token Master só
    // com um POST anônimo. Agora é sempre invalid_grant: quando o token expira, o cliente refaz
    // a autorização, que exige login de um Master na tela de /oauth/authorize.
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Refresh token não suportado — refaça a autorização do conector.',
    });
  }

  res.status(400).json({ error: 'unsupported_grant_type' });
});
