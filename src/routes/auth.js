import { Router }   from 'express';
import bcrypt        from 'bcrypt';
import jwt           from 'jsonwebtoken';
import { authenticator } from 'otplib';
import { db }            from '../db/index.js';
import { registrarAuditoria } from '../middleware/auditoria.js';
import { autenticar }         from '../middleware/auth.js';

export const authRouter = Router();

const JWT_EXPIRA         = '15m';
const JWT_REFRESH_EXPIRA = '7d';

function gerarTokens(payload) {
  const access  = jwt.sign(payload, process.env.JWT_SECRET,         { expiresIn: JWT_EXPIRA });
  const refresh = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: JWT_REFRESH_EXPIRA });
  return { access, refresh };
}

// POST /api/auth/login
authRouter.post('/login', async (req, res) => {
  const { email, senha, totp } = req.body;
  if (!email || !senha) return res.status(400).json({ ok: false, erro: 'Email e senha obrigatórios.' });

  const user = await db.queryOne(
    'SELECT * FROM usuarios WHERE email = $1 AND ativo = true',
    [email.toLowerCase().trim()]
  );

  if (!user || !(await bcrypt.compare(senha, user.senha_hash))) {
    await registrarAuditoria({ acao: 'login_falhou', entidade: 'usuario', ip: req._ip });
    return res.status(401).json({ ok: false, erro: 'Credenciais inválidas.' });
  }

  // Força troca de senha no primeiro acesso
  if (!user.totp_ativo && user.totp_secret === null && user.criado_em === user.ultimo_acesso) {
    return res.status(200).json({ ok: false, primeiro_acesso: true, userId: user.id });
  }

  // 2FA obrigatório quando ativado
  if (user.totp_ativo) {
    if (!totp) return res.status(200).json({ ok: false, requer_totp: true });
    const valid = authenticator.verify({ token: totp, secret: user.totp_secret });
    if (!valid) return res.status(401).json({ ok: false, erro: 'Código 2FA inválido.' });
  }

  const payload = {
    id:                  user.id,
    nome:                user.nome,
    email:               user.email,
    perfil:              user.perfil,
    master_id:           user.master_id,
    pode_marcar_restrito: user.pode_marcar_restrito,
  };

  const { access, refresh } = gerarTokens(payload);

  await db.execute('UPDATE usuarios SET ultimo_acesso = NOW() WHERE id = $1', [user.id]);
  await registrarAuditoria({ usuarioId: user.id, acao: 'login', entidade: 'usuario', entidadeId: user.id, ip: req._ip });

  res.json({ ok: true, access, refresh, user: payload });
});

// POST /api/auth/refresh
authRouter.post('/refresh', async (req, res) => {
  const { refresh } = req.body;
  if (!refresh) return res.status(400).json({ ok: false, erro: 'Refresh token obrigatório.' });

  try {
    const decoded = jwt.verify(refresh, process.env.JWT_REFRESH_SECRET);
    // Remove campos gerados pelo JWT antes de reassinar
    const { iat, exp, ...payload } = decoded;
    const { access, refresh: newRefresh } = gerarTokens(payload);
    res.json({ ok: true, access, refresh: newRefresh });
  } catch {
    res.status(401).json({ ok: false, erro: 'Refresh token inválido ou expirado.' });
  }
});

// POST /api/auth/trocar-senha (primeiro acesso)
authRouter.post('/trocar-senha', async (req, res) => {
  const { userId, novaSenha } = req.body;
  if (!userId || !novaSenha) return res.status(400).json({ ok: false, erro: 'Dados obrigatórios.' });
  if (novaSenha.length < 8)  return res.status(400).json({ ok: false, erro: 'Senha deve ter no mínimo 8 caracteres.' });

  const hash = await bcrypt.hash(novaSenha, 12);
  await db.execute(
    'UPDATE usuarios SET senha_hash = $1, ultimo_acesso = NOW() WHERE id = $2',
    [hash, userId]
  );
  res.json({ ok: true, mensagem: 'Senha atualizada.' });
});

// GET /api/auth/2fa/setup — gera secret e QR para o usuário ativar 2FA
authRouter.get('/2fa/setup', autenticar, async (req, res) => {
  const secret = authenticator.generateSecret();
  const otpauth = authenticator.keyuri(req.user.email, 'AM Advogados', secret);

  // Salva secret temporário (não ativo ainda)
  await db.execute('UPDATE usuarios SET totp_secret = $1 WHERE id = $2', [secret, req.user.id]);

  res.json({ ok: true, secret, otpauth });
});

// POST /api/auth/2fa/ativar — confirma o código e ativa 2FA
authRouter.post('/2fa/ativar', autenticar, async (req, res) => {
  const { totp } = req.body;
  const user = await db.queryOne('SELECT * FROM usuarios WHERE id = $1', [req.user.id]);

  if (!user?.totp_secret) return res.status(400).json({ ok: false, erro: 'Execute /2fa/setup primeiro.' });

  if (!authenticator.verify({ token: totp, secret: user.totp_secret })) {
    return res.status(401).json({ ok: false, erro: 'Código inválido.' });
  }

  // Gera 8 códigos de recuperação
  const codigos = Array.from({ length: 8 }, () =>
    Math.random().toString(36).slice(2, 10).toUpperCase()
  );

  await db.execute(
    'UPDATE usuarios SET totp_ativo = true, totp_codigos_recuperacao = $1 WHERE id = $2',
    [codigos, user.id]
  );

  res.json({ ok: true, codigos_recuperacao: codigos });
});

// POST /api/auth/logout
authRouter.post('/logout', autenticar, async (req, res) => {
  await registrarAuditoria({ usuarioId: req.user.id, acao: 'logout', entidade: 'usuario', entidadeId: req.user.id, ip: req._ip });
  res.json({ ok: true });
});
