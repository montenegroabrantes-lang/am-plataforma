import { Router }   from 'express';
import bcrypt        from 'bcrypt';
import { authenticator } from 'otplib';
import { db }            from '../db/index.js';
import { registrarAuditoria } from '../middleware/auditoria.js';
import { autenticar }         from '../middleware/auth.js';
import { normalizarEmailTentado } from '../utils/tentativasLogin.js';
import { emailTentadoParaLog } from '../utils/auditoriaCampos.js';
import { exigirOrigemExplicita } from '../middleware/origem.js';
import { CONTA_SERVICO_EMAIL }   from '../oauth/escopos.js';
import {
  abrirSessao, renovarSessao, revogarFamilia, revogarSessoesDoUsuario, derrubarSessoes,
  emitirTokenPrimeiroAcesso, lerTokenPrimeiroAcesso, payloadPublico, SENHA_MIN, SENHA_MAX,
} from '../services/sessao.js';

export const authRouter = Router();

const PROD = process.env.NODE_ENV === 'production';

const COOKIE_ACCESS = {
  httpOnly: true,
  secure:   PROD,
  sameSite: PROD ? 'none' : 'lax',
  maxAge:   24 * 60 * 60 * 1000,       // 1 dia
  path:     '/',
};
const COOKIE_REFRESH = {
  httpOnly: true,
  secure:   PROD,
  sameSite: PROD ? 'none' : 'lax',
  maxAge:   7 * 24 * 60 * 60 * 1000,  // 7 dias
  path:     '/api/auth/refresh',       // escopo restrito
};

// Hash bcrypt (custo 12) de um valor descartável: o login sempre roda o bcrypt, exista ou não o e-mail (S-04).
const HASH_SEM_USUARIO = '$2b$12$7teX/Xvb1K/GNz2D2Nq.9eS7pLhKW6WiOaoAwB0GgCLTQNE44vfBi';

// Rotas de sessão do AM (o token do conector do Claude não troca senha nem encerra sessões de ninguém).
function apenasSessao(req, res, next) {
  if (Array.isArray(req.user?.escopos) || req.user?.email === CONTA_SERVICO_EMAIL) {
    return res.status(403).json({ ok: false, erro: 'Esta ação só pode ser feita pelo AM (sessão de usuário), não pelo conector.' });
  }
  next();
}

function setTokenCookies(res, access, refresh) {
  res.cookie('am_token',   access,  COOKIE_ACCESS);
  res.cookie('am_refresh', refresh, COOKIE_REFRESH);
}

function clearTokenCookies(res) {
  res.clearCookie('am_token',   { path: '/' });
  res.clearCookie('am_refresh', { path: '/api/auth/refresh' });
}

