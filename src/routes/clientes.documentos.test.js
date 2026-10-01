import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import 'express-async-errors';
import { criarDocumentosRouter } from './clientes.documentos.js';
import { tratadorGlobalDeErros } from '../middleware/erros.js';
import { ehPdf, limiteDeUploadDoPerfil, LIMITES_UPLOAD } from '../utils/arquivoPdf.js';

// S-24 — upload de documentos do cliente: só PDF de verdade (assinatura %PDF-), 1 arquivo, limite por
// perfil, `enviado_por` preenchido e auditoria de envio e exclusão. O Drive é um objeto falso e o banco
// uma dublê: nada toca rede nem banco real.

const MASTER = { id: '11111111-1111-4111-8111-111111111111', perfil: 'master' };
const JUNIOR = { id: '22222222-2222-4222-8222-222222222222', perfil: 'junior' };
const CLIENTE = '33333333-3333-4333-8333-333333333333';
const DOC = '44444444-4444-4444-8444-444444444444';
const MB = 1024 * 1024;

let usuario, consultas, auditoria, chamadasDrive, falhaNoDrive, docRemovivel, servidor, base;
const consoleErrorOriginal = console.error;

const banco = {
  async query(sql, params) {
    const s = sql.replace(/\s+/g, ' ').trim();
    consultas.push({ s, params });
    if (s.startsWith('INSERT INTO documentos')) return [{ id: DOC, nome: params[1], categoria: params[2], drive_url: params[4], criado_em: '2026-09-30T12:00:00Z' }];
    if (s.startsWith('SELECT id, nome, categoria')) return [];
    throw new Error(`consulta inesperada: ${s.slice(0, 60)}`);
  },
  async queryOne(sql, params) {
    consultas.push({ s: sql.replace(/\s+/g, ' ').trim(), params });
    return { id: CLIENTE, nome: 'Cliente de Teste', cpf: '52998224725', drive_pasta_id: 'pasta-1' };
  },
  async execute(sql, params) {
    const s = sql.replace(/\s+/g, ' ').trim();
    consultas.push({ s, params });
    if (s.startsWith('UPDATE documentos SET deletado')) return docRemovivel ? { rowCount: 1, rows: [{ id: params[0], categoria: 'pessoais' }] } : { rowCount: 0, rows: [] };
    return { rowCount: 1, rows: [] };
  },
};
const drive = {
  async criarPastaCliente() { chamadasDrive.push('pasta'); return { id: 'pasta-nova', url: 'https://drive.exemplo.invalid/p' }; },
  async uploadPdf(pasta, nome) {
    chamadasDrive.push(`upload:${pasta}:${nome}`);
    if (falhaNoDrive) throw new Error('invalid_grant: token do Drive revogado para conta@exemplo.invalid');
    return { id: 'arq-1', url: 'https://drive.exemplo.invalid/a' };
  },
};
const auditar = async (dados) => { auditoria.push(dados); };

before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = usuario; req._ip = '203.0.113.9'; next(); });
  app.use('/api/clientes/:id/documentos', criarDocumentosRouter({ banco, drive, auditar }));
  app.use(tratadorGlobalDeErros);
  servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(async () => { console.error = consoleErrorOriginal; await new Promise(r => servidor.close(r)); });

beforeEach(() => {
  usuario = MASTER; consultas = []; auditoria = []; chamadasDrive = []; falhaNoDrive = false; docRemovivel = true;
  console.error = () => {};
});

const PDF = tamanho => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(Math.max(0, tamanho - 9), 0x20)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);

async function enviar(conteudo, { nome = 'documento.pdf', tipo = 'application/pdf', categoria = 'pessoais', extras = [], id = CLIENTE, campo = 'arquivo' } = {}) {
  const form = new FormData();
  if (conteudo) form.append(campo, new Blob([conteudo], { type: tipo }), nome);
  for (const [n, c, t] of extras) form.append(n, new Blob([c], { type: t }), 'outro.pdf');
  form.append('categoria', categoria);
  const r = await fetch(`${base}/api/clientes/${id}/documentos`, { method: 'POST', body: form });
  return { status: r.status, corpo: await r.json() };
}

