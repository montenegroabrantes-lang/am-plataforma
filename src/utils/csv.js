// S-25 — exportação CSV sem injeção de fórmula. Uma célula que começa com = + - @ (ou TAB / CR)
// é lida como fórmula pelo Excel e pelo Calc: `=HYPERLINK(...)` vindo de um campo de texto (vara,
// polo passivo, nome de cliente) rodaria na máquina de quem abrir a planilha. Um apóstrofo na frente
// faz a célula virar texto; ele não aparece na planilha.
const COMECA_COMO_FORMULA = /^[=+\-@\t\r]/;

export const neutralizarFormula = texto => (COMECA_COMO_FORMULA.test(texto) ? `'${texto}` : texto);

// Célula CSV: neutraliza a fórmula, dobra as aspas e envolve em aspas.
export const celulaCsv = valor => `"${neutralizarFormula(String(valor ?? '')).replace(/"/g, '""')}"`;
