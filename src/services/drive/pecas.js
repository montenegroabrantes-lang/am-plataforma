// Peças no padrão de formatação do escritório (ABNT), montadas em Word no próprio AM e gravadas
// na pasta do cliente em PDF (exigência do PJe) e/ou .docx.
//
// O conteúdo chega em blocos tipados (endereçamento, parágrafo, título, citação, pedido, tabela,
// fecho...) e o estilo é fixo aqui: Arial 12, espaço 1,5, recuo de 2 cm, citação recuada 4 cm em
// 11 pt com espaço simples, títulos com 24/12 pt, margens 3/3/2/2 cm em A4.
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
  AlignmentType, BorderStyle, Document, LineRuleType, Packer, PageOrientation, Paragraph,
  Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';
import { conferirPastaDestino, nomeSeguro } from './documentos.js';

export const TIPOS_BLOCO = ['enderecamento', 'paragrafo', 'acao', 'titulo', 'subtitulo', 'citacao', 'pedido', 'tabela', 'fecho', 'assinaturas'];
const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const CM = 567; // twips por centímetro
const PT = 20;  // twips por ponto
const FONTE = 'Arial';
const ADVOGADOS = [['RAMON OLIVEIRA ABRANTES', 'OAB/PB 23.395'], ['LUCIANO MONTENEGRO L. R. CARVALHO', 'OAB/PB 23.176']];

function erroValidacao(mensagem, status = 422) { const e = new Error(mensagem); e.status = status; return e; }

// "texto com **negrito**" → runs.
export function trechos(texto, { tamanho = 24, negrito = false } = {}) {
  return String(texto ?? '').split('**').map((t, i) => new TextRun({ text: t, bold: negrito || i % 2 === 1, font: FONTE, size: tamanho }));
}

const linha15 = { line: 360, lineRule: LineRuleType.AUTO };
const linha10 = { line: 240, lineRule: LineRuleType.AUTO };

function paragrafo(bloco) {
  const t = bloco.texto;
  switch (bloco.tipo) {
    case 'enderecamento':
      return [new Paragraph({ children: trechos(t, { negrito: true }), alignment: AlignmentType.JUSTIFIED, spacing: { ...linha15, after: 24 * PT } })];
    case 'acao':
      return [new Paragraph({ children: trechos(t, { negrito: true }), alignment: AlignmentType.CENTER, spacing: { ...linha15, before: 6 * PT, after: 6 * PT } })];
    case 'titulo':
      return [new Paragraph({ children: trechos(t, { negrito: true }), alignment: AlignmentType.CENTER, keepNext: true, spacing: { ...linha15, before: 24 * PT, after: 12 * PT } })];
    case 'subtitulo':
      return [new Paragraph({ children: trechos(t, { negrito: true }), alignment: AlignmentType.JUSTIFIED, keepNext: true, spacing: { ...linha15, before: 12 * PT, after: 6 * PT } })];
    case 'citacao':
      return [new Paragraph({ children: trechos(t, { tamanho: 22 }), alignment: AlignmentType.JUSTIFIED, indent: { left: 4 * CM }, spacing: { ...linha10, before: 6 * PT, after: 6 * PT } })];
    case 'paragrafo':
    case 'pedido':
      return [new Paragraph({ children: trechos(t), alignment: AlignmentType.JUSTIFIED, indent: { firstLine: 2 * CM }, spacing: { ...linha15, after: 6 * PT } })];
    case 'fecho':
      return [new Paragraph({ children: trechos(t), alignment: AlignmentType.CENTER, spacing: { ...linha15, before: 12 * PT, after: 6 * PT } })];
    case 'assinaturas':
      return ADVOGADOS.flatMap(([nome, oab]) => [
        new Paragraph({ children: trechos(nome, { negrito: true }), alignment: AlignmentType.CENTER, spacing: { before: 24 * PT, after: 0 } }),
        new Paragraph({ children: trechos(oab), alignment: AlignmentType.CENTER, spacing: { after: 0 } }),
      ]);
    default:
      throw erroValidacao(`Tipo de bloco inválido: ${bloco.tipo}`);
  }
}

function tabela(bloco) {
  const linhas = bloco.linhas || [];
  if (!linhas.length || !Array.isArray(linhas[0])) throw erroValidacao('Tabela sem linhas.');
  const borda = { style: BorderStyle.SINGLE, size: 4, color: '808080' };
  const bordas = { top: borda, bottom: borda, left: borda, right: borda };
  return [
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: linhas.map((cels, i) => new TableRow({
        tableHeader: i === 0,
        children: cels.map(c => new TableCell({
          borders: bordas,
          shading: i === 0 ? { fill: 'D9E1F2' } : undefined,
          children: [new Paragraph({ children: trechos(c, { tamanho: 20, negrito: i === 0 }), alignment: AlignmentType.CENTER, spacing: linha10 })],
        })),
      })),
    }),
    new Paragraph({ children: [], spacing: { after: 6 * PT } }),
  ];
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
  const filhos = blocos.flatMap(b => (b.tipo === 'tabela' ? tabela(b) : paragrafo(b)));
  const doc = new Document({
    styles: { default: { document: { run: { font: FONTE, size: 24 } } } },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838, orientation: paisagem ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
          margin: paisagem
            ? { top: 1.5 * CM, bottom: 1.5 * CM, left: 1.5 * CM, right: 1.5 * CM }
            : { top: 3 * CM, left: 3 * CM, bottom: 2 * CM, right: 2 * CM },
        },
      },
      children: filhos,
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
