// Peças no padrão de layout do escritório, montadas em Word no próprio AM e gravadas na pasta do
// cliente em PDF (exigência do PJe) e/ou .docx.
//
// Padrão = arquivo "PADRAO __2_AMOSTRA - NOVO LAYOUT - INICIAL EMLUR.docx" (Drive › BANCO DE DADOS ›
// LAYOUT - PETICOES), aprovado pelo usuário em 09/10/2026: A4, margens 3/3/2/2 cm, Arial 12,
// espaçamento 1,5, recuo de 2 cm; cabeçalho "ABRANTES & MONTENEGRO ADVOGADOS"; rodapé centralizado com
// endereço, telefone, e-mail e "Página X de Y"; endereçamento sem negrito com espaço grande abaixo;
// nome da ação em azul-marinho entre filetes; seções numeradas (1, 2, 3...) em azul-marinho com filete;
// subseções (3.1...) em negrito; citação recuada 4 cm em 11 pt com a fonte em cinza; fecho e
// assinaturas à esquerda com recuo de 4 cm. Os valores abaixo são os do arquivo-modelo.
//
// O PDF é gerado no próprio servidor pelo LibreOffice (instalado no Dockerfile), a partir do Word:
// resultado determinístico, sem depender do Google Docs. Antes de gravar, o PDF é conferido
// (tamanho de página A4, número de páginas e presença do texto de abertura); se a conferência
// falhar, nada é gravado e o erro volta para quem chamou — em lote, nenhuma peça sai fora do padrão
// em silêncio.

import { Readable } from 'node:stream';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { google } from 'googleapis';
import {
  AlignmentType, BorderStyle, Document, Footer, Header, LineRuleType, Packer, PageNumber, PageOrientation,
  Paragraph, ShadingType, Table, TableCell, TableLayoutType, TableRow, TextRun, VerticalAlign, WidthType,
} from 'docx';
import { conferirPastaDestino, nomeSeguro } from './documentos.js';

export const TIPOS_BLOCO = ['enderecamento', 'paragrafo', 'acao', 'titulo', 'subtitulo', 'citacao', 'pedido', 'tabela', 'fecho', 'assinaturas'];
const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const CM = 567; // twips por centímetro
const FONTE = 'Arial';
const AZUL = '1F2A44';   // títulos, filetes e cabeçalho
const CINZA = '6B7280';  // rodapé, fonte das citações
const FILETE_CLARO = 'C9CFDA';
const ADVOGADOS = [['RAMON OLIVEIRA ABRANTES', 'OAB/PB 23.395'], ['LUCIANO MONTENEGRO L. R. CARVALHO', 'OAB/PB 23.176']];
const RODAPE = ['Av. Cabo Branco, 1780 – Cabo Branco, João Pessoa – PB, 58045-010', '(83) 3142-9844 · atendimento@abrantesemontenegro.com.br'];
const ROMANOS = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12, XIII: 13, XIV: 14, XV: 15 };

function erroValidacao(mensagem, status = 422) { const e = new Error(mensagem); e.status = status; return e; }

// "texto com **negrito**" → runs (tamanho em meio-pontos).
export function trechos(texto, { tamanho = 24, negrito = false, cor } = {}) {
  return String(texto ?? '').split('**')
    .map((t, i) => new TextRun({ text: t, bold: negrito || i % 2 === 1, font: FONTE, size: tamanho, ...(cor ? { color: cor } : {}) }))
    .filter((r, i, a) => a.length === 1 || String(texto).split('**')[i]);
}

const linha15 = { line: 360, lineRule: LineRuleType.AUTO };
const filete = (cor, tamanho, espaco) => ({ style: BorderStyle.SINGLE, size: tamanho, color: cor, space: espaco });
const semNegrito = t => String(t ?? '').replace(/\*\*/g, '');
const paragrafoCorpo = (children, extra = {}) => new Paragraph({ children, alignment: AlignmentType.JUSTIFIED, spacing: { ...linha15, after: 200 }, ...extra });
const aEsquerda4cm = (children, spacing, juntoAoSeguinte = true) => new Paragraph({
  children, alignment: AlignmentType.LEFT, indent: { left: 4 * CM }, spacing, keepNext: juntoAoSeguinte, keepLines: true,
});

// "IV — DO DIREITO" → número 4 e "DO DIREITO"; "4  DO DIREITO" ou "4 DO DIREITO" também valem.
function numeroDaSecao(texto) {
  const romano = String(texto).match(/^([IVX]+)\s*[—–.-]\s*(.+)$/);
  if (romano && ROMANOS[romano[1]]) return [ROMANOS[romano[1]], romano[2]];
  const arabe = String(texto).match(/^(\d+)[.)]?\s+(.+)$/);
  return arabe ? [Number(arabe[1]), arabe[2]] : [null, texto];
}

