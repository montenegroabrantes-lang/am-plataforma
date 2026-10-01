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
//
// Segurança (Onda 3 do Lote S, 30/09/2026):
// - S-02: a senha do Master tem limite de tentativas (por IP; por e-mail + IP, dividido com o
//   login do AM; e um teto por e-mail), cada falha vai para logs_auditoria (`login_falhou`,
//   origem oauth), a mensagem de erro é uma só e o código 2FA é pedido de quem o ativou;
// - S-07: o registro dinâmico só aceita os retornos do Claude (./redirects.js), com limites de
//   tamanho e de memória, e a tela mostra para onde o acesso vai;
// - S-19: a tela de autorização tem CSP própria (`default-src 'none'`, `frame-ancestors 'none'`).
import express, { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { authenticator } from 'otplib';
import { db } from '../db/index.js';
import { registrarAuditoria } from '../middleware/auditoria.js';
import { normalizarEmailTentado, tentativasLogin, limitesPorIpAtivos } from '../utils/tentativasLogin.js';
import { registrarErroInterno } from '../middleware/erros.js';
import { CONTA_SERVICO_EMAIL, ESCOPOS, ESCOPOS_PADRAO, ESCOPOS_VALIDOS, normalizarEscopos } from './escopos.js';
import { lerRedirectsPermitidos, redirectPermitido, fontesFormAction, hostDoRetorno } from './redirects.js';

const TOKEN_TTL = '180d';
const CODE_TTL_MS = 5 * 60 * 1000;
const CLIENTE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // cliente registrado sem uso por 30 dias expira
const MAX_CLIENTES = 200;                         // teto do Map em memória (o mais antigo sai)
const MAX_REDIRECTS = 5;
const MAX_NOME = 100;
const MAX_SENHA = 512;                            // bcrypt só usa 72 bytes; o resto é lixo (ou ataque)
const MIN = 60 * 1000;

const MSG_INVALIDO = 'E-mail, senha ou código inválidos.';
// Espera em minutos (mínimo 1), para a mensagem não prometer 15 minutos quando o teto por e-mail (1 hora) é quem bloqueia.
const msgLimite = (ms) => {
  const min = Math.max(1, Math.ceil((ms || 15 * MIN) / MIN));
  return `Muitas tentativas. Aguarde ${min} minuto${min > 1 ? 's' : ''} e tente de novo.`;
};
// Hash bcrypt (custo 12, igual ao das senhas do AM) de um texto aleatório descartado. Quando o
// e-mail não existe, o bcrypt roda contra ele: o tempo de resposta não revela quais e-mails existem.
const HASH_FALSO = '$2b$12$Km9OGZNmvmoZ37nEeRjgU.tnaXUD0zaK00jj0Gwzi/HsBFzyuiiNa';

function baseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  return `${proto}://${req.headers.host}`;
}

// --- Páginas HTML ---

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

