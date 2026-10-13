// Conferência da pasta do cliente antes do protocolo no PJe e ficha de protocolo de cada processo.
//
// Lê a pasta (só leitura): cada PDF "INICIAL - ..." é um processo. Da inicial saem autor, ação, réu,
// valor da causa e pedido de gratuidade; dos nomes dos arquivos saem os anexos (planilha da mesma tese,
// procuração, documento pessoal, comprovante de vínculo). A competência vem do valor da causa:
// até 60 salários mínimos, Juizado Especial da Fazenda Pública (Lei 12.153/2009, art. 2º); acima,
// Vara da Fazenda Pública. O salário mínimo vem de SALARIO_MINIMO; sem ele a competência fica
// "a confirmar". Falta de documento obrigatório bloqueia o processo — nada vai ao PJe incompleto.

import { google } from 'googleapis';
import { conferirPastaDestino } from './documentos.js';

const PDF = 'application/pdf';
export const FORO_PADRAO = 'João Pessoa';

function driveCliente() {
  const oauth2 = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.drive({ version: 'v3', auth: oauth2 });
}

const sem = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const ehPdf = a => a.mimeType === PDF || /\.pdf$/i.test(a.name);

export function classificar(nome) {
  const n = sem(nome);
  if (/^INICIAL\b/.test(n)) return 'inicial';
  if (/^PLANILHA\b|MEMORIA DE CALCULO/.test(n)) return 'planilha';
  if (/PROCURACAO/.test(n)) return 'procuracao';
  if (/\b(CNH|RG|CPF|IDENTIDADE)\b/.test(n)) return 'identificacao';
  if (/VINCULO|CONTRACHEQUE|FICHA FINANCEIRA/.test(n)) return 'vinculo';
  return 'outro';
}

// "INICIAL - FULANO - PISO MAGISTERIO X PB.pdf" → "PISO MAGISTERIO" (para casar a planilha da mesma tese).
export function teseDoNome(nome) {
  const partes = sem(nome).replace(/\.PDF$/, '').split(/\s+-\s+/);
  return (partes[partes.length - 1] || '').replace(/\s+X\s+\S+$/, '').trim();
}

export const paraNumero = v => Number(String(v).replace(/\./g, '').replace(',', '.'));
const brl = v => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Dados da inicial a partir do texto do PDF.
export function lerInicial(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ');
  const valor = t.match(/D[áa]-se à causa o valor de R\$\s*([\d.]+,\d{2})/i);
  const acao = t.match(/vem propor\s+(.+?)\s+em face d[oa]s?\s/i);
  const reu = t.match(/em face d[oa]s?\s+(.+?),\s/i);
  const autor = t.match(/P[ÚU]BLICA\s+([A-ZÀ-Ý][A-ZÀ-Ý' ]{5,}?),\s+brasileir/);
  return {
    autor: autor ? autor[1].trim() : null,
    acao: acao ? acao[1].trim() : null,
    reu: reu ? reu[1].trim() : null,
    valor_causa: valor ? paraNumero(valor[1]) : null,
    gratuidade: /gratuidade|justi[çc]a gratuita/i.test(t),
  };
}

export function competencia(valor, salarioMinimo) {
  if (!(valor > 0)) return { juizo: 'a confirmar', motivo: 'valor da causa não encontrado na inicial' };
  if (!(salarioMinimo > 0)) return { juizo: 'a confirmar', motivo: 'salário mínimo não configurado no AM (SALARIO_MINIMO)' };
  const limite = 60 * salarioMinimo;
  return valor <= limite
    ? { juizo: 'Juizado Especial da Fazenda Pública', motivo: `${brl(valor)} até 60 salários mínimos (${brl(limite)})` }
    : { juizo: 'Vara da Fazenda Pública', motivo: `${brl(valor)} acima de 60 salários mínimos (${brl(limite)})` };
}

async function textoDoPdf(drive, id) {
  const { data } = await drive.files.get({ fileId: id, alt: 'media' }, { responseType: 'arraybuffer' });
  const { getDocumentProxy, extractText } = await import('unpdf');
  const doc = await getDocumentProxy(new Uint8Array(data));
  const { text } = await extractText(doc, { mergePages: true });
  return text;
}

export async function prepararProtocolo({ pastaId, foro = FORO_PADRAO }, deps = {}) {
  const drive = deps.drive || driveCliente();
  const env = deps.env || process.env;
  const ler = deps.lerTexto || (id => textoDoPdf(drive, id));
  const pasta = await conferirPastaDestino(drive, pastaId, env);
  const arquivos = [];
  let pageToken;
  do {
    const { data } = await drive.files.list({
      q: `'${pasta.id}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
      fields: 'nextPageToken, files(id, name, mimeType)', pageSize: 200, pageToken,
    });
    arquivos.push(...(data.files || []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  const pdfs = arquivos.filter(ehPdf).map(a => ({ id: a.id, nome: a.name, tipo: classificar(a.name) }));
  const naoPdf = arquivos.filter(a => !ehPdf(a)).map(a => a.name);
  const doTipo = t => pdfs.filter(a => a.tipo === t);
  const comuns = [...doTipo('procuracao'), ...doTipo('identificacao'), ...doTipo('vinculo'), ...doTipo('outro')];
  const salarioMinimo = Number(env.SALARIO_MINIMO) || null;

  const processos = [];
  for (const inicial of doTipo('inicial')) {
    const tese = teseDoNome(inicial.nome);
    const planilhas = doTipo('planilha').filter(p => teseDoNome(p.nome) === tese);
    const dados = lerInicial(await ler(inicial.id));
    const comp = competencia(dados.valor_causa, salarioMinimo);
    const pendencias = [];
    if (!doTipo('procuracao').length) pendencias.push('falta a procuração');
    if (!doTipo('identificacao').length) pendencias.push('falta documento pessoal (CNH/RG/CPF)');
    if (!doTipo('vinculo').length) pendencias.push('falta comprovante de vínculo/contracheque');
    if (dados.valor_causa == null) pendencias.push('valor da causa não encontrado na inicial');
    if (comp.juizo === 'a confirmar') pendencias.push(`competência a confirmar: ${comp.motivo}`);
    processos.push({
      inicial: inicial.nome,
      tese,
      foro,
      juizo: comp.juizo,
      motivo_juizo: comp.motivo,
      classe: comp.juizo.startsWith('Juizado') ? 'Procedimento do Juizado Especial da Fazenda Pública'
        : comp.juizo.startsWith('Vara') ? 'Procedimento Comum Cível' : 'a confirmar',
      ...dados,
      anexos: [inicial, ...planilhas, ...comuns].map((a, i) => ({ ordem: i + 1, arquivo: a.nome, tipo: a.tipo })),
      pendencias,
      status: pendencias.length ? 'bloqueado' : 'pronto',
    });
  }

  const avisos = [];
  if (!processos.length) avisos.push('Nenhuma inicial (arquivo "INICIAL - ...pdf") na pasta.');
  if (naoPdf.length) avisos.push(`Arquivos que não são PDF e não vão ao PJe: ${naoPdf.join('; ')}`);
  const planilhasSoltas = doTipo('planilha').filter(p => !processos.some(pr => pr.tese === teseDoNome(p.nome)));
  if (planilhasSoltas.length) avisos.push(`Planilha sem inicial da mesma tese: ${planilhasSoltas.map(p => p.nome).join('; ')}`);
  return { pasta: { id: pasta.id, nome: pasta.nome }, processos, avisos };
}
