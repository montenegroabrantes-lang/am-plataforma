// Padrão de layout das peças do escritório (aprovado pelo usuário em 09/10/2026).
//
// A peça chega em blocos (endereçamento, parágrafos, seções, citações, alíneas, tabela, fecho) e
// sai como .docx já no padrão: A4 com margens ABNT (3/3/2/2 cm), Arial 12, espaçamento 1,5,
// cabeçalho "ABRANTES & MONTENEGRO ADVOGADOS", rodapé centralizado com endereço, telefone, e-mail e
// "Página X de Y". Subir esse .docx ao Drive convertendo em Google Doc preserva página, cabeçalho e
// rodapé — não depende da Google Docs API (desabilitada no projeto Google em 09/10/2026).
//
// Decisões do usuário que este módulo fixa:
// - endereçamento padrão do escritório, caixa alta, sem negrito, com espaço grande abaixo;
// - qualificação sem "(procuração anexa)" e sem remissão ao rodapé (isso é do texto, não do layout);
// - sem quadro-síntese; valor da causa sem negrito;
// - fecho e assinaturas alinhados à esquerda com recuo de 4 cm, nome e OAB em negrito;
// - rodapé centralizado.
// Ainda em aberto (valores atuais são os da amostra): logo no cabeçalho, azul-marinho x preto e a
// fórmula do fecho — ajustar só as constantes abaixo.

import {
  Document, Packer, Paragraph, TextRun, AlignmentType, Header, Footer, PageNumber, Table, TableRow,
  TableCell, WidthType, BorderStyle, ShadingType,
} from 'docx';

export const PADRAO = {
  fonte: 'Arial',
  cor: '1F2A44', // azul-marinho dos títulos e filetes
  cinza: '6B7280',
  enderecamento: 'AO JUÍZO COMPETENTE PARA OS FEITOS DA FAZENDA PÚBLICA',
  fecho: 'Pede deferimento.',
  localData: 'João Pessoa (PB), data do protocolo eletrônico.',
  advogados: [
    { nome: 'RAMON OLIVEIRA ABRANTES', oab: 'OAB/PB 23.395' },
    { nome: 'LUCIANO MONTENEGRO L. R. CARVALHO', oab: 'OAB/PB 23.176' },
  ],
  cabecalho: ['ABRANTES & MONTENEGRO', 'ADVOGADOS'],
  rodape: [
    'Av. Cabo Branco, 1780 – Cabo Branco, João Pessoa – PB, 58045-010',
    '(83) 3142-9844  ·  atendimento@abrantesemontenegro.com.br',
  ],
};

export const TIPOS_BLOCO = ['enderecamento', 'paragrafo', 'titulo_acao', 'secao', 'subsecao', 'citacao', 'alinea', 'tabela', 'fecho'];

const CM = 567; // DXA por centímetro
const A4 = { largura: 11906, altura: 16838 };
const MARGEM = { top: 3 * CM, bottom: 2 * CM, left: 3 * CM, right: 2 * CM };
const LARGURA_UTIL = A4.largura - MARGEM.left - MARGEM.right;
const TAM = { corpo: 24, citacao: 22, tabela: 20, oab: 20, cabecalho: 18, rodape: 16 }; // meio-pontos

function erroValidacao(mensagem) { const e = new Error(mensagem); e.status = 422; return e; }

// **negrito** é a única marcação aceita dentro do texto.
export function trechos(texto, base = {}) {
  const partes = String(texto ?? '').split(/(\*\*[^*]+\*\*)/).filter(Boolean);
  return partes.map(p => {
    const negrito = /^\*\*[^*]+\*\*$/.test(p);
    return new TextRun({ text: negrito ? p.slice(2, -2) : p, font: PADRAO.fonte, size: TAM.corpo, ...base, ...(negrito ? { bold: true } : {}) });
  });
}

const filete = (lado, cor = PADRAO.cor, tamanho = 6) => ({ [lado]: { style: BorderStyle.SINGLE, size: tamanho, color: cor, space: 4 } });

