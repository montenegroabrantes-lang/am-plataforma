import test from 'node:test';
import assert from 'node:assert/strict';
import { salvarDocumentoHtml, salvarPecaNoPadrao, nomeSeguro, estiloDaPagina, pastasRaizPermitidas } from './documentos.js';

const ENV = { GOOGLE_DRIVE_PASTA_PENDENTES: 'PENDENTES_AM_0001,PENDENTES_002', GOOGLE_DRIVE_PASTA_OUTORGANTES: 'OUTORGANTES_26', GOOGLE_DRIVE_PASTA_RAIZ: 'RAIZ_CLIENTES_1' };
const PASTA = 'PASTA_FRANKLIN_01';

function googleFalso({ pastas = { [PASTA]: { parents: ['PENDENTES_002'] } }, existentes = [], falhaDocs = false } = {}) {
  const chamadas = [];
  const drive = {
    files: {
      async get({ fileId }) {
        const p = pastas[fileId];
        if (!p) throw new Error('404');
        return { data: { id: fileId, name: 'FRANKLIN x PB', mimeType: 'application/vnd.google-apps.folder', trashed: false, webViewLink: 'u', ...p } };
      },
      async create({ requestBody, media }) {
        chamadas.push(['create', requestBody.name, requestBody.mimeType || media.mimeType, requestBody.parents[0]]);
        return { data: { id: `id-${requestBody.name}`, name: requestBody.name, webViewLink: `link-${requestBody.name}`, size: '10' } };
      },
      async export({ mimeType }) { chamadas.push(['export', mimeType]); return { data: new ArrayBuffer(4) }; },
      async list({ q }) { chamadas.push(['list', q]); return { data: { files: existentes } }; },
      async update({ fileId, requestBody }) { chamadas.push(['update', fileId, requestBody.trashed]); return { data: {} }; },
      async delete({ fileId }) { chamadas.push(['delete', fileId]); },
    },
  };
  const docs = {
    documents: {
      async batchUpdate({ requestBody }) {
        if (falhaDocs) throw new Error('API desativada');
        chamadas.push(['estilo', requestBody.requests[0].updateDocumentStyle.documentStyle.pageSize.width.magnitude]);
      },
    },
  };
  return { drive, docs, chamadas };
}

test('nomeSeguro: tira barras e extensão; recusa vazio e nome longo', () => {
  assert.equal(nomeSeguro(' INICIAL / FULANO.pdf '), 'INICIAL FULANO');
  assert.throws(() => nomeSeguro('  '), /nome/);
  assert.throws(() => nomeSeguro('x'.repeat(201)), /longo/);
});

test('estiloDaPagina: A4 retrato com margens ABNT; paisagem inverte a página', () => {
  const r = estiloDaPagina();
  assert.equal(r.pageSize.width.magnitude, 595.28);
  assert.equal(r.marginTop.magnitude, 85.04);
  assert.equal(r.marginRight.magnitude, 56.69);
  assert.equal(estiloDaPagina('paisagem').pageSize.width.magnitude, 841.89);
});

test('pastasRaizPermitidas: todas as pendentes, outorgantes e a raiz de clientes', () => {
  assert.deepEqual(pastasRaizPermitidas(ENV), ['PENDENTES_AM_0001', 'PENDENTES_002', 'OUTORGANTES_26', 'RAIZ_CLIENTES_1']);
});

test('grava PDF na pasta do cliente, aplica margens, substitui o anterior e apaga o Doc temporário', async () => {
  const g = googleFalso({ existentes: [{ id: 'velho' }] });
  const r = await salvarDocumentoHtml({ pastaId: PASTA, nome: 'INICIAL - FULANO', html: '<p>Oi</p>' }, { ...g, env: ENV });
  assert.equal(r.arquivos.length, 1);
  assert.equal(r.arquivos[0].nome, 'INICIAL - FULANO.pdf');
  assert.equal(r.arquivos[0].substituiu, 1);
  const tipos = g.chamadas.map(c => c[0]);
  assert.deepEqual(tipos, ['create', 'estilo', 'export', 'list', 'create', 'update', 'delete']);
  assert.deepEqual(g.chamadas[0], ['create', 'INICIAL - FULANO', 'application/vnd.google-apps.document', PASTA]);
  assert.deepEqual(g.chamadas.find(c => c[0] === 'update'), ['update', 'velho', true]);
  assert.deepEqual(r.avisos, []);
});

