// Valor em reais vindo de tela ou de conector: aceita pt-BR ("812,35", "1.234,56", "R$ 812,35") e
// ponto decimal ("812.35"). Mesma regra do helper do frontend (web/src/lib/valorBR.mjs): com vírgula,
// os pontos são milhar; sem vírgula, só é milhar o padrão "1.234" / "81.235" (grupos de 3 dígitos).
// Inválido devolve 0 (quem chama recusa valor <= 0).
export function parseValorBR(valor) {
  let texto = String(valor ?? '').trim().replace(/R\$/gi, '').replace(/\s/g, '');
  if (!texto) return 0;
  if (texto.includes(',')) texto = texto.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(texto)) texto = texto.replace(/\./g, '');
  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : 0;
}

// Número JSON passa como está; texto passa pelo parseValorBR; qualquer outro tipo (booleano, objeto,
// lista, nulo) é inválido — antes o Number(true) virava R$ 1,00.
export function valorDaCausaDoCorpo(valor) {
  if (typeof valor === 'number') return valor;
  if (typeof valor === 'string') return parseValorBR(valor);
  return NaN;
}
