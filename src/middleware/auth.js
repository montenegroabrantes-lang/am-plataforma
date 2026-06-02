import jwt from 'jsonwebtoken';

export function autenticar(req, res, next) {
  // Lê do cookie httpOnly primeiro; fallback para Authorization header
  const token = req.cookies?.am_token || req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ ok: false, erro: 'Token não fornecido.' });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ ok: false, erro: 'Token inválido ou expirado.' });
  }
}

export function apenasMaster(req, res, next) {
  if (req.user?.perfil !== 'master') {
    return res.status(403).json({ ok: false, erro: 'Acesso restrito a Masters.' });
  }
  next();
}

export function apenasMaster01(req, res, next) {
  if (!req.user?.pode_marcar_restrito) {
    return res.status(403).json({ ok: false, erro: 'Acesso restrito ao Master 01.' });
  }
  next();
}
