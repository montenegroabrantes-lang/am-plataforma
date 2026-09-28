import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/index.js';
import { ReferenciaEstadualError } from '../remuneracaoEstadual.js';
import { conferirVinculoOficial, orgaoParaConsulta, resumirVinculoOficial } from './vinculoOficial.js';
import { SECAO_AGUARDANDO } from './levantamento.js';

// Guarda: banco simulado; qualquer uso acidental do pool real falha na hora.
for (const metodo of ['query', 'queryOne', 'execute']) {
  db[metodo] = async () => { throw new Error('banco real proibido nos testes'); };
}

const HOJE = '2026-09-28';

function linha(extra = {}) {
  return {
    tarefa_id: 't-1', secao: SECAO_AGUARDANDO, ciclo_inicio: '2024-06-01', prazo_data: null,
    cliente_id: 'c-1', cliente_nome: 'LUCAS BENJAMIN POTIGUARA', cliente_cpf: '52998224725',
    cliente_ativo: true, cliente_vinculo_ativo: true, cliente_vinculo_fim: null,
    cliente_cargo: 'PROFESSOR', cliente_orgao: 'SECRETARIA DE EDUCACAO', tem_pasta_drive: true,
    produto_id: 'p', produto_nome: 'FGTS', intervalo_meses: 25, documentos_exigidos: null,
    polo_passivo: 'Estado da Paraíba', polo_processo: null, polo_vinculo_unico: 'Estado da Paraíba',
    polo_cliente: null, polo_padrao_tese: null, padrao_tese_opcoes: 0,
    qtd_vinculos_ativos: 1, qtd_vinculos: 1,
    vinculos_ativos: [{ id: 'v', cargo: 'PROFESSOR', orgao: 'SECRETARIA DE EDUCACAO', polo_passivo: 'Estado da Paraíba' }],
    anterior_id: 'x', anterior_numero: '0800000-00.2024.8.15.2001', anterior_periodo_fim: '2024-05-01',
    anterior_status: 'ativo', anterior_vara: '2º Juizado', anterior_tribunal: 'TJPB', anterior_grau: '1',
    anterior_visibilidade: 'normal', cobrindo_qtd: 0, cobrindo_lista: [], processos_mesma_tese: 1,
    resp_proc_id: 'u', resp_proc_nome: 'João', resp_proc_ativo: true,
    ...extra,
  };
}

function banco(linhas) {
  return {
    async queryOne() { return { hoje: HOJE }; },
    async query(_sql, params) { return linhas.filter(l => l.tarefa_id === params[0]); },
    async execute() { throw new Error('escrita proibida'); },
  };
}

function buscarFalso(resposta, registro = []) {
  return async (args) => { registro.push(args); if (resposta instanceof Error) throw resposta; return resposta; };
}

const RESPOSTA_PB = {
  ok: true, status: 'encontrado', uf: 'PB',
  fonte_nome: 'Portal de Dados Abertos da Paraíba', fonte_url: 'https://dados.pb.gov.br/dataset/remuneracao-servidores',
  periodo_consultado: { inicio: '06/2024', fim: '09/2026', competencias: 28, respondidas: 28, falhas: 0 },
  vinculos: [{
    matricula: '123', nome: 'LUCAS BENJAMIN POTIGUARA', cargo: 'PROFESSOR', orgao: 'SECRETARIA DE EDUCACAO',
    regime: 'CONTRATO TEMPORARIO', admissao: '01/02/2020', mesesInicio: '06/2024', mesesFim: '07/2026',
    competencias_localizadas: 3, total_remuneracao_oficial: 9000, total_vantagens_oficial: 0,
    referencia_fgts_8pct: 720, compatibilidade: 1,
    competencias: [
      { competencia: '06/2024', remuneracao: 3000, total_vantagens: 0 },
      { competencia: '06/2026', remuneracao: 6000, total_vantagens: 0 },
      { competencia: '07/2026', remuneracao: 0, total_vantagens: 0 },
    ],
  }],
  aviso: 'Referência oficial para conferência humana. Não constitui cálculo jurídico nem aprovação automática.',
};

test('PB: consulta a fonte oficial com o período do levantamento e resume o vínculo encontrado', async () => {
  const chamadas = [];
  const r = await conferirVinculoOficial('t-1', { conexao: banco([linha()]), buscar: buscarFalso(RESPOSTA_PB, chamadas) });
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].nome, 'LUCAS BENJAMIN POTIGUARA');
  assert.equal(chamadas[0].inicio, '2024-06');
  assert.equal(chamadas[0].fim, '2026-09');
  assert.equal(chamadas[0].cargo, 'PROFESSOR');
  assert.equal(chamadas[0].orgao, 'SECRETARIA DE EDUCACAO — Estado da Paraíba');
  assert.equal(chamadas[0].agora.toISOString().slice(0, 10), HOJE);

  assert.equal(r.status, 'encontrado');
  assert.equal(r.somente_leitura, true);
  const v = r.vinculos_encontrados[0];
  assert.equal(v.ultima_competencia, '07/2026');
  assert.equal(v.ultima_competencia_com_pagamento, '06/2026', 'mês com remuneração zero não conta como pagamento');
  assert.equal(v.meses_sem_pagamento_ate_o_fim_da_consulta, 3); // 06/2026 → 09/2026
  assert.equal(v.referencia_8pct, 720);
  assert.equal(v.regime, 'CONTRATO TEMPORARIO');
  assert.equal(r.valor_em_risco_referencia.referencia_8pct, 720);
  assert.equal('matricula' in v, false);
  assert.match(r.aviso, /homônimos/);
  assert.equal(JSON.stringify(r).includes('52998224725'), false);
  assert.equal(r.cliente.cpf_mascarado, '***.***.*47-25');
});