test('PDF + Word + gdoc: mantém o Doc e grava os dois arquivos; falha de margens vira aviso', async () => {
  const g = googleFalso({ falhaDocs: true });
  const r = await salvarDocumentoHtml({ pastaId: PASTA, nome: 'X', html: '<p>a</p>', formatos: ['pdf', 'docx', 'gdoc'], orientacao: 'paisagem' }, { ...g, env: ENV });
  assert.deepEqual(r.arquivos.map(a => a.formato), ['pdf', 'docx', 'gdoc']);
  assert.ok(!g.chamadas.some(c => c[0] === 'delete'));
  assert.equal(r.avisos.length, 1);
});

test('recusa pasta fora das pastas da equipe, pasta inexistente, formato inválido e HTML vazio', async () => {
  const fora = googleFalso({ pastas: { [PASTA]: { parents: ['OUTRA_PASTA_99'] } } });
  await assert.rejects(salvarDocumentoHtml({ pastaId: PASTA, nome: 'X', html: '<p>a</p>' }, { ...fora, env: ENV }), e => e.status === 403);
  assert.ok(!fora.chamadas.some(c => c[0] === 'create'));
  const g = googleFalso();
  await assert.rejects(salvarDocumentoHtml({ pastaId: 'NAO_EXISTE_123', nome: 'X', html: '<p>a</p>' }, { ...g, env: ENV }), e => e.status === 404);
  await assert.rejects(salvarDocumentoHtml({ pastaId: '../x', nome: 'X', html: '<p>a</p>' }, { ...g, env: ENV }), e => e.status === 400);
  await assert.rejects(salvarDocumentoHtml({ pastaId: PASTA, nome: 'X', html: '<p>a</p>', formatos: ['exe'] }, { ...g, env: ENV }), e => e.status === 422);
  await assert.rejects(salvarDocumentoHtml({ pastaId: PASTA, nome: 'X', html: '  ' }, { ...g, env: ENV }), e => e.status === 422);
  await assert.rejects(salvarDocumentoHtml({ pastaId: PASTA, nome: 'X', html: '<p>a</p>' }, { ...g, env: {} }), e => e.status === 503);
});

test('a própria pasta raiz configurada é destino válido', async () => {
  const g = googleFalso({ pastas: { OUTORGANTES_26: { parents: ['ALGUM_PAI_123'] } } });
  const r = await salvarDocumentoHtml({ pastaId: 'OUTORGANTES_26', nome: 'X', html: '<p>a</p>' }, { ...g, env: ENV });
  assert.equal(r.arquivos.length, 1);
});

test('salvarPecaNoPadrao: sobe o .docx convertendo em Google Doc, exporta PDF, grava o docx gerado e apaga o temporário', async () => {
  const { drive, chamadas } = googleFalso();
  const docx = Buffer.from('DOCX');
  const r = await salvarPecaNoPadrao({ pastaId: PASTA, nome: 'INICIAL - FULANO', blocos: [{ tipo: 'fecho' }], formatos: ['pdf', 'docx'] },
    { drive, env: ENV, montar: async () => docx });
  assert.deepEqual(chamadas[0], ['create', 'INICIAL - FULANO', 'application/vnd.google-apps.document', PASTA]);
  assert.deepEqual(chamadas.filter(c => c[0] === 'export').map(c => c[1]), ['application/pdf'], 'o docx não é reexportado do Google');
  assert.deepEqual(r.arquivos.map(a => a.nome), ['INICIAL - FULANO.pdf', 'INICIAL - FULANO.docx']);
  assert.ok(chamadas.some(c => c[0] === 'delete' && c[1] === 'id-INICIAL - FULANO'));
  assert.deepEqual(r.avisos, []);
});

test('salvarPecaNoPadrao: bloco inválido barra antes de tocar no Drive', async () => {
  const { drive, chamadas } = googleFalso();
  await assert.rejects(salvarPecaNoPadrao({ pastaId: PASTA, nome: 'X', blocos: [{ tipo: 'nada' }] }, { drive, env: ENV }), { status: 422 });
  assert.equal(chamadas.length, 0);
});