test('ehPdf: só a assinatura %PDF- no começo do conteúdo vale', () => {
  assert.equal(ehPdf(PDF(100)), true);
  assert.equal(ehPdf(PNG), false);
  assert.equal(ehPdf(Buffer.from('<html>%PDF-</html>')), false);
  assert.equal(ehPdf(Buffer.from('%PDF')), false);
  assert.equal(ehPdf(Buffer.alloc(0)), false);
  assert.equal(ehPdf(null), false);
  assert.equal(ehPdf('%PDF-1.4'), false);
});

test('limite por perfil: master 20 MB, júnior 10 MB, perfil desconhecido o menor (inclusive chaves herdadas do Object)', () => {
  assert.equal(limiteDeUploadDoPerfil('master'), 20 * MB);
  assert.equal(limiteDeUploadDoPerfil('junior'), 10 * MB);
  for (const perfil of ['constructor', '__proto__', undefined, 'admin']) assert.equal(limiteDeUploadDoPerfil(perfil), 10 * MB, String(perfil));
  assert.deepEqual(LIMITES_UPLOAD, { master: 20 * MB, junior: 10 * MB });
});

test('PNG renomeado para .pdf (com Content-Type application/pdf) → 415 "Envie um PDF.", sem tocar banco nem Drive', async () => {
  const r = await enviar(PNG, { nome: 'identidade.pdf', tipo: 'application/pdf' });
  assert.equal(r.status, 415);
  assert.equal(r.corpo.erro, 'Envie um PDF.');
  assert.equal(consultas.length, 0);
  assert.deepEqual(chamadasDrive, []);
  assert.equal(auditoria.length, 0);
});

test('HTML e script disfarçados de PDF também são recusados', async () => {
  for (const conteudo of [Buffer.from('<script>alert(1)</script>'), Buffer.from('MZ\x90\x00'), Buffer.from('  %PDF-1.4 com espaço antes')]) {
    const r = await enviar(conteudo);
    assert.equal(r.status, 415);
  }
  assert.deepEqual(chamadasDrive, []);
});

test('PDF válido → 201, enviado_por = usuário, Drive recebe o arquivo e o envio é auditado', async () => {
  const r = await enviar(PDF(2048), { nome: 'rg.pdf', categoria: 'pessoais' });
  assert.equal(r.status, 201);
  assert.equal(r.corpo.ok, true);
  assert.equal(r.corpo.documento.id, DOC);
  assert.equal(chamadasDrive.length, 1);
  const insert = consultas.find(c => c.s.startsWith('INSERT INTO documentos'));
  assert.match(insert.s, /\(cliente_id, nome, categoria, drive_file_id, drive_url, enviado_por\)/);
  assert.equal(insert.params[5], MASTER.id, 'enviado_por preenchido (antes ficava vazio)');
  assert.equal(auditoria.length, 1);
  assert.deepEqual(
    { acao: auditoria[0].acao, entidade: auditoria[0].entidade, entidadeId: auditoria[0].entidadeId, usuarioId: auditoria[0].usuarioId, ip: auditoria[0].ip },
    { acao: 'enviar_documento', entidade: 'documento', entidadeId: DOC, usuarioId: MASTER.id, ip: '203.0.113.9' }
  );
  assert.deepEqual(auditoria[0].valorDepois, { cliente_id: CLIENTE, categoria: 'pessoais', tamanho: 2048 });
  assert.equal(JSON.stringify(auditoria[0]).includes('rg.pdf'), false, 'nem o nome do arquivo (pode ter o nome da pessoa) vai para o log');
});

test('júnior: PDF de 11 MB → 413 pelo limite do perfil; o mesmo arquivo passa para o Master', async () => {
  usuario = JUNIOR;
  const grande = PDF(11 * MB);
  const r1 = await enviar(grande);
  assert.equal(r1.status, 413);
  assert.match(r1.corpo.erro, /10 MB/);
  assert.deepEqual(chamadasDrive, []);
  usuario = MASTER;
  const r2 = await enviar(grande);
  assert.equal(r2.status, 201);
});