// POST /api/auth/login
authRouter.post('/login', async (req, res) => {
  const { email, senha, totp } = req.body;
  if (!email || !senha) return res.status(400).json({ ok: false, erro: 'Email e senha obrigatórios.' });
  if (typeof email !== 'string' || typeof senha !== 'string') return res.status(400).json({ ok: false, erro: 'Email e senha inválidos.' });

  const user = await db.queryOne(
    'SELECT * FROM usuarios WHERE email = $1 AND ativo = true',
    [email.toLowerCase().trim()]
  );

  // O bcrypt roda mesmo sem usuário, para o tempo de resposta não revelar se o e-mail existe.
  const senhaOk = await bcrypt.compare(senha, user?.senha_hash || HASH_SEM_USUARIO);
  if (!user || !senhaOk) {
    // S-13: registra a origem e o e-mail tentado (com o usuário, quando a conta existe)
    await registrarAuditoria({
      usuarioId: user?.id, acao: 'login_falhou', entidade: 'usuario',
      valorDepois: { origem: 'senha', email_tentado: emailTentadoParaLog(email) }, ip: req._ip,
    });
    return res.status(401).json({ ok: false, erro: 'Credenciais inválidas.' });
  }

  // Primeiro acesso (senha provisória): NÃO cria sessão nem cookie. Devolve um token curto, de finalidade
  // única, que só serve para POST /trocar-senha — nunca vale como sessão (o `autenticar` o recusa).
  if (user.senha_temporaria) {
    return res.status(200).json({ ok: false, primeiro_acesso: true, token_primeiro_acesso: emitirTokenPrimeiroAcesso(user) });
  }

  // 2FA obrigatório quando ativado
  if (user.totp_ativo) {
    if (!totp) return res.status(200).json({ ok: false, requer_totp: true });
    const valid = authenticator.verify({ token: totp, secret: user.totp_secret });
    if (!valid) {
      await registrarAuditoria({
        usuarioId: user.id, acao: 'login_falhou', entidade: 'usuario',
        valorDepois: { origem: 'senha', motivo: '2fa_invalido' }, ip: req._ip,
      });
      return res.status(401).json({ ok: false, erro: 'Código 2FA inválido.' });
    }
  }

  const payload = payloadPublico(user);

  const { access, refresh } = await abrirSessao(user, { ip: req._ip });
  setTokenCookies(res, access, refresh);

  await db.execute('UPDATE usuarios SET ultimo_acesso = NOW() WHERE id = $1', [user.id]);
  await registrarAuditoria({ usuarioId: user.id, acao: 'login', entidade: 'usuario', entidadeId: user.id, ip: req._ip });

  // Retorna dados do usuário mas NÃO os tokens (estão nos cookies)
  res.json({ ok: true, user: payload });
});

// POST /api/auth/refresh
// Rotação com banco (S-03): confere a linha do refresh, a conta (ativa, versão) e emite um par novo da mesma
// família. Só 400/401 significam "sessão perdida" para o frontend; falha nossa responde 503 e NÃO limpa cookies.
authRouter.post('/refresh', async (req, res) => {
  const refresh = req.cookies?.am_refresh;
  if (!refresh) return res.status(400).json({ ok: false, erro: 'Refresh token não encontrado.' });

  let r;
  try {
    r = await renovarSessao(refresh, req._ip);
  } catch (e) {
    console.error('[auth/refresh] falha ao consultar o banco:', e.message);
    return res.status(503).json({ ok: false, erro: 'Serviço indisponível — tente novamente em instantes.' });
  }
  if (!r.ok) {
    clearTokenCookies(res);
    return res.status(r.status).json({ ok: false, erro: r.erro });
  }
  setTokenCookies(res, r.access, r.refresh);
  res.json({ ok: true });
});

