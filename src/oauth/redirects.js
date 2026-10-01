// Endereços de retorno (redirect_uri) que o registro dinâmico do conector aceita (S-07).
//
// Sem esta lista, qualquer pessoa registrava um cliente com um retorno dela e mandava a vítima
// para a tela de autorização do AM: o código de autorização (e, com ele, o token do conector)
// seria entregue ao site do atacante (phishing de consentimento).
//
// A lista vem de OAUTH_REDIRECTS_PERMITIDOS (separada por vírgula ou espaço). Sem a variável,
// vale o padrão abaixo. Cada item é:
// - uma URL exata (`https://claude.ai/api/mcp/auth_callback`): protocolo, host, porta e caminho
//   iguais; a comparação é feita com a URL já interpretada, nunca por prefixo de texto;
// - `http://localhost:*` ou `http://127.0.0.1:*`: retorno local (Claude Code, que sobe um
//   servidor numa porta sorteada da própria máquina). Qualquer porta; com caminho
//   (`http://localhost:*/callback`) só aquele caminho. O código só chega à máquina de quem
//   autoriza.
// Se o Claude mudar o endereço de retorno, basta acrescentá-lo na variável (sem mudar código).
const PADRAO = [
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
  'http://localhost:*',
  'http://127.0.0.1:*',
];
const LOOPBACK = /^http:\/\/(localhost|127\.0\.0\.1):\*(\/.*)?$/;
const MAX_URI = 512;

function compilar(item) {
  const m = LOOPBACK.exec(item);
  if (m) return { tipo: 'loopback', host: m[1], caminho: m[2] && m[2] !== '/' ? m[2] : null };
  try {
    const u = new URL(item);
    if (u.protocol !== 'https:') {
      console.warn(`[OAuth] OAUTH_REDIRECTS_PERMITIDOS: item ignorado (só https, ou http://localhost:* / http://127.0.0.1:*): ${u.host}`);
      return null;
    }
    return { tipo: 'exata', protocolo: u.protocol, host: u.host, caminho: u.pathname };
  } catch {
    console.warn('[OAuth] OAUTH_REDIRECTS_PERMITIDOS: item inválido ignorado.');
    return null;
  }
}

export function lerRedirectsPermitidos(valor = process.env.OAUTH_REDIRECTS_PERMITIDOS) {
  const itens = String(valor ?? '').split(/[\s,]+/).filter(Boolean);
  const entradas = (itens.length ? itens : PADRAO).map(compilar).filter(Boolean);
  // Variável definida só com lixo: melhor voltar ao padrão do que ficar sem nenhum retorno válido.
  return entradas.length ? entradas : PADRAO.map(compilar);
}

export function redirectPermitido(uri, entradas) {
  // Espaço e caracteres de controle: o parser de URL os descarta em silêncio, e o texto guardado
  // deixaria de ser o que foi validado.
  if (typeof uri !== 'string' || !uri || uri.length > MAX_URI || /[\u0000- \u007f]/.test(uri)) return false;
  let u;
  try { u = new URL(uri); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (uri.includes('#') || u.hash) return false;       // RFC 6749 §3.1.2: sem fragmento
  if (u.username || u.password) return false;          // https://claude.ai@outro.site/...
  return entradas.some(e => (e.tipo === 'loopback'
    ? u.protocol === 'http:' && u.hostname === e.host && (!e.caminho || u.pathname === e.caminho)
    : u.protocol === e.protocolo && u.host === e.host && u.pathname === e.caminho));
}

// Origens para o `form-action` da CSP da tela de autorização: o Chrome aplica a regra também ao
// 302 que vem depois do POST, então o destino do retorno precisa estar na lista.
export function fontesFormAction(entradas) {
  const fontes = entradas.map(e => (e.tipo === 'loopback' ? `http://${e.host}:*` : `${e.protocolo}//${e.host}`));
  return [...new Set(fontes)];
}

// Host mostrado ao Master na tela de autorização ("Retorno para: claude.ai").
export function hostDoRetorno(uri) {
  try { return new URL(uri).host; } catch { return ''; }
}