// Monta os parágrafos na ordem, com o contexto de numeração das seções.
function paragrafos(blocos) {
  const out = [];
  let secao = 0; let sub = 0; let anterior = null;
  for (const bloco of blocos) {
    const t = bloco.tipo === 'tabela' ? '' : String(bloco.texto ?? '').trim();
    switch (bloco.tipo) {
      case 'enderecamento':
        out.push(new Paragraph({ children: trechos(semNegrito(t)), alignment: AlignmentType.JUSTIFIED, spacing: { after: 2400 } }));
        break;
      case 'acao':
        out.push(new Paragraph({
          children: trechos(semNegrito(t).toUpperCase(), { negrito: true, tamanho: 26, cor: AZUL }), alignment: AlignmentType.CENTER,
          border: { top: filete(AZUL, 6, 6), bottom: filete(AZUL, 6, 6) }, spacing: { before: 240, after: 240 },
        }));
        break;
      case 'titulo': {
        const [n, nome] = numeroDaSecao(semNegrito(t));
        secao = n ?? secao + 1; sub = 0;
        out.push(new Paragraph({
          children: trechos(`${secao}  ${nome.toUpperCase()}`, { negrito: true, cor: AZUL }), keepNext: true,
          border: { bottom: filete(AZUL, 6, 4) }, spacing: { before: 360, after: 200 },
        }));
        break;
      }
      case 'subtitulo': {
        sub += 1;
        const nome = semNegrito(t).replace(/^([A-Z]|\d+(\.\d+)*)[.)]\s+/, '');
        out.push(new Paragraph({ children: trechos(`${secao ? `${secao}.${sub}  ` : ''}${nome}`, { negrito: true }), keepNext: true, spacing: { before: 240, after: 160 } }));
        break;
      }
      case 'citacao': {
        // A referência final entre parênteses, depois das aspas, sai em cinza, como no modelo.
        const m = t.match(/^([\s\S]*[”"])\s+(\([^()]*(?:\([^()]*\)[^()]*)*\))$/);
        const children = m
          ? [...trechos(m[1], { tamanho: 22 }), ...trechos(` ${semNegrito(m[2])}`, { tamanho: 22, cor: CINZA })]
          : trechos(t, { tamanho: 22 });
        out.push(new Paragraph({ children, alignment: AlignmentType.JUSTIFIED, indent: { left: 4 * CM }, spacing: { after: 240 } }));
        break;
      }
      case 'paragrafo':
      case 'pedido':
        if (bloco.tipo === 'paragrafo' && /^pede deferimento\.?$/i.test(semNegrito(t))) {
          out.push(aEsquerda4cm(trechos(t), { before: 480, after: 120 }));
        } else if (anterior === 'acao' && /^em face d/i.test(semNegrito(t))) {
          out.push(paragrafoCorpo(trechos(t)));
        } else {
          // O valor da causa acompanha o fecho: assinatura nunca fica sozinha na página.
          const fim = /^dá-se à causa/i.test(semNegrito(t)) ? { keepNext: true, keepLines: true } : {};
          out.push(paragrafoCorpo(trechos(t), { indent: { firstLine: 2 * CM }, ...fim }));
        }
        break;
      case 'fecho':
        out.push(aEsquerda4cm(trechos(t), { after: 720 }));
        break;
      case 'assinaturas':
        ADVOGADOS.forEach(([nome, oab], i) => {
          const ultimo = i === ADVOGADOS.length - 1;
          out.push(aEsquerda4cm(trechos(nome, { negrito: true }), { after: 0 }));
          out.push(aEsquerda4cm(trechos(oab, { negrito: true, tamanho: 20 }), { after: ultimo ? 0 : 480 }, !ultimo));
        });
        break;
      case 'tabela':
        out.push(...tabela(bloco));
        break;
      default:
        throw erroValidacao(`Tipo de bloco inválido: ${bloco.tipo}`);
    }
    anterior = bloco.tipo;
  }
  return out;
}

function tabela(bloco, larguraUtil) {
  const linhas = bloco.linhas || [];
  if (!linhas.length || !Array.isArray(linhas[0])) throw erroValidacao('Tabela sem linhas.');
  const n = Math.max(...linhas.map(l => l.length));
  const util = larguraUtil ?? tabela.larguraUtil;
  const larg = Math.floor(util / n);
  const colunas = Array.from({ length: n }, (_, i) => (i === n - 1 ? util - larg * (n - 1) : larg));
  const borda = filete('9AA3B5', 4, 0);
  const bordas = { top: borda, bottom: borda, left: borda, right: borda };
  return [
    new Table({
      width: { size: util, type: WidthType.DXA }, columnWidths: colunas, layout: TableLayoutType.FIXED,
      rows: linhas.map((cels, i) => new TableRow({
        tableHeader: i === 0, cantSplit: true,
        children: colunas.map((largura, j) => new TableCell({
          width: { size: largura, type: WidthType.DXA }, borders: bordas, verticalAlign: VerticalAlign.CENTER,
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          ...(i === 0 ? { shading: { type: ShadingType.CLEAR, fill: AZUL, color: 'auto' } } : {}),
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: trechos(cels[j] ?? '', { tamanho: 20, ...(i === 0 ? { negrito: true, cor: 'FFFFFF' } : {}) }) })],
        })),
      })),
    }),
    new Paragraph({ children: [], spacing: { after: 120 } }),
  ];
}

