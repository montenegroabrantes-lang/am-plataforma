import jwt from 'jsonwebtoken';
import { areaPermitidaAoToken, escoposDoToken, ESCOPOS } from '../oauth/escopos.js';

export function autenticar(req, res, next) {
  // Lê do cookie httpOnly primeiro; fallback para Authorization header
  const token = req.cookies?.am_token || req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ ok: false, erro: 'Token não fornecido.' });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ ok: false, erro: 'Token inválido ou expirado.' });
  }

  // Token de integração com escopos (conector Claude): só entra nas áreas dos escopos
  // concedidos. Tokens sem o claim `escopos` (sessões do AM) seguem como sempre.
  if (Array.isArray(req.user.escopos) && !areaPermitidaAoToken(req.baseUrl, req.user.escopos)) {
    return res.status(403).json({ ok: false, erro: 'Token de integração sem permissão para esta área do AM.' });
  }
  next();
}

// Rotas que só um conector com o escopo certo (ou uma sessão normal do AM) pode usar.
// Token OAuth antigo, sem escopos, conta como "acervo".
export function exigirEscopo(escopo) {
  return (req, res, next) => {
    const escopos = escoposDoToken(req.user);
    if (escopos && !escopos.includes(escopo)) {
      return res.status(403).json({
        ok: false,
        escopo_necessario: escopo,
        erro: `O conector não tem a permissão "${ESCOPOS[escopo]?.rotulo || escopo}". `
          + 'Reconecte o conector do AM no Claude e marque essa permissão na tela de autorização.',
      });
    }
    next();
  };
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
