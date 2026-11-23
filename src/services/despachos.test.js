import test from 'node:test';
import assert from 'node:assert/strict';
import { criarConsultaDespachos, criarGravacaoVarredura, validarVarredura } from './despachos.js';
import { MOVIMENTOS_AUTOMATICOS } from './processosExternos.js';

const NUM_A = '0880640-03.2025.8.15.2001';
const NUM_B = '0802840-47.2026.8.15.2005';
const NUM_FORA = '0000001-11.2026.8.15.2001';

function respostaFake() {
  return {
    statusCode: 200,
    body: null,
    status(codigo) { this.statusCode = codigo; return this; },
    json(corpo) { this.body = corpo; return this; },
  };
}

function item(numero, extra = {}) {
  return { numero, folha: 'gabinete', local: '2º JEFP/B', acervo: 'B', bloco: 'Homologar o cumprimento', dias_parado: 1, ...extra };
}

test('valida o corpo da varredura', () => {
  assert.match(validarVarredura({}).erro, /executada_em/);
  assert.match(validarVarredura({ executada_em: '2026-11-23T15:00:00Z', itens: 'x' }).erro, /lista/);
  assert.match(validarVarredura({ executada_em: '2026-11-23T15:00:00Z', itens: [item('123')] }).erro, /número/);
  assert.match(validarVarredura({ executada_em: '2026-11-23T15:00:00Z', itens: [item(NUM_A, { folha: 'sai' })] }).erro, /folha/);
  assert.match(validarVarredura({ executada_em: '2026-11-23T15:00:00Z', itens: [item(NUM_A, { dias_parado: -2 })] }).erro, /dias_parado/);

  assert.equal(validarVarredura({ executada_em: '2026-11-23T15:00:00Z', itens: [item(NUM_A, { folha: 'diligencia', bloco: 'Responder impugnação' })] }).erro, undefined);

  const ok = validarVarredura({
    executada_em: '2026-11-23T15:00:00Z',
    corte: '2026-11-23T13:00:00Z',
    processos_lidos: 44,
    alertas: ['  PJe   pediu verificação  '],
    itens: [item(NUM_A, { observacao: 'x'.repeat(900) })],
    acervos: [{ numero: NUM_A, letra: 'B' }, { numero: NUM_B, letra: 'acervo' }, { numero: 'lixo', letra: 'A' }],
  });
  assert.equal(ok.erro, undefined);
  assert.equal(ok.itens[0].observacao.length, 400);
  assert.deepEqual(ok.alertas, ['PJe pediu verificação']);
  assert.deepEqual(ok.acervos, [{ numero: NUM_A, letra: 'B' }]);
  assert.equal(ok.processos_lidos, 44);
});

function conexaoFake(processosNoAM) {
  const chamadas = [];
  const tx = {
    async query(sql, params) {
      chamadas.push({ sql, params });
      if (/FROM processos WHERE numero = ANY/.test(sql)) {
        return params[0].filter(n => processosNoAM[n]).map(n => ({ id: processosNoAM[n], numero: n }));
      }
      return [];
    },
    async queryOne(sql, params) {
      chamadas.push({ sql, params });
      if (/INSERT INTO despachos_varreduras/.test(sql)) return { id: '11111111-1111-4111-8111-111111111111' };
      return null;
    },
    async execute(sql, params) {
      chamadas.push({ sql, params });
      return { rowCount: /UPDATE processos/.test(sql) ? JSON.parse(params[0]).length : 0 };
    },
  };
  return { chamadas, conexao: { transaction: fn => fn(tx) } };
}

