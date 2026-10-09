import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { montarDocx, salvarPecaPadrao, validarBlocos } from './pecas.js';

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

test('salvarPecaPadrao: Word → Google Doc temporário → PDF, substitui o anterior e apaga o temporário', async () => {
  const drive = driveFalso({ existentes: [{ id: 'velho' }] });
  const r = await salvarPecaPadrao({ pastaId: PASTA, nome: 'INICIAL - FULANO', blocos: BLOCOS }, { drive, env: ENV });
  assert.deepEqual(r.arquivos.map(a => [a.formato, a.nome, a.substituiu]), [['pdf', 'INICIAL - FULANO.pdf', 1]]);
  assert.deepEqual(drive.chamadas.map(c => c[0]), ['create', 'export', 'create', 'lixeira', 'delete']);
  assert.equal(drive.chamadas[0][2], 'application/vnd.google-apps.document');
});

test('salvarPecaPadrao: docx grava o Word direto; destino fora das pastas da equipe é recusado', async () => {
  const drive = driveFalso();
  const r = await salvarPecaPadrao({ pastaId: PASTA, nome: 'X', blocos: BLOCOS, formatos: ['docx'] }, { drive, env: ENV });
  assert.equal(r.arquivos[0].nome, 'X.docx');
  assert.ok(!drive.chamadas.some(c => c[0] === 'export'));
  await assert.rejects(salvarPecaPadrao({ pastaId: PASTA, nome: 'X', blocos: BLOCOS }, { drive: driveFalso(), env: { GOOGLE_DRIVE_PASTA_PENDENTES: 'OUTRA_PASTA_123' } }), e => e.status === 403);
  await assert.rejects(salvarPecaPadrao({ pastaId: PASTA, nome: 'X', blocos: BLOCOS, formatos: ['exe'] }, { drive: driveFalso(), env: ENV }), e => e.status === 422);
});
