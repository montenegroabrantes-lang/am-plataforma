import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import 'express-async-errors';

// S-25 — exportação CSV de Processos neutraliza fórmulas (= + - @). Banco = dublê.

const { db } = await import('../db/index.js');
const { processosRouter } = await import('./processos.js');
const { neutralizarFormula, celulaCsv } = await import('../utils/csv.js');

let linhas, servidor, base;
db.query = async () => linhas;
db.queryOne = async () => null;
db.execute = async () => ({ rowCount: 0, rows: [] });

before(async () => {
  const app = express();
  app.use((req, _res, next) => { req.user = { id: 'u', perfil: 'master', pode_marcar_restrito: false }; next(); });
  app.use('/api/processos', processosRouter);
  servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(async () => { await new Promise(r => servidor.close(r)); });

const baixar = async () => {
  const r = await fetch(`${base}/api/processos/exportar-excel`);
  return { status: r.status, tipo: r.headers.get('content-type'), texto: await r.text() };
};

test('neutralizarFormula: = + - @ TAB e CR no começo ganham apóstrofo; o resto fica intacto', () => {
  for (const f of ['=HYPERLINK("http://x.invalid","clique")', '+1+1', '-2+3', '@SUM(A1)', '\t=1', '\r=1']) {
    assert.equal(neutralizarFormula(f), `'${f}`, JSON.stringify(f));
  }
  for (const ok of ['0001234-56.2021.8.15.0001', '123.456.789-00', 'Vara Cível - 2ª', 'a=b', 'e-mail@x.invalid', '', 'Município de João Pessoa', '01/02/2026']) {
    assert.equal(neutralizarFormula(ok), ok, ok);
  }
});

test('celulaCsv: neutraliza ANTES de dobrar as aspas e envolve em aspas', () => {
  assert.equal(celulaCsv('=1+"2"'), `"'=1+""2"""`);
  assert.equal(celulaCsv(null), '""');
  assert.equal(celulaCsv(undefined), '""');
  assert.equal(celulaCsv('normal'), '"normal"');
});

test('exportar-excel: células que começam como fórmula saem como texto; CNJ e CPF intactos', async () => {
  linhas = [{
    numero: '0001234-56.2021.8.15.0001',
    cliente_nome: '=HYPERLINK("http://malicioso.invalid","Clique")',
    cliente_cpf: '52998224725',
    situacao_atual: 'aguardando_rpv',
    tribunal: 'TJPB',
    vara: '-2+3',
    polo_passivo: '@SUM(1+1)',
    urgente: true,
    data_distribuicao: '2021-03-01',
    tem_cessao: false,
    ultima_movimentacao: null,
  }];
  const { status, tipo, texto } = await baixar();
  assert.equal(status, 200);
  assert.match(tipo, /text\/csv/);
  const corpo = texto.replace(/^﻿/, '');
  const [cabecalho, linha] = corpo.split('\r\n');
  assert.equal(cabecalho.split(';').length, 11, 'as 11 colunas de sempre');
  assert.ok(linha.includes(`"'=HYPERLINK(""http://malicioso.invalid"",""Clique"")"`), linha);
  assert.ok(linha.includes(`"'-2+3"`), linha);
  assert.ok(linha.includes(`"'@SUM(1+1)"`), linha);
  assert.ok(linha.startsWith('"0001234-56.2021.8.15.0001";'), 'o CNJ não ganha apóstrofo');
  assert.ok(linha.includes('"52998224725"'));
  // nenhuma célula do arquivo começa com = + - @ depois da aspa de abertura
  for (const celula of linha.match(/"(?:[^"]|"")*"/g)) assert.equal(/^"[=+\-@\t\r]/.test(celula), false, celula);
});

test('exportar-excel: linha comum não muda (hífen no meio do texto, datas, Sim/Não)', async () => {
  linhas = [{
    numero: '0009999-11.2020.8.15.0001', cliente_nome: 'Ana Souza-Lima', cliente_cpf: '12345678909',
    situacao_atual: null, tribunal: 'TJPB', vara: '1ª Vara - Cível', polo_passivo: 'Município de João Pessoa',
    urgente: false, data_distribuicao: '2020-05-04T00:00:00.000Z', tem_cessao: true, ultima_movimentacao: null,
  }];
  const { texto } = await baixar();
  const linha = texto.split('\r\n')[1];
  assert.ok(linha.includes('"Ana Souza-Lima"'));
  assert.ok(linha.includes('"1ª Vara - Cível"'));
  assert.ok(linha.includes('"Sem classificação"'));
  assert.ok(linha.includes('"Não"') && linha.includes('"Sim"'));
  assert.equal(linha.includes("'"), false, 'nenhum apóstrofo desnecessário');
});
