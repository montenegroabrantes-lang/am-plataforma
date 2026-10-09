import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { execFileSync } from 'node:child_process';
import { montarDocx, salvarPecaPadrao, validarBlocos, converterParaPdf, conferirPdf, primeiroTexto } from './pecas.js';

const ENV = { GOOGLE_DRIVE_PASTA_PENDENTES: 'PENDENTES_AM_0001', GOOGLE_DRIVE_PASTA_OUTORGANTES: 'OUTORGANTES_26' };
const PASTA = 'PASTA_FRANKLIN_01';
const BLOCOS = [
  { tipo: 'enderecamento', texto: 'AO JUÍZO COMPETENTE PARA OS FEITOS DA FAZENDA PÚBLICA' },
  { tipo: 'paragrafo', texto: '**FULANO**, brasileiro, vem propor' },
  { tipo: 'titulo', texto: 'I — DOS FATOS' },
  { tipo: 'citacao', texto: '“Tese.” (STF)' },
  { tipo: 'tabela', linhas: [['ANO', 'PISO'], ['2024', 'R$ 4.580,57']] },
  { tipo: 'pedido', texto: 'a) a citação do réu;' },
  { tipo: 'fecho', texto: 'João Pessoa (PB), data do protocolo eletrônico.' },
  { tipo: 'assinaturas' },
];

async function xmlDo(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  return zip.file('word/document.xml').async('string');
}

test('montarDocx: A4 com margens ABNT, Arial 12, espaço 1,5, recuo 2 cm, citação 4 cm/11 pt e assinaturas', async () => {
  const xml = await xmlDo(await montarDocx(BLOCOS));
  assert.match(xml, /w:pgSz w:w="11906" w:h="16838"/);
  assert.match(xml, /w:top="1701"[^>]*w:right="1134"[^>]*w:bottom="1134"[^>]*w:left="1701"/);
  assert.match(xml, /w:firstLine="1134"/);
  assert.match(xml, /w:left="2268"/);
  assert.match(xml, /w:line="360"/);
  assert.match(xml, /w:sz w:val="22"/);
  assert.match(xml, /RAMON OLIVEIRA ABRANTES/);
  assert.match(xml, /OAB\/PB 23\.176/);
  assert.match(xml, /<w:b\/>[\s\S]*FULANO/);
});

test('montarDocx: padrão novo do escritório — cabeçalho, rodapé, seções numeradas, citação com fonte em cinza, fecho à esquerda', async () => {
  const buf = await montarDocx([
    { tipo: 'enderecamento', texto: '**AO JUÍZO COMPETENTE PARA OS FEITOS DA FAZENDA PÚBLICA**' },
    { tipo: 'paragrafo', texto: '**FULANO**, brasileiro, vem propor' },
    { tipo: 'acao', texto: 'Ação de cobrança' },
    { tipo: 'paragrafo', texto: 'em face do **ESTADO**, pelas razões a seguir.' },
    { tipo: 'titulo', texto: 'I — DOS FATOS' },
    { tipo: 'titulo', texto: 'IV — DO DIREITO' },
    { tipo: 'subtitulo', texto: 'A) Do piso' },
    { tipo: 'citacao', texto: '“Tese.” (STF, RE 1, Tema 1)' },
    { tipo: 'paragrafo', texto: 'Dá-se à causa o valor de R$ 1,00.' },
    { tipo: 'paragrafo', texto: 'Pede deferimento.' },
    { tipo: 'fecho', texto: 'João Pessoa (PB), data do protocolo eletrônico.' },
    { tipo: 'assinaturas' },
  ]);
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml').async('string');
  const cab = await zip.file('word/header1.xml').async('string');
  const rod = await zip.file('word/footer1.xml').async('string');
  assert.match(cab, /ABRANTES &amp; MONTENEGRO/);
  assert.match(rod, /Av\. Cabo Branco, 1780/);
  assert.match(rod, /atendimento@abrantesemontenegro\.com\.br/);
  assert.match(rod, /PAGE/); assert.match(rod, /NUMPAGES/);
  assert.match(xml, /w:after="2400"/);                                   // espaço grande após o endereçamento
  assert.doesNotMatch(xml.split('AO JUÍZO')[0].slice(-400), /<w:b\/>/);  // endereçamento sem negrito
  assert.match(xml, /1F2A44/);                                           // azul-marinho
  assert.match(xml, />1  DOS FATOS</);
  assert.match(xml, />4  DO DIREITO</);
  assert.match(xml, />4\.1  Do piso</);
  assert.match(xml, /6B7280[\s\S]*\(STF, RE 1, Tema 1\)/);               // fonte da citação em cinza
  assert.match(xml, /<w:ind w:left="2268"\/>[\s\S]*Pede deferimento/);  // fecho à esquerda, recuo 4 cm
  const emFace = xml.slice(xml.indexOf('em face do') - 600, xml.indexOf('em face do'));
  assert.doesNotMatch(emFace.slice(emFace.lastIndexOf('<w:p>')), /firstLine/); // "em face" sem recuo
});

test('montarDocx: paisagem inverte a página', async () => {
  const xml = await xmlDo(await montarDocx(BLOCOS, { orientacao: 'paisagem' }));
  assert.match(xml, /w:orient="landscape"/);
});

