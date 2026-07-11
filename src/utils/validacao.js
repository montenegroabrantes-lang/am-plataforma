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
