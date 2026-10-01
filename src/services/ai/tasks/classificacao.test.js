import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classificarProcesso, preservarRequisicaoManual } from './classificacao.js';

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

// R-07: valor inválido vira null (e não um default) para o COALESCE do UPDATE manter o que já existe.
test('status_rpv inválido vira null, não nao_iniciado (não apaga o manual)', async () => {
  const ruim = { ...jsonValido, status_rpv: 'sei_la' };
  const r = await classificarProcesso({ ...base, provider: provFake(JSON.stringify(ruim)) });
  assert.equal(r.status_rpv, null);
});

test('status_precatorio e status_alvara inválidos também viram null', async () => {
  const ruim = { ...jsonValido, status_precatorio: 'x', status_alvara: 42 };
  const r = await classificarProcesso({ ...base, provider: provFake(JSON.stringify(ruim)) });
  assert.equal(r.status_precatorio, null);
  assert.equal(r.status_alvara, null);
});

test('tipo_requisicao inválido vira null, não a_definir', async () => {
  const ruim = { ...jsonValido, tipo_requisicao: 'cheque' };
  const r = await classificarProcesso({ ...base, provider: provFake(JSON.stringify(ruim)) });
  assert.equal(r.tipo_requisicao, null);
});

test('valores válidos de requisição passam como vieram (inclusive nao_iniciado explícito)', async () => {
  const r = await classificarProcesso({ ...base, provider: provFake(JSON.stringify({ ...jsonValido, tipo_requisicao: 'rpv', status_rpv: 'expedida' })) });
  assert.equal(r.tipo_requisicao, 'rpv');
  assert.equal(r.status_rpv, 'expedida');
  assert.equal(r.status_precatorio, 'nao_iniciado');
});

test('resposta não-JSON devolve null (o chamador não grava nada)', async () => {
  const r = await classificarProcesso({ ...base, provider: provFake('não entendi') });
  assert.equal(r, null);
});

test('JSON que não é objeto (null, lista, número) devolve null', async () => {
  for (const texto of ['null', '[]', '42', '"texto"']) {
    assert.equal(await classificarProcesso({ ...base, provider: provFake(texto) }), null, texto);
  }
});

test('JSON com todos os campos inválidos devolve null (não marca o processo como classificado pela IA)', async () => {
  const tudoRuim = { situacao_atual: 'x', etapa_atual: '', localizacao_processual: 'y', tipo_requisicao: 'z',
    status_rpv: 'a', status_precatorio: 'b', status_alvara: 'c', confianca: 'ALTA' };
  assert.equal(await classificarProcesso({ ...base, provider: provFake(JSON.stringify(tudoRuim)) }), null);
});

test('JSON com ao menos um campo aproveitável (só a etapa) é devolvido, com confiança BAIXA se inválida', async () => {
  const r = await classificarProcesso({ ...base, provider: provFake(JSON.stringify({ etapa_atual: 'Aguardando sentença' })) });
  assert.equal(r.etapa_atual, 'Aguardando sentença');
  assert.equal(r.situacao_atual, null);
  assert.equal(r.confianca, 'BAIXA');
});

test('etapa_atual é truncada em 200 caracteres', async () => {
  const longo = { ...jsonValido, etapa_atual: 'x'.repeat(500) };
  const r = await classificarProcesso({ ...base, provider: provFake(JSON.stringify(longo)) });
  assert.equal(r.etapa_atual.length, 200);
});

// ── R-07: a IA só avança o que existe, nunca rebaixa nem sobrescreve o manual ─────────────────────
const resIA = (extra = {}) => ({
  situacao_atual: 'concluso_sentenca', etapa_atual: 'x', localizacao_processual: null,
  tipo_requisicao: 'a_definir', status_rpv: 'nao_iniciado', status_precatorio: 'nao_iniciado', status_alvara: 'nao_iniciado',
  confianca: 'ALTA', ...extra,
});

test('preservar: IA dizendo nao_iniciado/a_definir não rebaixa RPV expedida definida à mão', () => {
  const atual = { tipo_requisicao: 'rpv', status_rpv: 'expedida', status_precatorio: 'nao_iniciado', status_alvara: 'nao_iniciado' };
  const r = preservarRequisicaoManual(atual, resIA());
  assert.equal(r.tipo_requisicao, null);
  assert.equal(r.status_rpv, null);
  assert.equal(r.status_precatorio, null);
  assert.equal(r.status_alvara, null);
});

