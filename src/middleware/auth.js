import jwt from 'jsonwebtoken';
import { areaPermitidaAoToken, escoposDoToken, tokenConectorSemEscopos, ESCOPOS, MSG_CONECTOR_ANTIGO } from '../oauth/escopos.js';
import { estadoUsuario } from './sessao.js';

// `aud` que um token de sessão pode levar (hoje os tokens de sessão não levam `aud`).
const AUD_SESSAO = 'am-sessao';

// Sessão revogável (S-03): além de assinatura e validade, o token só vale se a conta seguir ativa no banco,
// com a mesma versão de sessão (`sv`; token antigo, sem `sv`, conta como versão 0). Perfil, nome, e-mail,
// master_id e pode_marcar_restrito vêm do BANCO (cache de 30 s), então um rebaixamento vale na requisição seguinte.
export async function autenticar(req, res, next) {
  try {
    // Lê do cookie httpOnly primeiro; fallback para Authorization header
    const token = req.cookies?.am_token || req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ ok: false, erro: 'Token não fornecido.' });
    }

    let claims;
    try {
      claims = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ ok: false, erro: 'Token inválido ou expirado.' });
    }

    // Token de finalidade única (primeiro acesso, S-04) nunca vale como sessão: recusa `fin` e `aud`
    // que não seja o de sessão. Token antigo, sem `aud` nem `fin`, segue valendo.
    if (claims.fin || (claims.aud && claims.aud !== AUD_SESSAO)) {
      return res.status(401).json({ ok: false, erro: 'Token inválido ou expirado.' });
    }

    // Token da conta de serviço do conector SEM o claim `escopos` (emitido antes dos escopos de
    // 28/09/2026) valeria como Master em toda a API: recusado em qualquer rota, /mcp incluído.
    // O cliente MCP trata o 401 refazendo a autorização (S-18).
    if (tokenConectorSemEscopos(claims)) {
      return res.status(401).json({ ok: false, erro: MSG_CONECTOR_ANTIGO });
    }

    let estado;
    try {
      estado = await contaAtiva(claims.id, claims, (e) => e?.ativo && Number(e.sessao_versao ?? 0) === Number(claims.sv ?? 0));
      // Token do conector: quem autorizou precisa continuar ativo e Master.
      if (estado && Array.isArray(claims.escopos) && claims.autorizado_por) {
        const aut = await contaAtiva(claims.autorizado_por, claims, (e) => e?.ativo && e.perfil === 'master');
        if (!aut) estado = null;
      }
    } catch (e) {
      // Falha nossa (banco fora) não é sessão vencida: 503 não desloga ninguém no frontend.
      console.error('[autenticar] falha ao consultar a conta:', e.message);
      return res.status(503).json({ ok: false, erro: 'Serviço indisponível — tente novamente em instantes.' });
    }
    if (!estado) {
      return res.status(401).json({ ok: false, erro: 'Sessão encerrada. Faça login novamente.' });
    }

    const doBanco = (campo) => (campo in estado ? estado[campo] : claims[campo]);
    req.user = {
      ...claims,
      nome:                 doBanco('nome'),
      email:                doBanco('email'),
      perfil:               estado.perfil,
      master_id:            doBanco('master_id'),
      pode_marcar_restrito: doBanco('pode_marcar_restrito'),
    };

    // Token de integração com escopos (conector Claude): só entra nas áreas dos escopos
    // concedidos. Tokens sem o claim `escopos` (sessões do AM) seguem como sempre.
    if (Array.isArray(req.user.escopos) && !areaPermitidaAoToken(req.baseUrl, req.user.escopos)) {
      return res.status(403).json({ ok: false, erro: 'Token de integração sem permissão para esta área do AM.' });
    }
    next();
  } catch (e) {
    next(e);
  }
}

// Lê a conta; se o estado em cache reprovar, confirma no banco antes de recusar (cache velho nunca recusa sozinho).
async function contaAtiva(id, claims, vale) {
  let estado = await estadoUsuario(id, { claims });
  if (!vale(estado)) estado = await estadoUsuario(id, { claims, fresco: true });
  return vale(estado) ? estado : null;
}

// Rotas que só um conector com o escopo certo (ou uma sessão normal do AM) pode usar.
// Token OAuth antigo, sem escopos, nem chega aqui (autenticar o recusa); se chegar, não tem escopo.
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