function paginaLogin({ erro, campos, escopos = null, aplicativo = null, retorno = null, email = '', pedirCodigo = false }) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Autorizar conector Claude — AM Plataforma</title>
<style>
body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
form{background:#1e293b;padding:32px;border-radius:12px;width:320px}
h1{font-size:18px;margin:0 0 4px}
p{font-size:13px;color:#94a3b8;margin:0 0 20px}
p.destino{margin:0 0 16px;color:#e2e8f0;word-break:break-all}
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
${retorno ? `<p class="destino">Aplicativo: <strong>${esc(aplicativo)}</strong> · Retorno para: <strong>${esc(retorno)}</strong></p>` : ''}
<label>E-mail</label>
<input type="email" name="email" value="${esc(email)}" required${email ? '' : ' autofocus'}>
<label>Senha</label>
<input type="password" name="senha" required${email ? ' autofocus' : ''}>
${pedirCodigo ? `<label>Código de verificação (2FA)</label>
<input type="text" name="totp" inputmode="numeric" autocomplete="one-time-code" maxlength="10" required>` : ''}
${camposEscopos(escopos)}
${erro ? `<p class="erro">${esc(erro)}</p>` : ''}
${campos}
<button type="submit">Autorizar</button>
</form></body></html>`;
}

function ocultos(q) {
  return ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'response_type', 'scope']
    .filter(k => q[k] != null)
    .map(k => `<input type="hidden" name="${k}" value="${esc(q[k])}">`)
    .join('');
}

// Fábrica do roteador: cada instância tem os próprios Maps e contadores, para os testes partirem
// de memória limpa. `oauthRouter` (no fim) é a instância de produção.
export function criarOauthRouter({
  auditar = registrarAuditoria,
  tentativas = tentativasLogin,
  limites = {},
  porIpAtivo = limitesPorIpAtivos,
  redirectsPermitidos = lerRedirectsPermitidos(),
  agora = Date.now,
} = {}) {
  const router = Router();

  // Armazenamento em memória — suficiente para um servidor de instância única.
  // Reiniciar o processo (novo deploy) derruba clientes e códigos pendentes;
  // o app Claude simplesmente refaz o registro na próxima tentativa de vincular.
  const clientes = new Map();     // client_id -> { redirect_uris, client_name, expiresAt }
  const codigos = new Map();      // code -> { client_id, redirect_uri, code_challenge, code_challenge_method, expiresAt }

  function limpar(mapa) {
    const t = agora();
    for (const [k, v] of mapa) if (v.expiresAt && v.expiresAt < t) mapa.delete(k);
  }

  // Marca o cliente como usado agora (reinicia os 30 dias) e o move para o fim do Map, de modo
  // que "o mais antigo" seja sempre o que está há mais tempo sem uso.
  function usarCliente(clientId) {
    const c = clientes.get(clientId);
    if (!c) return null;
    c.expiresAt = agora() + CLIENTE_TTL_MS;
    clientes.delete(clientId);
    clientes.set(clientId, c);
    return c;
  }

  // CSP da tela de autorização. A página não tem script nem recurso externo; o `form-action`
  // precisa incluir os retornos do Claude porque o Chrome aplica a regra ao 302 que vem depois
  // do POST.
  const csp = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `form-action 'self' ${fontesFormAction(redirectsPermitidos).join(' ')}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join('; ');

  function pagina(res, status, dados) {
    res.status(status);
    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': csp,
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
    });
    return res.send(paginaLogin(dados));
  }

  // Limites por IP (S-02). Contam só as respostas de erro (skipSuccessfulRequests), exceto o
  // registro, que conta tudo. Só valem se o `req.ip` for o do cliente (ver limitesPorIpAtivos).
  const limitadorIp = (cfg, { apenasFalhas, handler }) => rateLimit({
    windowMs: cfg.windowMs, limit: cfg.limit,
    standardHeaders: 'draft-7', legacyHeaders: false,
    skipSuccessfulRequests: apenasFalhas,
    skip: () => !porIpAtivo(),
    handler,
  });
  const erroLimiteJson = (_req, res) => res.status(429).json({
    error: 'too_many_requests',
    error_description: 'Muitas requisições. Tente novamente mais tarde.',
  });
  const limiteAuthorize = limitadorIp({ limit: 20, windowMs: 15 * MIN, ...limites.authorize }, {
    apenasFalhas: true,
    handler: (req, res) => {
      const q = req.body || {};
      const contexto = validarPedido(q) ? { campos: '' } : { campos: ocultos(q), escopos: normalizarEscopos(q.escopos), ...contextoDoPedido(q) };
      const espera = req.rateLimit?.resetTime ? req.rateLimit.resetTime.getTime() - Date.now() : 0;
      return pagina(res, 429, { erro: msgLimite(espera), ...contexto });
    },
  });
  const limiteToken = limitadorIp({ limit: 30, windowMs: 15 * MIN, ...limites.token }, { apenasFalhas: true, handler: erroLimiteJson });
  const limiteRegistro = limitadorIp({ limit: 10, windowMs: 60 * MIN, ...limites.register }, { apenasFalhas: false, handler: erroLimiteJson });

  // O OAuth recebe formulário (x-www-form-urlencoded). O parser fica na própria rota, e não só
  // no global de index.js, para não depender dele (S-01 o tira de lá).
  const formulario = express.urlencoded({ extended: false, limit: '32kb' });

  // --- Metadados de descoberta (RFC 8414 e RFC 9728) ---

  router.get('/.well-known/oauth-authorization-server', (req, res) => {
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

  router.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'], (req, res) => {
    const b = baseUrl(req);
    res.json({
      resource: `${b}/mcp`,
      authorization_servers: [b],
      scopes_supported: ESCOPOS_VALIDOS,
    });
  });

  // --- Dynamic Client Registration (RFC 7591) — cliente público, sem secret ---

  router.post('/oauth/register', limiteRegistro, (req, res) => {
    limpar(clientes);
    const { redirect_uris, client_name } = req.body || {};
    if (!Array.isArray(redirect_uris) || redirect_uris.length === 0) {
      return res.status(400).json({ error: 'invalid_client_metadata', error_description: 'redirect_uris é obrigatório.' });
    }
    if (redirect_uris.length > MAX_REDIRECTS) {
      return res.status(400).json({ error: 'invalid_client_metadata', error_description: `No máximo ${MAX_REDIRECTS} redirect_uris.` });
    }
    const recusado = redirect_uris.find(uri => !redirectPermitido(uri, redirectsPermitidos));
    if (recusado !== undefined) {
      // Só o host vai para o log (o caminho e a query podem carregar segredo de outro sistema);
      // é o que o usuário precisa para acrescentar o retorno novo em OAUTH_REDIRECTS_PERMITIDOS.
      console.warn(`[OAuth] registro recusado: redirect_uri fora da lista (host ${JSON.stringify(hostDoRetorno(String(recusado)).slice(0, 100))}).`);
      return res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'redirect_uri não permitido.' });
    }
    const nome = typeof client_name === 'string'
      ? client_name.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, MAX_NOME)
      : '';

    while (clientes.size >= MAX_CLIENTES) clientes.delete(clientes.keys().next().value); // o mais antigo
    const client_id = crypto.randomBytes(16).toString('hex');
    clientes.set(client_id, { redirect_uris: [...redirect_uris], client_name: nome || 'Cliente MCP', expiresAt: agora() + CLIENTE_TTL_MS });
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

  function validarPedido(q) {
    const cliente = usarCliente(q.client_id);
    if (!cliente) return 'client_id desconhecido — refaça a vinculação do conector.';
    if (!q.redirect_uri || !cliente.redirect_uris.includes(q.redirect_uri)) return 'redirect_uri não corresponde ao cliente registrado.';
    if (q.response_type !== 'code') return 'response_type não suportado.';
    if (!q.code_challenge || q.code_challenge_method !== 'S256') return 'PKCE (S256) é obrigatório.';
    return null;
  }

  // Mostrado ao Master: para quem e para onde o acesso vai (só chamar com o pedido já validado).
  function contextoDoPedido(q) {
    return { aplicativo: clientes.get(q.client_id)?.client_name, retorno: hostDoRetorno(q.redirect_uri) };
  }

  router.get('/oauth/authorize', (req, res) => {
    limpar(codigos);
    limpar(clientes);
    const erroPedido = validarPedido(req.query);
    if (erroPedido) return pagina(res, 400, { erro: erroPedido, campos: '' });
    const pedidos = normalizarEscopos(req.query.scope);
    pagina(res, 200, {
      erro: null, campos: ocultos(req.query), escopos: pedidos.length ? pedidos : ESCOPOS_PADRAO, ...contextoDoPedido(req.query),
    });
  });

  router.post('/oauth/authorize', formulario, limiteAuthorize, async (req, res) => {
    limpar(codigos);
    limpar(clientes);
    const q = req.body || {};
    const erroPedido = validarPedido(q);
    if (erroPedido) return pagina(res, 400, { erro: erroPedido, campos: '' });

    // Só o que o Master marcou na tela (nunca mais do que o catálogo conhece).
    const escopos = normalizarEscopos(q.escopos);
    const tela = { campos: ocultos(q), escopos, ...contextoDoPedido(q) };
    if (!escopos.length) return pagina(res, 400, { erro: 'Marque ao menos uma permissão.', ...tela });

    const emailTentado = normalizarEmailTentado(q.email);

    // Limite por e-mail + IP e teto por e-mail, ANTES do bcrypt (que custa CPU a cada tentativa).
    // A tentativa é contada na chegada e descontada se não terminar em falha de credencial.
    const tentativa = tentativas.iniciar(emailTentado, req.ip, { comTeto: true, porIp: porIpAtivo() });
    if (tentativa.bloqueio) {
      if (tentativa.bloqueio === 'email' && tentativa.primeiroAviso) {
        await auditar({ acao: 'limite_email_oauth', entidade: 'oauth', valorDepois: { email_tentado: emailTentado }, ip: req.ip });
      }
      res.set('Retry-After', String(Math.ceil((tentativa.retryAposMs || 0) / 1000)));
      return pagina(res, 429, { erro: msgLimite(tentativa.retryAposMs), ...tela });
    }

    // Toda falha de credencial: mesmo status, mesma mensagem, e um `login_falhou` na auditoria.
    const recusar = async () => {
      await auditar({
        acao: 'login_falhou', entidade: 'usuario',
        valorDepois: { origem: 'oauth', email_tentado: emailTentado }, ip: req.ip,
      });
      return pagina(res, 401, { erro: MSG_INVALIDO, ...tela, email: emailTentado });
    };

    const senha = typeof q.senha === 'string' && q.senha.length <= MAX_SENHA ? q.senha : '';
    // A conta de serviço não é uma pessoa: nunca autoriza o próprio conector.
    const user = emailTentado && senha && emailTentado !== CONTA_SERVICO_EMAIL
      ? await db.queryOne('SELECT * FROM usuarios WHERE email = $1 AND ativo = true', [emailTentado])
      : null;
    const senhaOk = await bcrypt.compare(senha, user?.senha_hash || HASH_FALSO); // roda sempre
    // Conta inexistente, senha errada, perfil que não é Master e senha provisória: a resposta é a
    // mesma, para não revelar qual das condições falhou.
    if (!user || !senhaOk || user.perfil !== 'master' || user.senha_temporaria) return recusar();

    // 2FA: só de quem o ativou (a tela pede o código quando a senha já está certa).
    if (user.totp_ativo) {
      const codigo = typeof q.totp === 'string' ? q.totp.replace(/\s+/g, '') : '';
      if (!codigo) {
        tentativa.desfazer();
        return pagina(res, 200, { erro: 'Informe o código de verificação do seu aplicativo autenticador.', ...tela, email: emailTentado, pedirCodigo: true });
      }
      let valido = false;
      try { valido = authenticator.verify({ token: codigo, secret: user.totp_secret }); } catch { valido = false; }
      if (!valido) return recusar();
    }

    tentativa.desfazer(); // acerto não consome o limite
    const code = crypto.randomBytes(24).toString('hex');
    codigos.set(code, {
      client_id: q.client_id,
      redirect_uri: q.redirect_uri,
      code_challenge: q.code_challenge,
      code_challenge_method: q.code_challenge_method,
      autorizadoPor: user.id,
      escopos,
      expiresAt: agora() + CODE_TTL_MS,
    });
    await auditar({
      usuarioId: user.id, acao: 'autorizar_conector_claude', entidade: 'oauth',
      valorDepois: { escopos, cliente: clientes.get(q.client_id)?.client_name || null }, ip: req.ip,
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
      // Versão de sessão da conta de serviço (S-03): subir `usuarios.sessao_versao` dela derruba todos os conectores.
      sv: Number(user.sessao_versao ?? 0),
      // Confinamento: com este claim o token só entra em /mcp e nas áreas destes escopos.
      escopos,
      autorizado_por: autorizadoPor,
    };
    return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: TOKEN_TTL });
  }

  router.post('/oauth/token', formulario, limiteToken, async (req, res) => {
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
        usarCliente(registro.client_id);
        // `scope` informa ao cliente o que foi de fato concedido (pode diferir do pedido — RFC 6749 §3.3).
        return res.json({ access_token, token_type: 'Bearer', expires_in: 180 * 24 * 3600, scope: escopos.join(' ') });
      } catch (e) {
        registrarErroInterno(e, req); // detalhe só no log (a mensagem cita a conta de serviço)
        return res.status(500).json({ error: 'server_error' });
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

  return router;
}

export const oauthRouter = criarOauthRouter();