test('preservar: precatório assinado e alvará expedido manuais também ficam intactos', () => {
  const atual = { tipo_requisicao: 'precatorio', status_rpv: null, status_precatorio: 'assinado', status_alvara: 'expedido' };
  const r = preservarRequisicaoManual(atual, resIA({ tipo_requisicao: 'precatorio', status_precatorio: 'minuta_juntada', status_alvara: 'pedido_apresentado' }));
  assert.equal(r.status_precatorio, null); // minuta_juntada vem ANTES de assinado
  assert.equal(r.status_alvara, null);     // pedido_apresentado vem ANTES de expedido
});

test('preservar: IA pode AVANÇAR um status (determinada -> expedida) e preencher o que está vazio', () => {
  const atual = { tipo_requisicao: 'rpv', status_rpv: 'determinada', status_precatorio: null, status_alvara: null };
  const r = preservarRequisicaoManual(atual, resIA({ tipo_requisicao: 'rpv', status_rpv: 'expedida', status_alvara: 'nao_iniciado' }));
  assert.equal(r.status_rpv, 'expedida');
  assert.equal(r.status_alvara, 'nao_iniciado'); // atual vazio: preencher com nao_iniciado é inofensivo
  assert.equal(r.tipo_requisicao, null);         // mesmo tipo: nada a gravar
});

test('preservar: mesmo valor do atual não é regravado', () => {
  const atual = { tipo_requisicao: 'rpv', status_rpv: 'expedida' };
  const r = preservarRequisicaoManual(atual, resIA({ tipo_requisicao: 'rpv', status_rpv: 'expedida' }));
  assert.equal(r.status_rpv, null);
});

test('preservar: tipo vazio ou a_definir é preenchido pela IA', () => {
  for (const tipoAtual of [null, undefined, 'a_definir']) {
    const r = preservarRequisicaoManual({ tipo_requisicao: tipoAtual, status_rpv: 'nao_iniciado' }, resIA({ tipo_requisicao: 'rpv', status_rpv: 'determinada' }));
    assert.equal(r.tipo_requisicao, 'rpv');
    assert.equal(r.status_rpv, 'determinada');
  }
});

test('preservar: IA discordando de um tipo já definido não grava tipo nem status (requisição inteira fica como está)', () => {
  const atual = { tipo_requisicao: 'rpv', status_rpv: 'determinada', status_precatorio: 'nao_iniciado', status_alvara: 'nao_iniciado' };
  const r = preservarRequisicaoManual(atual, resIA({ tipo_requisicao: 'precatorio', status_precatorio: 'assinado' }));
  assert.equal(r.tipo_requisicao, null);
  assert.equal(r.status_precatorio, null);
  assert.equal(r.status_rpv, null);
});

test('preservar: valor atual fora da lista conhecida não é sobrescrito', () => {
  const r = preservarRequisicaoManual({ tipo_requisicao: 'rpv', status_rpv: 'em_andamento_manual' }, resIA({ tipo_requisicao: 'rpv', status_rpv: 'paga' }));
  assert.equal(r.status_rpv, null);
});

test('preservar: sem linha atual (processo sumiu) trata como vazio e não quebra; demais campos da IA seguem', () => {
  const r = preservarRequisicaoManual(null, resIA({ tipo_requisicao: 'alvara', status_alvara: 'pedido_apresentado' }));
  assert.equal(r.tipo_requisicao, 'alvara');
  assert.equal(r.status_alvara, 'pedido_apresentado');
  assert.equal(r.situacao_atual, 'concluso_sentenca');
  assert.equal(r.confianca, 'ALTA');
});

test('preservar: campos null da IA (inválidos) continuam null e não viram valor', () => {
  const r = preservarRequisicaoManual({ tipo_requisicao: null, status_rpv: null }, resIA({ tipo_requisicao: null, status_rpv: null, status_precatorio: null, status_alvara: null }));
  assert.equal(r.tipo_requisicao, null);
  assert.equal(r.status_rpv, null);
  assert.equal(r.status_precatorio, null);
  assert.equal(r.status_alvara, null);
});