test('grava só processos do AM, ignora os demais e atualiza o acervo', async () => {
  const { chamadas, conexao } = conexaoFake({ [NUM_A]: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
  const res = respostaFake();
  await criarGravacaoVarredura(conexao)({
    body: {
      executada_em: '2026-11-23T15:00:00Z',
      itens: [item(NUM_A), item(NUM_FORA)],
      acervos: [{ numero: NUM_A, letra: 'B' }, { numero: NUM_FORA, letra: 'A' }],
    },
    integracao: { id: '22222222-2222-4222-8222-222222222222' },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.itens, 1);
  assert.equal(res.body.ignorados, 1);
  assert.equal(res.body.acervos_atualizados, 1);

  const insercao = chamadas.find(c => /INSERT INTO despachos_itens/.test(c.sql));
  const gravados = JSON.parse(insercao.params[1]);
  assert.equal(gravados.length, 1);
  assert.equal(gravados[0].processo_id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.ok(chamadas.some(c => /INSERT INTO logs_auditoria/i.test(c.sql)), 'registra auditoria na mesma transação');
});

test('corpo inválido não abre transação', async () => {
  let abriu = false;
  const res = respostaFake();
  await criarGravacaoVarredura({ transaction: async () => { abriu = true; } })({ body: { itens: [] } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(abriu, false);
});

test('a consulta esconde processo restrito de quem não pode vê-lo', async () => {
  const consultas = [];
  const conexao = {
    async queryOne() { return { id: 'v1', executada_em: '2026-11-23T15:00:00Z', alertas: [] }; },
    async query(sql) { consultas.push(sql); return []; },
  };
  const res = respostaFake();
  await criarConsultaDespachos(conexao)({ user: { pode_marcar_restrito: false } }, res);
  assert.equal(res.body.ok, true);
  assert.match(consultas[0], /p\.visibilidade = 'normal'/);

  const consultas2 = [];
  await criarConsultaDespachos({ ...conexao, async query(sql) { consultas2.push(sql); return []; } })({ user: { pode_marcar_restrito: true } }, respostaFake());
  assert.doesNotMatch(consultas2[0], /visibilidade/);
});

test('sem varredura ainda, a consulta devolve lista vazia', async () => {
  const res = respostaFake();
  await criarConsultaDespachos({ async queryOne() { return null; }, async query() { return []; } })({ user: {} }, res);
  assert.deepEqual(res.body, { ok: true, varredura: null, itens: [] });
});

test('o parado há ignora os andamentos automáticos reais do PJe', () => {
  const re = new RegExp(MOVIMENTOS_AUTOMATICOS, 'i');
  for (const t of [
    'Decurso de prazo', 'Publicação', 'Disponibilização no Diário', 'Processo encaminhado a Juiz de Direito - Acervo B',
    'Inclusão no Juízo 100% Digital', 'Autos incluídos no Juízo 100% Digital', 'Expedição de documento',
    'Juntada de certidão automática NUMOPEDE', 'Expedida/certificada a comunicação eletrônica', 'Decorrido prazo de ESTADO',
  ]) assert.match(t, re, t);
  for (const t of ['Conclusos para despacho', 'Juntada de alvará', 'Proferido despacho de mero expediente', 'Homologados os cálculos']) {
    assert.doesNotMatch(t, re, t);
  }
});

import { criarDownloadArquivo, criarEnvioArquivo, validarArquivo } from './despachos.js';

const VID = '11111111-1111-4111-8111-111111111111';
const PDF = Buffer.from('%PDF-1.4 teste').toString('base64');
const XLSX = Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.from('resto')]).toString('base64');

test('arquivo: só PDF ou planilha de verdade, com nome seguro e até 5 MB', () => {
  assert.equal(validarArquivo({ varredura_id: VID, nome: 'Folha-Gabinete-23-11-2026.pdf', conteudo_base64: PDF }).tipo, 'pdf');
  assert.equal(validarArquivo({ varredura_id: VID, nome: 'Lista de Despacho 23-11-2026.xlsx', conteudo_base64: XLSX }).tipo, 'xlsx');
  assert.match(validarArquivo({ varredura_id: 'x', nome: 'a.pdf', conteudo_base64: PDF }).erro, /varredura_id/);
  assert.match(validarArquivo({ varredura_id: VID, nome: '../../etc/passwd.pdf', conteudo_base64: PDF }).erro, /Nome/);
  assert.match(validarArquivo({ varredura_id: VID, nome: 'virus.exe', conteudo_base64: PDF }).erro, /Nome/);
  assert.match(validarArquivo({ varredura_id: VID, nome: 'falso.pdf', conteudo_base64: XLSX }).erro, /PDF/);
  assert.match(validarArquivo({ varredura_id: VID, nome: 'falso.xlsx', conteudo_base64: PDF }).erro, /planilha/);
  const grande = Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(5 * 1024 * 1024)]).toString('base64');
  assert.match(validarArquivo({ varredura_id: VID, nome: 'grande.pdf', conteudo_base64: grande }).erro, /5 MB/);
});

test('arquivo: envio para varredura inexistente é recusado', async () => {
  const res = respostaFake();
  await criarEnvioArquivo({ async queryOne() { return null; } })({ body: { varredura_id: VID, nome: 'a b.pdf', conteudo_base64: PDF } }, res);
  assert.equal(res.statusCode, 404);
});

test('arquivo: download devolve o conteúdo com o tipo certo e registra auditoria', async () => {
  const auditorias = [];
  const cabecalhos = {};
  let enviado = null;
  const res = { ...respostaFake(), setHeader(k, v) { cabecalhos[k] = v; }, send(b) { enviado = b; return this; } };
  const conexao = { async queryOne() { return { id: VID, nome: 'Folha-Cartório-23-11-2026.pdf', tipo: 'pdf', conteudo: Buffer.from('%PDF-x') }; } };
  await criarDownloadArquivo(conexao, async a => { auditorias.push(a); })({ params: { id: VID }, user: { id: 'u1' } }, res);
  assert.equal(cabecalhos['Content-Type'], 'application/pdf');
  assert.match(cabecalhos['Content-Disposition'], /attachment; filename\*=UTF-8''Folha-Cart%C3%B3rio/);
  assert.equal(enviado.toString(), '%PDF-x');
  assert.equal(auditorias[0].acao, 'baixar_arquivo_despachos');
  const ruim = respostaFake();
  await criarDownloadArquivo(conexao, async () => {})({ params: { id: '1 or 1=1' } }, ruim);
  assert.equal(ruim.statusCode, 400);
});