function cabecalho() {
  return new Header({ children: [new Paragraph({
    alignment: AlignmentType.RIGHT, border: { bottom: filete(FILETE_CLARO, 4, 6) },
    children: [
      new TextRun({ text: 'ABRANTES & MONTENEGRO', font: FONTE, size: 18, bold: true, color: AZUL, characterSpacing: 40 }),
      new TextRun({ text: ' ADVOGADOS', font: FONTE, size: 18, color: CINZA, characterSpacing: 40 }),
    ],
  })] });
}

function rodape() {
  const base = { font: FONTE, size: 16, color: CINZA };
  return new Footer({ children: [new Paragraph({
    style: 'RodapeAM', alignment: AlignmentType.CENTER, border: { top: filete(FILETE_CLARO, 4, 6) },
    children: [
      new TextRun({ text: RODAPE[0], ...base }),
      new TextRun({ text: RODAPE[1], ...base, break: 1 }),
      new TextRun({ text: 'Página ', ...base, break: 1 }),
      new TextRun({ children: [PageNumber.CURRENT], ...base }),
      new TextRun({ text: ' de ', ...base }),
      new TextRun({ children: [PageNumber.TOTAL_PAGES], ...base }),
    ],
  })] });
}

export function validarBlocos(blocos) {
  if (!Array.isArray(blocos) || !blocos.length) throw erroValidacao('Informe os blocos da peça.');
  if (blocos.length > 800) throw erroValidacao('Peça longa demais (máximo 800 blocos).');
  for (const b of blocos) {
    if (!b || !TIPOS_BLOCO.includes(b.tipo)) throw erroValidacao(`Tipo de bloco inválido: ${b?.tipo}`);
    if (b.tipo === 'tabela') { if (!Array.isArray(b.linhas) || !b.linhas.length) throw erroValidacao('Tabela sem linhas.'); }
    else if (b.tipo !== 'assinaturas' && !String(b.texto ?? '').trim()) throw erroValidacao(`Bloco "${b.tipo}" sem texto.`);
  }
}

export async function montarDocx(blocos, { orientacao = 'retrato' } = {}) {
  validarBlocos(blocos);
  const paisagem = orientacao === 'paisagem';
  const margem = paisagem
    ? { top: 1.5 * CM, bottom: 1.5 * CM, left: 1.5 * CM, right: 1.5 * CM }
    : { top: 3 * CM, left: 3 * CM, bottom: 2 * CM, right: 2 * CM };
  tabela.larguraUtil = (paisagem ? 16838 : 11906) - margem.left - margem.right;
  const doc = new Document({
    styles: {
      default: { document: { run: { font: FONTE, size: 24, language: { value: 'pt-BR' } } } },
      // Estilo do rodapé: o número da página ("Página X de Y") herda daqui o tamanho e a cor.
      paragraphStyles: [{ id: 'RodapeAM', name: 'Rodapé AM', run: { font: FONTE, size: 16, color: CINZA } }],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838, orientation: paisagem ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
          margin: { ...margem, header: 680, footer: 567 },
        },
      },
      headers: { default: cabecalho() },
      footers: { default: rodape() },
      children: paragrafos(blocos),
    }],
  });
  return Packer.toBuffer(doc);
}

function driveCliente() {
  const oauth2 = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.drive({ version: 'v3', auth: oauth2 });
}

const corpo = buf => Readable.from([buf]);
const aspas = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

async function gravarSubstituindo(drive, pastaId, nomeArquivo, mime, buffer) {
  const anteriores = (await drive.files.list({
    q: `'${pastaId}' in parents and name = '${aspas(nomeArquivo)}' and trashed = false`, fields: 'files(id)', pageSize: 20,
  })).data.files || [];
  const { data: novo } = await drive.files.create({
    requestBody: { name: nomeArquivo, parents: [pastaId] },
    media: { mimeType: mime, body: corpo(buffer) },
    fields: 'id, name, webViewLink, size',
  });
  for (const a of anteriores) await drive.files.update({ fileId: a.id, requestBody: { trashed: true } }).catch(() => {});
  return { id: novo.id, nome: novo.name, url: novo.webViewLink, bytes: Number(novo.size) || null, substituiu: anteriores.length };
}

