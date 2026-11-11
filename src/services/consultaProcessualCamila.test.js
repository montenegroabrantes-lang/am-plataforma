import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analisarAndamentos, resumirProcesso, montarTextoCliente, escolherProcesso, nomeConfere,
  identificarClienteParaCamila, consultarProcessoParaCamila,
} from './consultaProcessualCamila.js';

const mov = (data, texto) => ({ data_movimentacao: `${data}T12:00:00Z`, texto });
const proc = (extra = {}) => ({ id: 'p1', numero: '0821303-20.2024.8.15.2001', tribunal: 'TJPB', status: 'ativo', sync_status: 'erro_sync', situacao_atual: null, ...extra });

test('fase mais avançada alcançada pelos andamentos', () => {
  const a = analisarAndamentos([
    mov('2026-01-10', 'Distribuído por sorteio'),
    mov('2026-02-10', 'Juntada de Petição de contestação'),
    mov('2026-03-10', 'Conclusos para julgamento'),
  ]);
  assert.equal(a.fase, 'concluso_sentenca');
});

test('procedente e procedente em parte podem ser informados', () => {
  const r1 = resumirProcesso(proc(), [mov('2026-05-01', 'Conclusos para julgamento'), mov('2026-06-01', 'Julgado procedente o pedido')]);
  assert.equal(r1.encaminhar, false);
  assert.match(r1.etapa, /julgado procedente$/);
  assert.match(montarTextoCliente({ nome: 'ANA', resumo: { ...r1, ultimoAndamentoEm: '01/06/2026' } }), /O seu processo 0821303-20\.2024\.8\.15\.2001 já tem sentença, com o pedido julgado procedente\./);
  const r2 = resumirProcesso(proc(), [mov('2026-06-01', 'Procedência em Parte')]);
  assert.match(r2.etapa, /procedente em parte/);
});

test('improcedência, extinção sem mérito e resultado de recurso vão para a equipe jurídica', () => {
  assert.equal(resumirProcesso(proc(), [mov('2026-06-01', 'Improcedência')]).motivo, 'resultado_sentenca');
  assert.equal(resumirProcesso(proc(), [mov('2026-06-01', 'Julgado improcedente o pedido')]).encaminhar, true);
  assert.equal(resumirProcesso(proc(), [mov('2026-06-01', 'Perempção, litispendência ou coisa julgada')]).encaminhar, true);
  const recurso = resumirProcesso(proc(), [mov('2026-06-01', 'Procedência'), mov('2026-07-01', 'Juntada de Petição de recurso inominado'), mov('2026-09-01', 'Não-Provimento')]);
  assert.equal(recurso.motivo, 'resultado_recurso');
});

test('pagamento e arquivamento vão para a equipe; desarquivamento reabre', () => {
  assert.equal(resumirProcesso(proc(), [mov('2026-06-01', 'Expedição de precatório/rpv')]).motivo, 'pagamento');
  assert.equal(resumirProcesso(proc(), [mov('2026-06-01', 'Documento — Alvará')]).motivo, 'pagamento');
  assert.equal(resumirProcesso(proc(), [mov('2026-06-01', 'Arquivado Definitivamente')]).motivo, 'arquivamento');
  const reaberto = resumirProcesso(proc(), [mov('2026-06-01', 'Arquivamento'), mov('2026-07-01', 'Desarquivamento'), mov('2026-07-02', 'Evoluída a classe de PROCEDIMENTO DO JUIZADO para CUMPRIMENTO DE SENTENÇA')]);
  assert.equal(reaberto.encaminhar, false);
  assert.match(reaberto.etapa, /cumprimento de sentença/);
  // "Levantamento da Suspensão" não é pagamento
  assert.notEqual(resumirProcesso(proc(), [mov('2026-06-01', 'Cumprimento de Levantamento da Suspensão')]).motivo, 'pagamento');
});

