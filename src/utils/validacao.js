const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidValido(v) {
  return typeof v === 'string' && UUID_RE.test(v);
}

// Clampa page/limite pra nunca virar OFFSET/LIMIT negativo ou NaN no Postgres
// (que devolve 500 cru — ver auditoria de segurança).
export function paginacaoSegura(pagina, limite, limiteMax = 200) {
  const p = Math.max(1, Number.isFinite(Number(pagina)) ? Number(pagina) : 1);
  const l = Math.min(limiteMax, Math.max(1, Number.isFinite(Number(limite)) ? Number(limite) : 30));
  return { pagina: p, limite: l, offset: (p - 1) * l };
}

// Links que o sistema grava e depois abre num clique (acervo, publicações, conector): só
// https:// com endereço (S-23). `javascript:`, `data:`, `http:`, `file:` etc. viram null.
// Devolve o texto original (sem espaços nas pontas), não uma URL reescrita, para não
// alterar links legítimos já gravados. Rejeita também endereço com usuário/senha embutidos
// (https://claude.ai@outro-site.com engana quem lê o link) e com espaço ou caractere de controle.
export function urlHttpsOuNulo(v) {
  if (typeof v !== 'string') return null;
  const texto = v.trim();
  if (!/^https:\/\/[^\s/\\]/i.test(texto) || /[\u0000-\u001f\u007f\s]/.test(texto)) return null;
  let u;
  try { u = new URL(texto); } catch { return null; }
  if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) return null;
  return texto;
}
