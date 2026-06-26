import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classificarProcesso } from './classificacao.js';

const base = {
  numero: '123',
  tribunal: 'TJPB',
  produto: 'aposentadoria',
  movimentacoes: [{ texto: 'Concluso para sentença' }],
};

// Provider falso injetado via opção `provider`
const provFake = (resposta) => ({ gerarTexto: async () => resposta });

const jsonValido = {
  situacao_atual: 'concluso_sentenca',
  etapa_atual: 'Aguardando sentença do juiz',
  localizacao_processual: 'parado_gabinete',
  tipo_requisicao: 'a_definir',
  status_rpv: 'nao_iniciado',
  status_precatorio: 'nao_iniciado',
  status_alvara: 'nao_iniciado',
  confianca: 'ALTA',
};

test('JSON válido mapeia situacao_atual e localizacao corretamente', async () => {
  const r = await classificarProcesso({ ...base, provider: provFake(JSON.stringify(jsonValido)) });
  assert.equal(r.situacao_atual, 'concluso_sentenca');
  assert.equal(r.localizacao_processual, 'parado_gabinete');
  assert.equal(r.confianca, 'ALTA');
});

test('situacao_atual fora da whitelist vira null', async () => {
  const ruim = { ...jsonValido, situacao_atual: 'fase_inventada' };
  const r = await classificarProcesso({ ...base, provider: provFake(JSON.stringify(ruim)) });
  assert.equal(r.situacao_atual, null);
});

test('status_rpv inválido cai para nao_iniciado', async () => {
  const ruim = { ...jsonValido, status_rpv: 'sei_la' };
  const r = await classificarProcesso({ ...base, provider: provFake(JSON.stringify(ruim)) });
  assert.equal(r.status_rpv, 'nao_iniciado');
});

test('tipo_requisicao inválido cai para a_definir', async () => {
  const ruim = { ...jsonValido, tipo_requisicao: 'cheque' };
  const r = await classificarProcesso({ ...base, provider: provFake(JSON.stringify(ruim)) });
  assert.equal(r.tipo_requisicao, 'a_definir');
});

test('resposta não-JSON cai no fallback seguro', async () => {
  const r = await classificarProcesso({ ...base, provider: provFake('não entendi') });
  assert.equal(r.situacao_atual, null);
  assert.equal(r.tipo_requisicao, 'a_definir');
  assert.equal(r.confianca, 'BAIXA');
});

test('etapa_atual é truncada em 200 caracteres', async () => {
  const longo = { ...jsonValido, etapa_atual: 'x'.repeat(500) };
  const r = await classificarProcesso({ ...base, provider: provFake(JSON.stringify(longo)) });
  assert.equal(r.etapa_atual.length, 200);
});