// POST /api/auth/trocar-senha — PRIMEIRO ACESSO (sem sessão). Exige o token de finalidade única devolvido pelo
// login, mais a senha provisória no mesmo pedido. Pedido no formato antigo (com userId) é recusado.
authRouter.post('/trocar-senha', async (req, res) => {
  const { token, senha_provisoria, novaSenha, userId } = req.body || {};
  if (userId !== undefined) return res.status(400).json({ ok: false, erro: 'Pedido inválido. Entre novamente para criar sua senha.' });
  if (!token || !senha_provisoria || !novaSenha || typeof novaSenha !== 'string' || typeof senha_provisoria !== 'string') {
    return res.status(400).json({ ok: false, erro: 'Informe a senha provisória e a nova senha.' });
  }
  const dados = lerTokenPrimeiroAcesso(token);
  if (!dados) return res.status(401).json({ ok: false, erro: 'O primeiro acesso expirou. Entre novamente com a senha provisória.' });

  if (novaSenha.length < SENHA_MIN) return res.status(400).json({ ok: false, erro: `A senha deve ter no mínimo ${SENHA_MIN} caracteres.` });
  if (novaSenha.length > SENHA_MAX) return res.status(400).json({ ok: false, erro: `A senha deve ter no máximo ${SENHA_MAX} caracteres.` });

  const user = await db.queryOne('SELECT * FROM usuarios WHERE id = $1 AND ativo = true', [dados.id]);
  if (!user) return res.status(401).json({ ok: false, erro: 'O primeiro acesso expirou. Entre novamente com a senha provisória.' });
  // Já trocou a senha: o token não serve de novo.
  if (!user.senha_temporaria) return res.status(403).json({ ok: false, erro: 'Operação não permitida.' });
  // A versão da conta mudou depois do login (ex.: um Master redefiniu a senha provisória): token de outra senha.
  if (Number(dados.sv ?? 0) !== Number(user.sessao_versao ?? 0)) {
    return res.status(401).json({ ok: false, erro: 'O primeiro acesso expirou. Entre novamente com a senha provisória.' });
  }
  if (!(await bcrypt.compare(senha_provisoria, user.senha_hash))) {
    return res.status(400).json({ ok: false, erro: 'Senha provisória incorreta.' });
  }
  if (novaSenha === senha_provisoria) return res.status(400).json({ ok: false, erro: 'A nova senha precisa ser diferente da provisória.' });

  const hash = await bcrypt.hash(novaSenha, 12);
  // `senha_temporaria = true` no WHERE: dois pedidos simultâneos com o mesmo token, só um grava.
  const gravado = await db.queryOne(
    `UPDATE usuarios SET senha_hash = $1, senha_temporaria = false, sessao_versao = sessao_versao + 1, ultimo_acesso = NOW()
     WHERE id = $2 AND senha_temporaria = true RETURNING id`,
    [hash, user.id]
  );
  await revogarSessoesDoUsuario(user.id);
  if (!gravado) return res.status(403).json({ ok: false, erro: 'Operação não permitida.' });

  await registrarAuditoria({ usuarioId: user.id, acao: 'primeiro_acesso_senha', entidade: 'usuario', entidadeId: user.id, ip: req._ip });
  res.json({ ok: true, mensagem: 'Senha atualizada.' });
});

// POST /api/auth/alterar-senha — o próprio usuário logado troca a senha. Senha atual errada = 400 (não 401:
// o interceptor do frontend trataria 401 como sessão vencida). As outras sessões caem; a atual recebe cookies novos.
authRouter.post('/alterar-senha', autenticar, apenasSessao, async (req, res) => {
  const { senha_atual, senha_nova } = req.body || {};
  if (typeof senha_atual !== 'string' || typeof senha_nova !== 'string' || !senha_atual || !senha_nova) {
    return res.status(400).json({ ok: false, erro: 'Informe a senha atual e a nova senha.' });
  }
  if (senha_nova.length < SENHA_MIN) return res.status(400).json({ ok: false, erro: `A senha deve ter no mínimo ${SENHA_MIN} caracteres.` });
  if (senha_nova.length > SENHA_MAX) return res.status(400).json({ ok: false, erro: `A senha deve ter no máximo ${SENHA_MAX} caracteres.` });

  const user = await db.queryOne('SELECT * FROM usuarios WHERE id = $1 AND ativo = true', [req.user.id]);
  if (!user) return res.status(401).json({ ok: false, erro: 'Usuário não encontrado.' });
  if (!(await bcrypt.compare(senha_atual, user.senha_hash))) {
    return res.status(400).json({ ok: false, erro: 'Senha atual incorreta.' });
  }
  if (senha_nova === senha_atual) return res.status(400).json({ ok: false, erro: 'A nova senha precisa ser diferente da atual.' });

  const hash = await bcrypt.hash(senha_nova, 12);
  const atualizado = await db.queryOne(
    'UPDATE usuarios SET senha_hash = $1, sessao_versao = sessao_versao + 1 WHERE id = $2 RETURNING sessao_versao',
    [hash, user.id]
  );
  await revogarSessoesDoUsuario(user.id);

  const { access, refresh } = await abrirSessao({ ...user, sessao_versao: atualizado?.sessao_versao ?? Number(user.sessao_versao ?? 0) + 1 }, { ip: req._ip });
  setTokenCookies(res, access, refresh);

  await registrarAuditoria({ usuarioId: user.id, acao: 'alterar_senha', entidade: 'usuario', entidadeId: user.id, ip: req._ip });
  res.json({ ok: true });
});