// Texto do primeiro bloco com texto, sem marcação de negrito — usado para conferir o PDF.
export function primeiroTexto(blocos) {
  const b = blocos.find(x => String(x.texto ?? '').trim());
  return b ? String(b.texto).replace(/\*\*/g, '').trim() : '';
}

// Uma conversão por vez: o LibreOffice não gosta de instâncias simultâneas, e em lote a fila
// garante que nenhuma conversão atropele a outra.
let fila = Promise.resolve();

// Word → PDF pelo LibreOffice do servidor (perfil descartável por conversão).
export function converterParaPdf(docx, { binario = process.env.SOFFICE_BIN || 'soffice', limiteMs = 90000 } = {}) {
  const tarefa = fila.then(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'am-peca-'));
    try {
      const entrada = join(dir, 'peca.docx');
      await writeFile(entrada, docx);
      await new Promise((resolve, reject) => {
        execFile(binario, [
          `-env:UserInstallation=${pathToFileURL(join(dir, 'perfil')).href}`,
          '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir, entrada,
        ], { timeout: limiteMs, env: { ...process.env, HOME: dir, SAL_USE_VCLPLUGIN: 'svp' } }, (err, _out, stderr) => {
          if (err) reject(new Error(`Conversão para PDF falhou: ${err.message}${stderr ? ` — ${String(stderr).slice(0, 300)}` : ''}`));
          else resolve();
        });
      });
      return await readFile(join(dir, 'peca.pdf'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  fila = tarefa.catch(() => {});
  return tarefa;
}

const semAcento = t => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').toUpperCase();

// Confere o PDF antes de gravar: A4 na orientação pedida, ao menos uma página e o texto de
// abertura presente na primeira página. Falha → erro 500, nada gravado.
export async function conferirPdf(pdf, { orientacao = 'retrato', textoInicial = '' } = {}) {
  const { getDocumentProxy, extractText } = await import('unpdf');
  let doc;
  try { doc = await getDocumentProxy(new Uint8Array(pdf)); } catch { throw new Error('PDF gerado inválido.'); }
  if (!doc.numPages) throw new Error('PDF gerado sem páginas.');
  const pagina = await doc.getPage(1);
  const [, , largura, altura] = pagina.view;
  const [w, h] = orientacao === 'paisagem' ? [841.89, 595.28] : [595.28, 841.89];
  if (Math.abs(largura - w) > 2 || Math.abs(altura - h) > 2) throw new Error(`PDF fora do tamanho A4 (${Math.round(largura)}x${Math.round(altura)} pt).`);
  if (textoInicial) {
    const { text } = await extractText(doc, { mergePages: false });
    const trecho = semAcento(textoInicial).slice(0, 40);
    if (!semAcento(text[0] || '').includes(trecho)) throw new Error('PDF gerado sem o texto de abertura esperado.');
  }
  return { paginas: doc.numPages };
}

export async function salvarPecaPadrao({ pastaId, nome, blocos, formatos = ['pdf'], orientacao = 'retrato' }, deps = {}) {
  const drive = deps.drive || driveCliente();
  const env = deps.env || process.env;
  const base = nomeSeguro(nome);
  const pedidos = [...new Set(formatos)];
  if (!pedidos.length || pedidos.some(f => !['pdf', 'docx'].includes(f))) throw erroValidacao('Formatos aceitos: pdf, docx.');
  const docx = await montarDocx(blocos, { orientacao });
  const pasta = await conferirPastaDestino(drive, pastaId, env);

  // Gera e confere tudo antes de gravar qualquer arquivo: falhou, nada vai para o Drive.
  let pdf = null; let paginas = null;
  if (pedidos.includes('pdf')) {
    pdf = await (deps.converter || converterParaPdf)(docx);
    ({ paginas } = await (deps.conferir || conferirPdf)(pdf, { orientacao, textoInicial: primeiroTexto(blocos) }));
  }

  const arquivos = [];
  if (pdf) arquivos.push({ formato: 'pdf', paginas, ...(await gravarSubstituindo(drive, pasta.id, `${base}.pdf`, 'application/pdf', pdf)) });
  if (pedidos.includes('docx')) arquivos.push({ formato: 'docx', ...(await gravarSubstituindo(drive, pasta.id, `${base}.docx`, MIME_DOCX, docx)) });
  return { pasta, arquivos };
}
