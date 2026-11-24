// Decisões do acervo lidas nas publicações do Diário de Justiça Eletrônico Nacional (24/11/2026).
// Spec "AM - Spec Decisoes pelas Publicacoes.md" (Drive, BANCO DE DADOS). Decisões do usuário: grava o
// resultado só quando o dispositivo é inequívoco (senão "a confirmar"); data lida no fecho do texto, com a de
// disponibilização como reserva; decisão monocrática entra sempre "a confirmar".
//
// Etapa 1: leitura (funções puras, testadas com textos no formato real, sem nomes) e escolha da peça.
// O registro em si é `registrarDecisao` da rota do acervo; os ganchos nas importações vêm na etapa 2.

const normalizar = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ');

// Tipo da publicação: 'sentenca' | 'acordao' | 'decisao' | null. Pelo tipo de documento da Comunica API;
// sem ele, pelo título no começo do texto.
export function tipoDecisaoDaPublicacao(pub) {
  const doc = normalizar(pub?.tipo_documento);
  if (/SENTENCA/.test(doc)) return 'sentenca';
  if (/ACORDAO|EMENTA/.test(doc)) return 'acordao';
  if (/^DECISAO|DECISAO MONOCRATICA|DECISAO TERMINATIVA/.test(doc)) return 'decisao';
  if (doc) return null; // despacho, intimação, certidão, ato ordinatório…
  const inicio = normalizar(pub?.texto).slice(0, 400);
  if (/\bS ?E ?N ?T ?E ?N ?C ?A\b/.test(inicio)) return 'sentenca';
  if (/\bACORDAO\b/.test(inicio)) return 'acordao';
  return null;
}

// Dispositivo: o trecho depois da última fórmula de conclusão (sentença) ou do "ACORDAM" (acórdão).
// Sem a fórmula, não há dispositivo seguro: devolve null (a decisão fica "a confirmar").
const FORMULAS_SENTENCA = /(ANTE O EXPOSTO|DIANTE DO EXPOSTO|EM FACE DO EXPOSTO|PELO EXPOSTO|POR TODO O EXPOSTO|ISTO POSTO|ISSO POSTO|POSTO ISSO|DO EXPOSTO|ANTE O EXPENDIDO|DIANTE DO QUE FOI EXPOSTO|DISPOSITIVO)/g;
const FORMULAS_ACORDAO = /(ACORDAM|ACORDA A |DECIDE A |VISTOS, RELATADOS E DISCUTIDOS)/g;
export function extrairDispositivo(texto, tipo) {
  const t = normalizar(texto);
  const re = tipo === 'acordao' ? FORMULAS_ACORDAO : FORMULAS_SENTENCA;
  let ultimo = -1;
  for (const m of t.matchAll(re)) ultimo = m.index;
  if (ultimo < 0 && tipo === 'acordao') { // acórdão sem "ACORDAM": usa o dispositivo de decisão do relator
    for (const m of t.matchAll(FORMULAS_SENTENCA)) ultimo = m.index;
  }
  return ultimo < 0 ? null : t.slice(ultimo, ultimo + 1500);
}

// Resultados reconhecidos no dispositivo. A ordem importa só para leitura; a decisão exige UM resultado.
const PADROES = {
  sentenca: [
    ['parcialmente-procedente', /JULGO(-SE)? PARCIALMENTE PROCEDENTE|JULGO(-SE)? PROCEDENTES? EM PARTE|PARCIALMENTE PROCEDENTES? O/],
    ['improcedente', /JULGO(-SE)? (TOTALMENTE )?IMPROCEDENTE|IMPROCEDENTES? (O|OS) PEDIDOS?|JULGO(-SE)? IMPROCEDENTES (O|OS) PEDIDOS/],
    ['procedente', /JULGO(-SE)? (TOTALMENTE )?PROCEDENTES?(?! EM PARTE)|(?<!IM)(?<!PARCIALMENTE )PROCEDENTES? (O|OS) PEDIDOS?(?! EM PARTE)/],
    ['acordo', /HOMOLOGO(,? POR SENTENCA,?)? (O |A )?(ACORDO|TRANSACAO)/],
    ['desistencia', /HOMOLOGO(,? POR SENTENCA,?)? (O PEDIDO DE |A )?DESISTENCIA/],
    ['extinto-sem-merito', /EXTINGO O (PROCESSO|FEITO)(,)? SEM (RESOLUCAO|JULGAMENTO) D[OE] MERITO|INDEFIRO A PETICAO INICIAL/],
  ],
  acordao: [
    ['nao-conhecido', /NAO CONHEC(ER|EU|O|IDO)|RECURSO NAO CONHECIDO/],
    ['parcialmente-provido', /(DAR|DOU|DEU|DERAM|DA-SE)(-LHE)? PARCIAL PROVIMENTO|PROVIMENTO PARCIAL|PARCIALMENTE PROVIDO/],
    ['desprovido', /(NEGAR|NEGO|NEGOU|NEGARAM|NEGA-SE)(-LHE)? PROVIMENTO|\bDESPROVIDO|\bNAO PROVIDO|\bIMPROVIDO/],
    ['provido', /\b(DAR|DOU|DEU|DERAM|DA-SE)(-LHE)? PROVIMENTO|\bRECURSO PROVIDO/],
  ],
};

