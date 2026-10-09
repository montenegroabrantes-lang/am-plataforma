// Valor monetário opcional vindo do formulário: vazio → null; número positivo → número; lixo → false.
// Aceita "9.565,98" e 9565.98; recusa negativo e acima de R$ 100 milhões (vírgula/ponto trocados).
export function valorOpcional(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'string' ? Number(v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v) : Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 100_000_000) return false;
  return Math.round(n * 100) / 100;
}