test('acima de 20 MB nem o Master envia: 413 (limite do multer, com mensagem clara)', async () => {
  const r = await enviar(PDF(21 * MB));
  assert.equal(r.status, 413);
  assert.match(r.corpo.erro, /grande demais/);
  assert.deepEqual(chamadasDrive, []);
});

test('dois arquivos no mesmo envio → 400 (files: 1); campo com outro nome → 400', async () => {
  const dois = await enviar(PDF(500), { extras: [['arquivo', PDF(500), 'application/pdf']] });
  assert.equal(dois.status, 400);
  const outroCampo = await enviar(PDF(500), { campo: 'file' });
  assert.equal(outroCampo.status, 400);
  assert.deepEqual(chamadasDrive, []);
});

test('sem arquivo → 400; categoria inválida → 400; id de cliente malformado → 400', async () => {
  assert.equal((await enviar(null)).status, 400);
  assert.equal((await enviar(PDF(300), { categoria: 'qualquer' })).status, 400);
  assert.equal((await enviar(PDF(300), { id: 'nao-e-uuid' })).status, 400);
  assert.deepEqual(chamadasDrive, []);
});

test('falha do Drive → 500 com código, sem a mensagem técnica (token, conta), sem registro nem auditoria', async () => {
  falhaNoDrive = true;
  const r = await enviar(PDF(500));
  assert.equal(r.status, 500);
  assert.match(r.corpo.erro, /Google Drive\. Código [0-9A-F]{8}\.$/);
  for (const vazou of ['invalid_grant', 'conta@exemplo.invalid', 'token']) assert.equal(JSON.stringify(r.corpo).includes(vazou), false, vazou);
  assert.equal(consultas.some(c => c.s.startsWith('INSERT INTO documentos')), false);
  assert.equal(auditoria.length, 0);
});

test('exclusão de documento é auditada (id, cliente e categoria); documento inexistente ou já excluído → 404 sem auditoria', async () => {
  const r = await fetch(`${base}/api/clientes/${CLIENTE}/documentos/${DOC}`, { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.equal(auditoria.length, 1);
  assert.equal(auditoria[0].acao, 'excluir_documento');
  assert.equal(auditoria[0].entidadeId, DOC);
  assert.deepEqual(auditoria[0].valorAntes, { cliente_id: CLIENTE, categoria: 'pessoais' });
  const update = consultas.find(c => c.s.startsWith('UPDATE documentos SET deletado'));
  assert.match(update.s, /AND deletado = false/, 'não audita duas vezes a exclusão do mesmo documento');

  auditoria = []; docRemovivel = false;
  const r2 = await fetch(`${base}/api/clientes/${CLIENTE}/documentos/${DOC}`, { method: 'DELETE' });
  assert.equal(r2.status, 404);
  assert.equal(auditoria.length, 0);
});

test('a listagem continua igual (só os não excluídos do cliente)', async () => {
  const r = await fetch(`${base}/api/clientes/${CLIENTE}/documentos`);
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).documentos, []);
  assert.match(consultas[0].s, /WHERE cliente_id = \$1 AND deletado = false/);
});

test('montagem em clientes.js: /api/clientes/:id/documentos usa o router novo (PNG → 415, id ruim → 400, sem banco)', async () => {
  const { db } = await import('../db/index.js');
  for (const m of ['query', 'queryOne', 'execute']) db[m] = async () => { throw new Error('banco real proibido nos testes'); };
  const { clientesRouter } = await import('./clientes.js');
  const app = express();
  app.use((req, _res, next) => { req.user = MASTER; req._ip = '203.0.113.9'; next(); });
  app.use('/api/clientes', clientesRouter);
  app.use(tratadorGlobalDeErros);
  const s = http.createServer(app);
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${s.address().port}/api/clientes`;
  try {
    const form = new FormData();
    form.append('arquivo', new Blob([PNG], { type: 'application/pdf' }), 'a.pdf');
    form.append('categoria', 'pessoais');
    const r1 = await fetch(`${url}/${CLIENTE}/documentos`, { method: 'POST', body: form });
    assert.equal(r1.status, 415);
    const r2 = await fetch(`${url}/nao-e-uuid/documentos`, { method: 'POST', body: form });
    assert.equal(r2.status, 400);
  } finally { await new Promise(r => s.close(r)); }
});
