// Ajudantes para o que vai pro log: identificar sem expor dado pessoal (S-14 / A5-05).
// O telefone mascarado vive em services/digisac/index.js (mascararTelefone), junto de quem o usa.

// "e542bc19" no lugar do uuid inteiro (ou do nome de quem ele identifica): dá pra achar a linha
// no banco, mas o log deixa de carregar nome de cliente.
export function idCurto(id) {
  const s = String(id ?? '').trim();
  return s ? s.slice(0, 8) : '—';
}