test('cumprimento de sentença e trânsito em julgado', () => {
  const r = resumirProcesso(proc(), [mov('2025-01-01', 'Procedência'), mov('2025-03-01', 'Trânsito em julgado')]);
  assert.match(r.etapa, /definitiva/);
  assert.equal(r.ultimoAndamentoEm, '01/03/2025');
});

test('sem andamento ou tribunal desatualizado vai para a equipe', () => {
  assert.equal(resumirProcesso(proc(), []).motivo, 'sem_andamentos');
  assert.equal(resumirProcesso(proc({ tribunal: 'TRF1' }), [mov('2026-06-01', 'Distribuído por sorteio')]).motivo, 'andamentos_desatualizados');
  assert.equal(resumirProcesso(proc({ tribunal: 'TRF3', sync_status: 'ok' }), [mov('2026-06-01', 'Distribuído por sorteio')]).encaminhar, false);
});

test('situação cadastrada à mão complementa os andamentos', () => {
  const r = resumirProcesso(proc({ situacao_atual: 'cumprimento_sentenca' }), [mov('2026-06-01', 'Ato ordinatório')]);
  assert.match(r.etapa, /cumprimento/);
  assert.equal(resumirProcesso(proc({ situacao_atual: 'em_rpv' }), [mov('2026-06-01', 'Ato ordinatório')]).motivo, 'pagamento');
  assert.equal(resumirProcesso(proc({ situacao_atual: 'sentenca_proferida' }), [mov('2026-06-01', 'Ato ordinatório')]).motivo, 'resultado_sentenca');
});

test('texto ao cliente: Fazenda Pública, sem valor, sem exclamação, convite aos outros processos', () => {
  const texto = montarTextoCliente({ nome: 'MARIA EROCLEIDE ARRUDA', outrosProcessos: 3,
    resumo: { numero: '0861312-58.2023.8.15.2001', etapa: 'está com o juiz para a sentença, antes da resposta da Fazenda Pública', ultimoAndamentoEm: '29/05/2026' } });
  assert.match(texto, /^Maria, sou Camila/);
  assert.match(texto, /Fazenda Pública/);
  assert.match(texto, /outro processo seu/);
  assert.doesNotMatch(texto, /!|R\$|senhor|Munic|Estado/i);
});

test('escolhe o ativo mais antigo, ou o número indicado', () => {
  const lista = [
    { numero: '0828914-53.2026.8.15.2001', status: 'ativo', data_distribuicao: '2026-03-01' },
    { numero: '0861312-58.2023.8.15.2001', status: 'ativo', data_distribuicao: '2023-10-01' },
    { numero: '0800001-00.2020.8.15.2001', status: 'arquivado', data_distribuicao: '2020-01-01' },
  ];
  assert.equal(escolherProcesso(lista).processo.numero, '0861312-58.2023.8.15.2001');
  assert.equal(escolherProcesso(lista).totalAtivos, 2);
  // sem data de distribuição: vale o ano do número, não a data de importação
  const semData = [
    { numero: '0818548-52.2026.8.15.2001', status: 'ativo', criado_em: '2025-01-01' },
    { numero: '0802266-07.2024.8.15.2001', status: 'ativo', criado_em: '2026-09-01' },
  ];
  assert.equal(escolherProcesso(semData).processo.numero, '0802266-07.2024.8.15.2001');
  assert.equal(escolherProcesso(lista, '0828914-53').processo.numero, '0828914-53.2026.8.15.2001');
  assert.equal(escolherProcesso(lista, '0999999-00').processo, null);
});

test('nome confere com o cadastro', () => {
  assert.equal(nomeConfere('Maria Erocleide Ramalho', 'MARIA EROCLEIDE ARRUDA RAMALHO DE OLIVEIRA'), true);
  assert.equal(nomeConfere('Maria', 'MARIA EROCLEIDE'), false);
  assert.equal(nomeConfere('Joana Erocleide', 'MARIA EROCLEIDE'), false);
});

