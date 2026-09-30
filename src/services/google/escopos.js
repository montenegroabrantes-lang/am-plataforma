// Escopos que o GOOGLE_REFRESH_TOKEN do AM precisa ter. Um token só serve o Drive (pastas de
// cliente, backup), o Calendar (prazos e audiências) e — no código — o Sheets, mas o Sheets
// não é usado na prática (30/09/2026), então NÃO entra: pedir menos permissão é melhor.
//
// Origem do item R-01: o script de reautorização de 21/09 pedia só `drive`; com isso o Calendar
// (que a equipe usa, D11) ficava sem permissão mesmo com o token vivo. Fica num módulo puro,
// sem imports, pra o script de reautorização e o teste diário do token usarem a MESMA lista.
export const ESCOPOS_GOOGLE = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/calendar',
];

// Escopos exigidos que faltam em `concedidos` (array). O consentimento do Google deixa a pessoa
// desmarcar permissões, então "o script pediu" não garante "o token tem".
export function escoposFaltando(concedidos) {
  const tem = new Set(concedidos || []);
  return ESCOPOS_GOOGLE.filter(e => !tem.has(e));
}
