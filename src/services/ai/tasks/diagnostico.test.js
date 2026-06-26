import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticarMovimentacao } from './diagnostico.js';

const mov = { numero: '123', tribunal: 'TJPB', produto: 'aposentadoria', data: '2026-06-01', texto: 'Intimação para manifestar' };

// Provider falso — devolve o que mandarmos, sem chamar a IA de verdade
const provFake = (resposta) => ({ gerarTexto: async () => resposta });

const jsonValido = {
  ultimaMovimentacao: { data: '2026-06-01', descricao: 'Intimação' },
  pendencia: { tipo: 'PETICIONAR', resumo: 'Manifestar em 15 dias', prazoFinal: '2026-06-16T23:59:59', statusPrazo: 'ATIVO', precisaConferenciaPJe: true },
  prioridade: 'ALTO',
  confianca: 'ALTA',
};

test('JSON válido é parseado e mapeado corretamente', async () => {
  const r = await diagnosticarMovimentacao(mov, provFake(JSON.stringify(jsonValido)));
  assert.equal(r.pendencia.tipo, 'PETICIONAR');
  assert.equal(r.pendencia.statusPrazo, 'ATIVO');
  assert.equal(r.prioridade, 'ALTO');
  assert.equal(r.confianca, 'ALTA');
});

test('JSON envolto em ```json ... ``` ainda é parseado', async () => {
  const cercado = '```json\n' + JSON.stringify(jsonValido) + '\n```';
  const r = await diagnosticarMovimentacao(mov, provFake(cercado));
  assert.equal(r.pendencia.tipo, 'PETICIONAR');
});

test('tipo de pendência inválido cai para ERRO_DE_LEITURA (whitelist)', async () => {
  const ruim = { ...jsonValido, pendencia: { ...jsonValido.pendencia, tipo: 'TIPO_INVENTADO' } };
  const r = await diagnosticarMovimentacao(mov, provFake(JSON.stringify(ruim)));
  assert.equal(r.pendencia.tipo, 'ERRO_DE_LEITURA');
});

test('prioridade inválida cai para MEDIO', async () => {
  const ruim = { ...jsonValido, prioridade: 'URGENTÍSSIMO' };
  const r = await diagnosticarMovimentacao(mov, provFake(JSON.stringify(ruim)));
  assert.equal(r.prioridade, 'MEDIO');
});

test('resposta não-JSON cai no fallback seguro (não lança exceção)', async () => {
  const r = await diagnosticarMovimentacao(mov, provFake('Desculpe, não consegui processar.'));
  assert.equal(r.pendencia.tipo, 'ERRO_DE_LEITURA');
  assert.equal(r.confianca, 'BAIXA');
  assert.equal(r.prioridade, 'MEDIO');
});

test('campos ausentes recebem defaults sem quebrar', async () => {
  const r = await diagnosticarMovimentacao(mov, provFake(JSON.stringify({})));
  assert.equal(r.pendencia.precisaConferenciaPJe, false);
  assert.equal(r.pendencia.tipo, 'ERRO_DE_LEITURA');
  assert.ok(r.ultimaMovimentacao); // fallback usa trecho do texto
});
