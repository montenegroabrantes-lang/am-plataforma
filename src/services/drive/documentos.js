// Gravação de peças e planilhas na pasta do cliente no Drive, a partir de HTML (usado pelo
// conector do Claude: o conector do Google Drive só grava texto, e o PJe exige PDF).
//
// Fluxo: o HTML vira um Google Doc temporário na pasta de destino (conversão nativa do Drive),
// que é exportado para PDF e/ou Word; o arquivo de mesmo nome que já existir na pasta vai para a
// lixeira (a versão nova substitui a anterior) e o Doc temporário é apagado, salvo se pedido.
//
// Destino permitido: só as pastas da equipe (Pendentes a protocolar, Outorgantes) e a pasta-raiz
// de clientes do AM, ou uma subpasta direta delas — nunca qualquer pasta do Drive.

import { Readable } from 'node:stream';
import { google } from 'googleapis';
import { pastasConfiguradas } from './pastasEquipe.js';
import { montarDocxPeca } from './layoutPeca.js';

const MIME_DOC = 'application/vnd.google-apps.document';
const MIME_PASTA = 'application/vnd.google-apps.folder';
const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const EXPORTACOES = {
  pdf: { mime: 'application/pdf', ext: 'pdf' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' },
};
export const FORMATOS = ['pdf', 'docx', 'gdoc'];
const CM = 28.3465; // pontos por centímetro
const A4 = { largura: 595.28, altura: 841.89 };

function erroValidacao(mensagem, status = 422) {
  const e = new Error(mensagem); e.status = status; return e;
}

// Nome de arquivo sem barras nem caracteres de controle e sem extensão (a extensão vem do formato).
export function nomeSeguro(nome) {
  const limpo = String(nome || '')
    .replace(/[\u0000-\u001f\u007f/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.(pdf|docx?)$/i, '')
    .trim();
  if (!limpo) throw erroValidacao('Informe o nome do arquivo.');
  if (limpo.length > 200) throw erroValidacao('Nome do arquivo muito longo (máximo 200 caracteres).');
  return limpo;
}

export function pastasRaizPermitidas(env = process.env) {
  const { pendentesTodas, outorgantes } = pastasConfiguradas(env);
  return [...new Set([...pendentesTodas, ...outorgantes, env.GOOGLE_DRIVE_PASTA_RAIZ].filter(Boolean))];
}

// Margens ABNT (3/3/2/2 cm) e A4; paisagem para planilhas largas.
export function estiloDaPagina(orientacao = 'retrato') {
  const paisagem = orientacao === 'paisagem';
  const pt = v => ({ magnitude: Math.round(v * 100) / 100, unit: 'PT' });
  return {
    pageSize: { width: pt(paisagem ? A4.altura : A4.largura), height: pt(paisagem ? A4.largura : A4.altura) },
    marginTop: pt((paisagem ? 1.5 : 3) * CM),
    marginBottom: pt((paisagem ? 1.5 : 2) * CM),
    marginLeft: pt((paisagem ? 1.5 : 3) * CM),
    marginRight: pt((paisagem ? 1.5 : 2) * CM),
  };
}

function clientesGoogle() {
  const oauth2 = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return { drive: google.drive({ version: 'v3', auth: oauth2 }), docs: google.docs({ version: 'v1', auth: oauth2 }) };
}

const corpo = (dados) => Readable.from([Buffer.isBuffer(dados) ? dados : Buffer.from(String(dados), 'utf8')]);
const aspas = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export async function conferirPastaDestino(drive, pastaId, env = process.env) {
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(String(pastaId || ''))) throw erroValidacao('Pasta de destino inválida.', 400);
  const raizes = pastasRaizPermitidas(env);
  if (!raizes.length) throw erroValidacao('Pastas do Drive não configuradas no AM.', 503);
  let pasta;
  try {
    ({ data: pasta } = await drive.files.get({ fileId: pastaId, fields: 'id, name, mimeType, parents, trashed, webViewLink' }));
  } catch {
    throw erroValidacao('Pasta de destino não encontrada no Drive.', 404);
  }
  if (pasta.mimeType !== MIME_PASTA || pasta.trashed) throw erroValidacao('O destino informado não é uma pasta ativa do Drive.', 422);
  const permitida = raizes.includes(pasta.id) || (pasta.parents || []).some(p => raizes.includes(p));
  if (!permitida) throw erroValidacao('Só é permitido gravar nas pastas de clientes da equipe (Pendentes a protocolar, Outorgantes ou pasta de clientes do AM).', 403);
  return { id: pasta.id, nome: pasta.name, url: pasta.webViewLink };
}

export async function salvarDocumentoHtml({ pastaId, nome, html, formatos = ['pdf'], orientacao = 'retrato' }, deps = {}) {
  const { drive, docs } = deps.drive ? deps : clientesGoogle();
  const env = deps.env || process.env;
  const base = nomeSeguro(nome);
  const pedidos = [...new Set(formatos)];
  if (!pedidos.length || pedidos.some(f => !FORMATOS.includes(f))) throw erroValidacao(`Formatos aceitos: ${FORMATOS.join(', ')}.`);
  if (!String(html || '').trim()) throw erroValidacao('Conteúdo vazio.');
  const pasta = await conferirPastaDestino(drive, pastaId, env);

  // 1) HTML → Google Doc (conversão do próprio Drive).
  const { data: doc } = await drive.files.create({
    requestBody: { name: base, mimeType: MIME_DOC, parents: [pasta.id] },
    media: { mimeType: 'text/html', body: corpo(html) },
    fields: 'id, webViewLink',
  });

  const avisos = [];
  const arquivos = await exportarEGravar({ drive, pasta, docId: doc.id, docUrl: doc.webViewLink, base, pedidos, antes: async () => {
    // 2) Página A4, margens ABNT/orientação. Falha aqui não impede a gravação.
    try {
      await docs.documents.batchUpdate({
        documentId: doc.id,
        requestBody: { requests: [{ updateDocumentStyle: { documentStyle: estiloDaPagina(orientacao), fields: 'pageSize,marginTop,marginBottom,marginLeft,marginRight' } }] },
      });
    } catch (e) {
      avisos.push(`Margens/orientação não aplicadas (${e.message}); usado o padrão do Google Docs.`);
    }
  } });
  return { pasta, arquivos, avisos };
}

// 3) Exporta e grava cada formato, substituindo o arquivo de mesmo nome; apaga o Doc temporário
// salvo se "gdoc" foi pedido. `docxPronto` (peça no padrão) é gravado como está, sem reexportar.
async function exportarEGravar({ drive, pasta, docId, docUrl, base, pedidos, antes, docxPronto }) {
  const arquivos = [];
  try {
    if (antes) await antes();
    for (const formato of pedidos.filter(f => f !== 'gdoc')) {
      const { mime, ext } = EXPORTACOES[formato];
      const nomeArquivo = `${base}.${ext}`;
      let conteudo;
      if (formato === 'docx' && docxPronto) conteudo = docxPronto;
      else ({ data: conteudo } = await drive.files.export({ fileId: docId, mimeType: mime }, { responseType: 'arraybuffer' }));
      const anteriores = (await drive.files.list({
        q: `'${pasta.id}' in parents and name = '${aspas(nomeArquivo)}' and trashed = false`,
        fields: 'files(id)', pageSize: 20,
      })).data.files || [];
      const { data: novo } = await drive.files.create({
        requestBody: { name: nomeArquivo, parents: [pasta.id] },
        media: { mimeType: mime, body: corpo(Buffer.from(conteudo)) },
        fields: 'id, name, webViewLink, size',
      });
      for (const a of anteriores) await drive.files.update({ fileId: a.id, requestBody: { trashed: true } }).catch(() => {});
      arquivos.push({ formato, id: novo.id, nome: novo.name, url: novo.webViewLink, bytes: Number(novo.size) || null, substituiu: anteriores.length });
    }
  } finally {
    if (!pedidos.includes('gdoc')) await drive.files.delete({ fileId: docId }).catch(() => {});
  }
  if (pedidos.includes('gdoc')) arquivos.push({ formato: 'gdoc', id: docId, nome: base, url: docUrl });
  return arquivos;
}

// Peça no padrão de layout do escritório (layoutPeca.js): blocos → .docx (A4, ABNT, cabeçalho,
// rodapé, "Página X de Y") → Google Doc por conversão do próprio Drive → PDF. Não usa a Docs API.
export async function salvarPecaNoPadrao({ pastaId, nome, blocos, formatos = ['pdf'] }, deps = {}) {
  const { drive } = deps.drive ? deps : clientesGoogle();
  const env = deps.env || process.env;
  const base = nomeSeguro(nome);
  const pedidos = [...new Set(formatos)];
  if (!pedidos.length || pedidos.some(f => !FORMATOS.includes(f))) throw erroValidacao(`Formatos aceitos: ${FORMATOS.join(', ')}.`);
  const docx = await (deps.montar || montarDocxPeca)(blocos);
  const pasta = await conferirPastaDestino(drive, pastaId, env);
  const { data: doc } = await drive.files.create({
    requestBody: { name: base, mimeType: MIME_DOC, parents: [pasta.id] },
    media: { mimeType: MIME_DOCX, body: corpo(docx) },
    fields: 'id, webViewLink',
  });
  const arquivos = await exportarEGravar({ drive, pasta, docId: doc.id, docUrl: doc.webViewLink, base, pedidos, docxPronto: docx });
  return { pasta, arquivos, avisos: [] };
}