test('validarBlocos: recusa lista vazia, tipo desconhecido, texto vazio e tabela sem linhas', () => {
  assert.throws(() => validarBlocos([]), /blocos/);
  assert.throws(() => validarBlocos([{ tipo: 'x', texto: 'a' }]), /inválido/);
  assert.throws(() => validarBlocos([{ tipo: 'paragrafo', texto: ' ' }]), /sem texto/);
  assert.throws(() => validarBlocos([{ tipo: 'tabela', linhas: [] }]), /Tabela/);
  validarBlocos([{ tipo: 'assinaturas' }]);
});

function driveFalso({ existentes = [] } = {}) {
  const chamadas = [];
  return {
    chamadas,
    files: {
      async get({ fileId }) {
        if (fileId !== PASTA) throw new Error('404');
        return { data: { id: PASTA, name: 'FULANO x PB', mimeType: 'application/vnd.google-apps.folder', parents: ['PENDENTES_AM_0001'], trashed: false } };
      },
      async create({ requestBody, media }) {
        chamadas.push(['create', requestBody.name, requestBody.mimeType || media.mimeType]);
        return { data: { id: `id-${requestBody.name}`, name: requestBody.name, webViewLink: 'u', size: '9' } };
      },
      async export({ mimeType }) { chamadas.push(['export', mimeType]); return { data: new ArrayBuffer(3) }; },
      async list() { return { data: { files: existentes } }; },
      async update({ fileId }) { chamadas.push(['lixeira', fileId]); return { data: {} }; },
      async delete({ fileId }) { chamadas.push(['delete', fileId]); },
    },
  };
}

const PDF_FALSO = Buffer.from('%PDF');
const deps = (drive, extra = {}) => ({ drive, env: ENV, converter: async () => PDF_FALSO, conferir: async () => ({ paginas: 2 }), ...extra });

test('salvarPecaPadrao: converte e confere antes de gravar; substitui o PDF anterior', async () => {
  const drive = driveFalso({ existentes: [{ id: 'velho' }] });
  const r = await salvarPecaPadrao({ pastaId: PASTA, nome: 'INICIAL - FULANO', blocos: BLOCOS }, deps(drive));
  assert.deepEqual(r.arquivos.map(a => [a.formato, a.nome, a.substituiu, a.paginas]), [['pdf', 'INICIAL - FULANO.pdf', 1, 2]]);
  assert.deepEqual(drive.chamadas.map(c => c[0]), ['create', 'lixeira']);
  assert.equal(drive.chamadas[0][2], 'application/pdf');
});

test('salvarPecaPadrao: conferência reprovada não grava nada no Drive', async () => {
  const drive = driveFalso();
  await assert.rejects(salvarPecaPadrao({ pastaId: PASTA, nome: 'X', blocos: BLOCOS, formatos: ['pdf', 'docx'] },
    deps(drive, { conferir: async () => { throw new Error('PDF fora do tamanho A4'); } })), /A4/);
  assert.equal(drive.chamadas.length, 0);
});

test('salvarPecaPadrao: docx grava o Word direto; destino fora das pastas da equipe é recusado', async () => {
  const drive = driveFalso();
  const r = await salvarPecaPadrao({ pastaId: PASTA, nome: 'X', blocos: BLOCOS, formatos: ['docx'] }, deps(drive));
  assert.equal(r.arquivos[0].nome, 'X.docx');
  await assert.rejects(salvarPecaPadrao({ pastaId: PASTA, nome: 'X', blocos: BLOCOS }, { ...deps(driveFalso()), env: { GOOGLE_DRIVE_PASTA_PENDENTES: 'OUTRA_PASTA_123' } }), e => e.status === 403);
  await assert.rejects(salvarPecaPadrao({ pastaId: PASTA, nome: 'X', blocos: BLOCOS, formatos: ['exe'] }, deps(driveFalso())), e => e.status === 422);
});

test('primeiroTexto: primeiro bloco com texto, sem asteriscos', () => {
  assert.equal(primeiroTexto([{ tipo: 'assinaturas' }, { tipo: 'paragrafo', texto: '**A** b' }]), 'A b');
});

// Conversão real (LibreOffice). Roda onde o soffice existe (servidor e máquina de desenvolvimento).
let temSoffice = true;
try { execFileSync(process.env.SOFFICE_BIN || 'soffice', ['--version'], { stdio: 'ignore', timeout: 30000 }); } catch { temSoffice = false; }

test('converterParaPdf + conferirPdf: A4 com margem esquerda de 3 cm e recuo de 2 cm no PDF real', { skip: !temSoffice && 'soffice ausente' }, async () => {
  const pdf = await converterParaPdf(await montarDocx(BLOCOS));
  const { paginas } = await conferirPdf(pdf, { textoInicial: primeiroTexto(BLOCOS) });
  assert.ok(paginas >= 1);
  const { getDocumentProxy } = await import('unpdf');
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const itens = (await (await doc.getPage(1)).getTextContent()).items.filter(i => i.str.trim());
  const x = t => Math.round(itens.find(i => i.str.includes(t)).transform[4]);
  assert.ok(Math.abs(x('AO JUÍZO') - 85) <= 2, `margem esquerda ${x('AO JUÍZO')}`);
  assert.ok(Math.abs(x('FULANO') - 142) <= 2, `recuo de 1ª linha ${x('FULANO')}`);
  await assert.rejects(conferirPdf(pdf, { orientacao: 'paisagem' }), /A4/);
  await assert.rejects(conferirPdf(pdf, { textoInicial: 'TEXTO QUE NÃO ESTÁ NA PEÇA' }), /abertura/);
});