function bloco(b) {
  const texto = typeof b.texto === 'string' ? b.texto.trim() : '';
  switch (b.tipo) {
    case 'enderecamento':
      return [new Paragraph({ children: trechos(texto || PADRAO.enderecamento), alignment: AlignmentType.JUSTIFIED, spacing: { after: 2400 } })];
    case 'paragrafo':
      if (!texto) throw erroValidacao('Parágrafo sem texto.');
      return [new Paragraph({
        children: trechos(texto), alignment: AlignmentType.JUSTIFIED,
        indent: { firstLine: b.recuo === false ? 0 : 2 * CM }, spacing: { line: 360, after: 200 },
      })];
    case 'titulo_acao':
      if (!texto) throw erroValidacao('Título da ação sem texto.');
      return [new Paragraph({
        children: trechos(texto.toUpperCase(), { bold: true, size: 26, color: PADRAO.cor }), alignment: AlignmentType.CENTER,
        spacing: { before: 240, after: 240 }, border: { ...filete('top'), ...filete('bottom') },
      })];
    case 'secao':
      if (!texto) throw erroValidacao('Seção sem título.');
      return [new Paragraph({
        children: trechos(`${b.numero ? `${b.numero}  ` : ''}${texto.toUpperCase()}`, { bold: true, color: PADRAO.cor }),
        spacing: { before: 360, after: 200 }, keepNext: true, border: filete('bottom'),
      })];
    case 'subsecao':
      if (!texto) throw erroValidacao('Subseção sem título.');
      return [new Paragraph({ children: trechos(`${b.numero ? `${b.numero}  ` : ''}${texto}`, { bold: true }), spacing: { before: 240, after: 160 }, keepNext: true })];
    case 'citacao': {
      if (!texto) throw erroValidacao('Citação sem texto.');
      const fonte = typeof b.fonte === 'string' && b.fonte.trim() ? [new TextRun({ text: ` ${b.fonte.trim()}`, font: PADRAO.fonte, size: TAM.citacao, color: PADRAO.cinza })] : [];
      return [new Paragraph({
        children: [...trechos(texto, { size: TAM.citacao }), ...fonte], alignment: AlignmentType.JUSTIFIED,
        indent: { left: 4 * CM }, spacing: { line: 240, after: 240 },
      })];
    }
    case 'alinea':
      if (!texto) throw erroValidacao('Alínea sem texto.');
      return [new Paragraph({ children: trechos(texto), alignment: AlignmentType.JUSTIFIED, spacing: { line: 360, after: 200 } })];
    case 'tabela':
      return [tabela(b), new Paragraph({ children: [], spacing: { after: 120 } })];
    case 'fecho': {
      const esq = (children, spacing) => new Paragraph({ children, alignment: AlignmentType.LEFT, indent: { left: 4 * CM }, spacing });
      const out = [
        esq(trechos(PADRAO.fecho), { before: 480, after: 120 }),
        esq(trechos(typeof b.local_data === 'string' && b.local_data.trim() ? b.local_data.trim() : PADRAO.localData), { after: 720 }),
      ];
      PADRAO.advogados.forEach((a, i) => {
        out.push(esq(trechos(a.nome, { bold: true }), { after: 0 }));
        out.push(esq(trechos(a.oab, { bold: true, size: TAM.oab }), { after: i < PADRAO.advogados.length - 1 ? 480 : 0 }));
      });
      return out;
    }
    default:
      throw erroValidacao(`Tipo de bloco inválido: ${b.tipo}. Use: ${TIPOS_BLOCO.join(', ')}.`);
  }
}

function tabela(b) {
  const cab = Array.isArray(b.cabecalho) ? b.cabecalho.map(String) : [];
  const linhas = Array.isArray(b.linhas) ? b.linhas.map(l => (Array.isArray(l) ? l.map(String) : [])) : [];
  const n = cab.length || linhas[0]?.length || 0;
  if (!n || !linhas.length) throw erroValidacao('Tabela precisa de cabeçalho e ao menos uma linha.');
  if (linhas.some(l => l.length !== n)) throw erroValidacao('Todas as linhas da tabela precisam ter o mesmo número de colunas do cabeçalho.');
  const larg = Math.floor(LARGURA_UTIL / n);
  const colunas = Array.from({ length: n }, (_, i) => (i === n - 1 ? LARGURA_UTIL - larg * (n - 1) : larg));
  const borda = { style: BorderStyle.SINGLE, size: 4, color: '9AA3B5' };
  const bordas = { top: borda, bottom: borda, left: borda, right: borda };
  const celula = (txt, i, topo) => new TableCell({
    width: { size: colunas[i], type: WidthType.DXA }, borders: bordas, margins: { top: 60, bottom: 60, left: 100, right: 100 },
    ...(topo ? { shading: { type: ShadingType.CLEAR, fill: PADRAO.cor, color: 'auto' } } : {}),
    children: [new Paragraph({ alignment: AlignmentType.CENTER, children: trechos(txt, { size: TAM.tabela, ...(topo ? { bold: true, color: 'FFFFFF' } : {}) }) })],
  });
  const rows = [];
  if (cab.length) rows.push(new TableRow({ tableHeader: true, children: cab.map((c, i) => celula(c, i, true)) }));
  for (const l of linhas) rows.push(new TableRow({ children: l.map((c, i) => celula(c, i, false)) }));
  return new Table({ width: { size: LARGURA_UTIL, type: WidthType.DXA }, columnWidths: colunas, rows });
}

function cabecalho() {
  const [nome, sufixo] = PADRAO.cabecalho;
  return new Header({ children: [new Paragraph({
    alignment: AlignmentType.RIGHT, border: filete('bottom', 'C9CFDA', 4),
    children: [
      new TextRun({ text: nome, font: PADRAO.fonte, size: TAM.cabecalho, bold: true, color: PADRAO.cor, characterSpacing: 40 }),
      new TextRun({ text: `  ${sufixo}`, font: PADRAO.fonte, size: TAM.cabecalho, color: PADRAO.cinza, characterSpacing: 40 }),
    ],
  })] });
}

function rodape() {
  const base = { font: PADRAO.fonte, size: TAM.rodape, color: PADRAO.cinza };
  return new Footer({ children: [new Paragraph({
    alignment: AlignmentType.CENTER, border: filete('top', 'C9CFDA', 4),
    children: [
      ...PADRAO.rodape.map((t, i) => new TextRun({ text: t, ...base, ...(i ? { break: 1 } : {}) })),
      new TextRun({ children: ['Página ', PageNumber.CURRENT, ' de ', PageNumber.TOTAL_PAGES], ...base, break: 1 }),
    ],
  })] });
}

export async function montarDocxPeca(blocos) {
  if (!Array.isArray(blocos) || !blocos.length) throw erroValidacao('Envie a peça em blocos (lista não vazia).');
  if (blocos.length > 2000) throw erroValidacao('Peça longa demais (máximo 2000 blocos).');
  const children = blocos.flatMap(b => bloco(b || {}));
  const doc = new Document({
    styles: { default: { document: { run: { font: PADRAO.fonte, size: TAM.corpo } } } },
    sections: [{
      properties: { page: { size: { width: A4.largura, height: A4.altura }, margin: { ...MARGEM, header: Math.round(1.2 * CM), footer: CM } } },
      headers: { default: cabecalho() },
      footers: { default: rodape() },
      children,
    }],
  });
  return Packer.toBuffer(doc);
}
