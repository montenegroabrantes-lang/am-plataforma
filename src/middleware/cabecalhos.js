// Cabeçalhos de segurança do backend (S-19). Equivale ao `helmet` na configuração do plano, sem
// dependência nova (o `helmet` não está instalado; se entrar depois, este arquivo some).
//
// - Sem CSP aqui: a API responde JSON. A única CSP do backend é a da tela de autorização do
//   conector, em oauth/index.js (`default-src 'none'`, `form-action` só com os retornos do Claude).
// - Sem Cross-Origin-Opener-Policy nem Cross-Origin-Resource-Policy: o frontend é de outro site
//   (up.railway.app) e o fluxo do Claude atravessa origens; eles não podem interferir.
// - HSTS de 180 dias, sem `preload`.
// O `X-Powered-By` sai com app.disable('x-powered-by') em index.js (e daqui, por garantia).
export function cabecalhosSeguranca({ hstsSegundos = 180 * 24 * 60 * 60 } = {}) {
  return (_req, res, next) => {
    res.removeHeader('X-Powered-By');
    res.setHeader('Strict-Transport-Security', `max-age=${hstsSegundos}; includeSubDomains`);
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader('X-XSS-Protection', '0');
    next();
  };
}