// Resultado técnico do dispositivo, ou null quando nenhum ou mais de um aparece (fica "a confirmar").
// Decisão monocrática: sempre null (decisão do usuário, 24/11/2026).
export function classificarResultado(dispositivo, tipo) {
  if (!dispositivo || tipo === 'decisao') return null;
  const achados = new Set();
  for (const [resultado, re] of PADROES[tipo] ?? []) if (re.test(dispositivo)) achados.add(resultado);
  return achados.size === 1 ? [...achados][0] : null;
}

const MESES = { JANEIRO: 1, FEVEREIRO: 2, MARCO: 3, ABRIL: 4, MAIO: 5, JUNHO: 6, JULHO: 7, AGOSTO: 8, SETEMBRO: 9, OUTUBRO: 10, NOVEMBRO: 11, DEZEMBRO: 12 };
// Data da decisão: a última data por extenso do texto ("João Pessoa, 18 de novembro de 2026"), se for plausível
// (não depois da disponibilização nem mais de um ano antes). Senão, null.
export function extrairDataDecisao(texto, dataDisponibilizacao = null) {
  const t = normalizar(texto);
  let ultima = null;
  for (const m of t.matchAll(/\b(\d{1,2})(?:º|O)? DE (JANEIRO|FEVEREIRO|MARCO|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO) DE (\d{4})\b/g)) {
    const d = Number(m[1]); const mes = MESES[m[2]]; const a = Number(m[3]);
    if (d >= 1 && d <= 31) ultima = `${a}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  if (!ultima) return null;
  const disp = String(dataDisponibilizacao ?? '').slice(0, 10);
  if (disp && /^\d{4}-\d{2}-\d{2}$/.test(disp)) {
    if (ultima > disp) return null;
    const umAnoAntes = `${Number(disp.slice(0, 4)) - 1}${disp.slice(4)}`;
    if (ultima < umAnoAntes) return null;
  }
  return ultima;
}

// Peça do acervo que a decisão julga. Sentença → peça de 1º grau; acórdão → peça recursal; decisão monocrática →
// recursal primeiro, senão 1º grau. Só peça pendente, sem decisão registrada, protocolada até a data da decisão.
// Mais de uma: a de protocolo mais recente.
export const PECAS_PRIMEIRO_GRAU = new Set(['inicial', 'emenda-inicial', 'impugnacao-contestacao', 'especificacao-provas', 'memorial']);
export const PECAS_RECURSAIS = new Set(['recurso-inominado', 'apelacao', 'contrarrazoes', 'agravo', 'embargos-declaracao', 'recurso-especial', 'recurso-extraordinario']);
export function escolherPeca(pecas, { tipo, data }) {
  const aptas = pecas.filter(p => p.resultado === 'pendente' && !p.decisao_id && !p.arquivada_em
    && (!p.data_protocolo || String(p.data_protocolo).slice(0, 10) <= data));
  const porData = l => [...l].sort((a, b) => String(b.data_protocolo ?? '').localeCompare(String(a.data_protocolo ?? '')))[0] ?? null;
  const de = conj => porData(aptas.filter(p => conj.has(p.tipo_peca)));
  if (tipo === 'sentenca') return de(PECAS_PRIMEIRO_GRAU);
  if (tipo === 'acordao') return de(PECAS_RECURSAIS);
  if (tipo === 'decisao') return de(PECAS_RECURSAIS) ?? de(PECAS_PRIMEIRO_GRAU);
  return null;
}

// Monta os dados para registrarDecisao a partir de uma publicação e da peça escolhida. Devolve null se a
// publicação não for decisão.
export function dadosDaDecisao(pub) {
  const tipo = tipoDecisaoDaPublicacao(pub);
  if (!tipo) return null;
  const dispositivo = extrairDispositivo(pub.texto, tipo);
  const resultado = classificarResultado(dispositivo, tipo);
  const disp = String(pub.data_disponibilizacao ?? '').slice(0, 10);
  const data = extrairDataDecisao(pub.texto, disp) || disp;
  const trecho = (dispositivo ?? normalizar(pub.texto).slice(0, 600)).slice(0, 700);
  return {
    tipo,
    data,
    resultado,
    tipo_decisao: tipo === 'sentenca' ? 'Sentença' : tipo === 'acordao' ? 'Acórdão' : 'Decisão',
    evidencia: `${disp.split('-').reverse().join('/')} — ${pub.tribunal ?? ''} ${pub.orgao ?? ''} — ${trecho}`.replace(/\s+/g, ' ').slice(0, 1000),
  };
}
