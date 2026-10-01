// S-22 — busca em tabela de filtros usando um valor que veio do cliente (query string).
// `TABELA[chave]` também encontra as propriedades herdadas do Object ("constructor", "__proto__",
// "toString"...): `?fila=constructor` virava SQL inválido (500) ou chamava a função errada.
// Só as chaves próprias da tabela contam; qualquer outra coisa devolve undefined.
export const daTabela = (tabela, chave) =>
  (typeof chave === 'string' && Object.hasOwn(tabela, chave) ? tabela[chave] : undefined);