test('ente municipal ou sem polo: "sem fonte oficial integrada", sem chamar a API', async () => {
  const chamadas = [];
  const municipal = await conferirVinculoOficial('t-1', {
    conexao: banco([linha({ polo_passivo: 'Município de João Pessoa', polo_vinculo_unico: 'Município de João Pessoa' })]),
    buscar: buscarFalso(RESPOSTA_PB, chamadas),
  });
  assert.equal(municipal.status, 'sem_fonte_oficial');
  assert.match(municipal.mensagem, /Sem fonte oficial integrada para Município de João Pessoa/);

  const semPolo = await conferirVinculoOficial('t-1', {
    conexao: banco([linha({ polo_passivo: null, polo_vinculo_unico: null })]), buscar: buscarFalso(RESPOSTA_PB, chamadas),
  });
  assert.equal(semPolo.status, 'sem_fonte_oficial');
  assert.equal(chamadas.length, 0);
});

test('ente só do padrão da tese não é consultado; período sem meses ou todo acima de 5 anos também não', async () => {
  const chamadas = [];
  const buscar = buscarFalso(RESPOSTA_PB, chamadas);
  const daTese = await conferirVinculoOficial('t-1', {
    conexao: banco([linha({ polo_vinculo_unico: null, polo_padrao_tese: 'Estado da Paraíba', padrao_tese_opcoes: 11 })]), buscar,
  });
  assert.equal(daTese.status, 'ente_nao_confirmado');

  const futuro = await conferirVinculoOficial('t-1', { conexao: banco([linha({ ciclo_inicio: '2027-01-01' })]), buscar });
  assert.equal(futuro.status, 'periodo_sem_meses');

  const antigo = await conferirVinculoOficial('t-1', {
    conexao: banco([linha({ ciclo_inicio: '2012-01-01', cliente_vinculo_ativo: false, cliente_vinculo_fim: '2019-12-31' })]), buscar,
  });
  assert.equal(antigo.status, 'periodo_todo_acima_5_anos');
  assert.equal(chamadas.length, 0);
});

test('tarefa fora das filas → null (a rota responde 404)', async () => {
  assert.equal(await conferirVinculoOficial('outra', { conexao: banco([linha()]), buscar: buscarFalso(RESPOSTA_PB) }), null);
});

test('erros da fonte: 422 vira resposta de negócio; indisponibilidade (502) sobe para a rota', async () => {
  const nome = await conferirVinculoOficial('t-1', {
    conexao: banco([linha()]), buscar: buscarFalso(new ReferenciaEstadualError('Informe o nome completo para consultar a fonte oficial.')),
  });
  assert.equal(nome.status, 'nao_consultavel');

  await assert.rejects(
    conferirVinculoOficial('t-1', {
      conexao: banco([linha()]),
      buscar: buscarFalso(new ReferenciaEstadualError('fora do ar', 502, 'fonte_oficial_indisponivel')),
    }),
    err => err.status === 502,
  );
});

test('órgão da consulta: usa o do vínculo quando já identifica o estado; senão acrescenta o ente', () => {
  const pb = { fonte_oficial: 'PB', nome: 'Estado da Paraíba' };
  assert.equal(orgaoParaConsulta('Secretaria de Educação da Paraíba', pb), 'Secretaria de Educação da Paraíba');
  assert.equal(orgaoParaConsulta('SEE', pb), 'SEE — Estado da Paraíba');
  assert.equal(orgaoParaConsulta('', pb), 'Estado da Paraíba');
});

test('parcela que sai da janela de 5 anos em 12 meses usa só as competências mais antigas da janela', () => {
  const janelaIdx = 2021 * 12 + 9; // 10/2021
  const r = resumirVinculoOficial({
    competencias: [
      { competencia: '10/2021', remuneracao: 1000 }, { competencia: '09/2022', remuneracao: 1000 },
      { competencia: '10/2022', remuneracao: 5000 },
    ],
    referencia_fgts_8pct: 560,
  }, { janelaIdx, fimConsultaIdx: 2026 * 12 + 8 });
  assert.equal(r.referencia_8pct_saindo_da_janela_em_12_meses, 160); // 8% de (10/2021 + 09/2022)
});
