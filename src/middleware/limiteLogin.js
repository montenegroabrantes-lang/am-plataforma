// Limite de senhas erradas por e-mail + IP em POST /api/auth/login (S-02). Divide os contadores
// com o /oauth/authorize (utils/tentativasLogin.js): 10 falhas a cada 15 min do mesmo e-mail no
// mesmo IP. Tentativas de OUTROS IPs contra o mesmo e-mail não trancam quem está no escritório.
//
// Fica como middleware, montado em index.js, para não mexer na rota de login (que outros itens
// do lote também alteram). "Falha" = a rota respondeu 401 (senha ou código 2FA errado); 200
// (entrou, 2FA pedido, primeiro acesso) e 400 (corpo incompleto) não contam.
import { tentativasLogin as contadoresPadrao, limitesPorIpAtivos } from '../utils/tentativasLogin.js';

export function limiteLoginPorEmail({ tentativas = contadoresPadrao, porIpAtivo = limitesPorIpAtivos } = {}) {
  return (req, res, next) => {
    if (req.method !== 'POST') return next();
    const email = req.body?.email;
    if (typeof email !== 'string' || !email.trim()) return next();

    // Sem limite por IP (LIMITES_POR_IP=desligado) as falhas ainda alimentam o teto por e-mail do
    // OAuth, mas o login nunca é bloqueado por este middleware.
    const t = tentativas.iniciar(email, req.ip, { porIp: porIpAtivo() });
    if (t.bloqueio) {
      res.setHeader('Retry-After', String(Math.ceil((t.retryAposMs || 0) / 1000)));
      return res.status(429).json({ ok: false, erro: 'Muitas tentativas. Aguarde 15 minutos.' });
    }
    res.on('finish', () => { if (res.statusCode !== 401) t.desfazer(); });
    next();
  };
}
