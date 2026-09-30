// Limites de taxa por usuário / por integração (S-20). Arquivo próprio para não disputar espaço
// com index.js e com os limitadores de login e de /oauth/authorize (S-02), que ficam onde estão.
//
// - IA (rotas pagas, só Master): 20 por hora por usuário, com um contador por rota;
// - /mcp: 60 por minuto por Master que autorizou o conector (`autorizado_por`) — todos os conectores
//   usam o `id` da MESMA conta de serviço, então contar pelo `id` daria um balde só para todos;
// - /api/integracoes: 120 por minuto por IP (a Camila guarda a consulta do cliente em cache por 5 min);
// - /oauth/token e /oauth/register (o /oauth/authorize é do S-02) e /api/webhook: por IP, contadores
//   pequenos, porque são endpoints sem login;
// Os contadores ficam em memória (uma instância só): somem no redeploy, sem efeito colateral.
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import jwt from 'jsonwebtoken';

const MIN = 60 * 1000;
const HORA = 60 * MIN;

const chaveIp = (req) => `ip:${ipKeyGenerator(req.ip ?? '')}`;
// Autenticado: o usuário; rota sem login (ou antes do autenticar): cai no IP.
const chaveUsuario = (req) => (req.user?.id ? `u:${req.user.id}` : chaveIp(req));

function limitador({ janelaMs, max, mensagem, chave = chaveIp, pular }) {
  return rateLimit({
    windowMs: janelaMs, max,
    standardHeaders: true, legacyHeaders: false,
    keyGenerator: chave,
    skip: pular,
    message: { ok: false, erro: mensagem },
  });
}

// Uma instância por rota: `nome` só documenta; cada chamada cria o seu próprio contador.
export function criarLimiteIA(nome = 'ia') {
  return limitador({
    janelaMs: HORA, max: 20, chave: chaveUsuario,
    mensagem: `Limite de chamadas de IA (${nome}) atingido: 20 por hora por usuário. Tente de novo mais tarde.`,
  });
}

// /mcp: quem conta é o Master que autorizou o conector. O token é lido só para escolher o balde
// (a autenticação de verdade continua no `autenticar` do próprio /mcp); sem token válido cai no IP.
export function chaveMcp(req) {
  const cabecalho = String(req.headers?.authorization ?? '');
  const token = req.cookies?.am_token || (cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : '');
  if (token && process.env.JWT_SECRET) {
    try {
      const t = jwt.verify(token, process.env.JWT_SECRET);
      const dono = t?.autorizado_por || t?.id;
      if (dono) return `u:${dono}`;
    } catch { /* token inválido: o autenticar responde 401; aqui só escolhe o balde */ }
  }
  return chaveIp(req);
}

export const limiteMcp = limitador({
  janelaMs: MIN, max: 60, chave: chaveMcp,
  mensagem: 'Muitas chamadas ao conector. Aguarde um minuto.',
});

export const limiteIntegracoes = limitador({
  janelaMs: MIN, max: 120,
  mensagem: 'Muitas requisições de integração. Aguarde um minuto.',
});

export const limiteWebhook = limitador({
  janelaMs: MIN, max: 60,
  mensagem: 'Muitas requisições. Aguarde um minuto.',
});

// Só POST: os GETs de descoberta (/.well-known) e a página do /oauth/authorize não passam por aqui.
const soPost = (req) => req.method !== 'POST';
export const limiteOauthToken = limitador({
  janelaMs: 15 * MIN, max: 30, pular: soPost,
  mensagem: 'Muitas tentativas. Aguarde 15 minutos.',
});
export const limiteOauthRegistro = limitador({
  janelaMs: HORA, max: 10, pular: soPost,
  mensagem: 'Muitos registros de cliente. Aguarde uma hora.',
});