function bancoFalso({ cliente, processos = [], movs = [] }) {
  const updates = [];
  return {
    updates,
    async queryOne() { return cliente; },
    async query(sql, params) {
      if (/^\s*UPDATE clientes/.test(sql)) { updates.push(params); return []; }
      if (/digisac_contact_id = \$1/.test(sql)) return cliente && cliente.digisac_contact_id === params[0] ? [cliente] : [];
      if (/FROM clientes/.test(sql)) return cliente ? [cliente] : [];
      if (/FROM processos/.test(sql)) return processos;
      if (/FROM movimentacoes/.test(sql)) return movs;
      return [];
    },
  };
}

test('identificação por CPF + nome grava o vínculo só em campo vazio', async () => {
  const banco = bancoFalso({
    cliente: { id: 'c1234567-x', nome: 'MARIA EROCLEIDE ARRUDA', whatsapp: null, digisac_contact_id: null, cpf: '12345678901' },
    processos: [proc({ data_distribuicao: '2024-01-01' })], movs: [mov('2026-06-01', 'Conclusos para julgamento')],
  });
  const r = await identificarClienteParaCamila({ cpf: '123.456.789-01', nome: 'Maria Erocleide', contactId: 'ctt1', telefone: '5583999990000' }, banco);
  assert.equal(r.encontrado, true);
  assert.equal(r.vinculoGravado, true);
  assert.deepEqual(banco.updates[0], ['c1234567-x', 'ctt1', '5583999990000']);
  assert.match(r.texto, /com o juiz para a sentença/);

  const errado = await identificarClienteParaCamila({ cpf: '12345678901', nome: 'Joana Silva' }, banco);
  assert.equal(errado.encontrado, false);
  assert.equal((await identificarClienteParaCamila({ cpf: '123', nome: 'Maria Erocleide' }, banco)).motivo, 'cpf_invalido');
});

test('pula o mais antigo quando já está arquivado ou com a execução extinta', async () => {
  const p1 = proc({ id: 'antigo', numero: '0802266-07.2024.8.15.2001' });
  const p2 = proc({ id: 'novo', numero: '0818548-52.2026.8.15.2001' });
  const movs = { antigo: [mov('2025-07-31', 'Extinção da execução ou do cumprimento da sentença')], novo: [mov('2026-10-20', 'Conclusos para julgamento')] };
  const banco = { async query(sql, params) {
    if (/FROM processos/.test(sql)) return [p2, p1];
    if (/FROM movimentacoes/.test(sql)) return movs[params[0]];
    return [];
  } };
  const { consultaParaCliente } = await import('./consultaProcessualCamila.js');
  const r = await consultaParaCliente({ id: 'c', nome: 'ELIZETE' }, null, banco);
  assert.equal(r.numero, '0818548-52.2026.8.15.2001');
  assert.equal(r.encaminhar, false);
  assert.doesNotMatch(r.texto, /outro processo/);
  // indicado pelo cliente, vale o indicado mesmo encerrado (vai para a equipe)
  const r2 = await consultaParaCliente({ id: 'c', nome: 'ELIZETE' }, '0802266-07', banco);
  assert.equal(r2.motivo, 'execucao_extinta');
});

test('consulta pelo contato do Digisac', async () => {
  const banco = bancoFalso({ cliente: { id: 'c1', nome: 'ELIZETE MARTINS', digisac_contact_id: 'a87e' },
    processos: [proc()], movs: [mov('2026-06-01', 'Expedição de precatório/rpv')] });
  const r = await consultarProcessoParaCamila({ contactId: 'a87e' }, banco);
  assert.equal(r.encontrado, true);
  assert.equal(r.encaminhar, true);
  assert.equal(r.motivo, 'pagamento');
  assert.equal(r.texto, undefined);
  assert.equal((await consultarProcessoParaCamila({ contactId: 'outro' }, banco)).encontrado, false);
});
