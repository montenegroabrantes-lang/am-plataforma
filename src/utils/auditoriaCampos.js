// S-13 — ajudantes para montar o "antes e depois" que vai para logs_auditoria.
// Regra: registrar só o que mudou, nunca texto de mensagem enviada a lead nem senha.

// Primeiros 8 caracteres de um id (UUID, contactId do Digisac): identifica sem expor o id inteiro.
export const idCurto = id => (id === null || id === undefined || id === '' ? null : String(id).slice(0, 8));

// Para textos que não devem ser guardados (mensagem a lead, anotação): só o tamanho.
export const tamanhoDoTexto = texto => (typeof texto === 'string' ? texto.length : 0);

// Telefone e e-mail viram uma forma parcial: dá para saber que mudaram sem guardar o dado inteiro.
export function resumirTelefone(valor) {
  const digitos = String(valor ?? '').replace(/\D/g, '');
  return digitos ? `***${digitos.slice(-4)}` : null;
}
export function resumirEmail(valor) {
  const texto = String(valor ?? '').trim();
  const arroba = texto.indexOf('@');
  return arroba > 0 ? `${texto[0]}***${texto.slice(arroba)}` : (texto ? '***' : null);
}

const vazio = v => v === null || v === undefined || v === '';
const numerico = v => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()));
const comoTexto = v => (v instanceof Date ? v.toISOString() : String(v));

// NUMERIC do Postgres chega como "812.35" e o corpo da requisição pode trazer 812.35: mesmo valor.
function iguais(a, b) {
  if (vazio(a) && vazio(b)) return true;
  if (vazio(a) || vazio(b)) return false;
  if (numerico(a) && numerico(b)) return Number(a) === Number(b);
  if (a instanceof Date || b instanceof Date) { // timestamptz do banco x texto ISO do corpo (fusos diferentes)
    const ta = new Date(a).getTime(), tb = new Date(b).getTime();
    if (Number.isFinite(ta) && Number.isFinite(tb)) return ta === tb;
  }
  return comoTexto(a) === comoTexto(b);
}

function normalizar(valor) {
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === 'string' && valor.length > 300) return `${valor.slice(0, 300)}…`;
  return vazio(valor) ? null : valor;
}

// Compara `antes` (linha do banco) com `depois` (o que a rota vai gravar) nos `campos` informados e
// devolve só o que mudou: { antes: {campo: valor}, depois: {campo: valor} }. Campo ausente em
// `depois` (undefined) não foi enviado e não conta.
//  - opcoes.ocultar: campos cujo valor não vai para o log (só a marca "[alterado]");
//  - opcoes.resumir: { campo: função } aplicada aos dois lados (ex.: telefone parcial).
export function diferenca(antes, depois, campos, { ocultar = [], resumir = {} } = {}) {
  const a = {};
  const d = {};
  for (const campo of campos) {
    const novo = depois?.[campo];
    if (novo === undefined) continue;
    const velho = antes?.[campo];
    if (iguais(velho, novo)) continue;
    if (ocultar.includes(campo)) { a[campo] = '[alterado]'; d[campo] = '[alterado]'; continue; }
    const f = resumir[campo];
    a[campo] = normalizar(f ? f(velho) : velho);
    d[campo] = normalizar(f ? f(novo) : novo);
  }
  return { antes: a, depois: d, mudou: Object.keys(d).length > 0 };
}