// POST /api/auth/sair-de-todos — encerra TODAS as sessões da conta, inclusive a atual.
authRouter.post('/sair-de-todos', autenticar, apenasSessao, async (req, res) => {
  await derrubarSessoes(req.user.id);
  clearTokenCookies(res);
  await registrarAuditoria({ usuarioId: req.user.id, acao: 'sair_de_todos', entidade: 'usuario', entidadeId: req.user.id, ip: req._ip });
  res.json({ ok: true });
});

// POST /api/auth/2fa/setup (S-01: grava o segredo, então não pode ser GET — um <img> de outro
// site trocaria o segredo de quem está logado). Recusa quando o 2FA já está ativo, para ninguém
// (nem um site externo) trocar o segredo de uma conta que já usa 2FA e trancá-la para fora.
async function iniciarSetup2fa(req, res) {
  const atual = await db.queryOne('SELECT totp_ativo FROM usuarios WHERE id = $1', [req.user.id]);
  if (atual?.totp_ativo) {
    return res.status(409).json({ ok: false, erro: 'O 2FA já está ativo nesta conta.' });
  }
  const secret = authenticator.generateSecret();
  const otpauth = authenticator.keyuri(req.user.email, 'AM Advogados', secret);
  await db.execute('UPDATE usuarios SET totp_secret = $1 WHERE id = $2', [secret, req.user.id]);
  await registrarAuditoria({ usuarioId: req.user.id, acao: 'configurar_2fa', entidade: 'usuario', entidadeId: req.user.id, ip: req._ip });
  res.json({ ok: true, secret, otpauth });
}
authRouter.post('/2fa/setup', autenticar, iniciarSetup2fa);
// Compatibilidade com o frontend anterior (que chamava GET) durante a publicação: só atende se o
// Origin do frontend vier explícito (XHR/fetch dele); <img>/navegação de outro site não mandam
// Origin num GET e são recusados. Remover depois que o frontend novo estiver no ar.
authRouter.get('/2fa/setup', autenticar, exigirOrigemExplicita(process.env.FRONTEND_URL || 'http://localhost:3000'), iniciarSetup2fa);

// POST /api/auth/2fa/ativar
authRouter.post('/2fa/ativar', autenticar, async (req, res) => {
  const { totp } = req.body;
  const user = await db.queryOne('SELECT * FROM usuarios WHERE id = $1', [req.user.id]);

  if (!user?.totp_secret) return res.status(400).json({ ok: false, erro: 'Execute /2fa/setup primeiro.' });

  if (!authenticator.verify({ token: totp, secret: user.totp_secret })) {
    return res.status(401).json({ ok: false, erro: 'Código inválido.' });
  }

  const codigos = Array.from({ length: 8 }, () =>
    Math.random().toString(36).slice(2, 10).toUpperCase()
  );

  await db.execute(
    'UPDATE usuarios SET totp_ativo = true, totp_codigos_recuperacao = $1 WHERE id = $2',
    [codigos, user.id]
  );
  await registrarAuditoria({ usuarioId: user.id, acao: 'ativar_2fa', entidade: 'usuario', entidadeId: user.id, ip: req._ip });

  res.json({ ok: true, codigos_recuperacao: codigos });
});

authRouter.get('/me', autenticar, async (req, res) => {
  // Perfil sempre do banco (o frontend atualiza o menu a cada carga); conta desativada = 401.
  const usuario = await db.queryOne('SELECT id, nome, email, perfil, pode_marcar_restrito, master_id FROM usuarios WHERE id = $1 AND ativo = true', [req.user.id]);
  if (!usuario) return res.status(401).json({ erro: 'Usuário não encontrado' });
  res.json({ user: usuario });
});

// POST /api/auth/logout — revoga só a família (navegador) desta sessão; as demais seguem abertas.
authRouter.post('/logout', autenticar, async (req, res) => {
  if (req.user.fam) await revogarFamilia(req.user.fam);
  clearTokenCookies(res);
  await registrarAuditoria({ usuarioId: req.user.id, acao: 'logout', entidade: 'usuario', entidadeId: req.user.id, ip: req._ip });
  res.json({ ok: true });
});
