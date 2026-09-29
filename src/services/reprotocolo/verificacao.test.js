import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/index.js';
import { montarItem, sqlItens, SQL_HOJE, SQL_ADIADOS, SQL_DOCUMENTOS, SECAO_AGUARDANDO } from './levantamento.js';
import {
  avaliarCiclo, palavrasDeTese, hashVerificacao, situacaoConfirmacao, verificarCiclos, confirmarCiclos, semConfirmacaoValida,
  totaisPorGrupo, GRUPO, VALIDADE_CONFIRMACAO_DIAS,
  SQL_PUBLICACOES_DESCONHECIDAS, SQL_PASTAS, SQL_OFICIAL, SQL_ULTIMAS,
} from './verificacao.js';

// Guarda: nada aqui toca o banco real.
for (const metodo of ['query', 'queryOne', 'execute']) {
  db[metodo] = async () => { throw new Error('banco real proibido nos testes'); };
}

const HOJE = '2026-09-28';
const AGORA = new Date('2026-09-28T15:00:00Z');

function linha(extra = {}) {
  return {
    tarefa_id: 't-1', secao: SECAO_AGUARDANDO, subtipo: 'ciclo', ciclo_inicio: '2024-01-01', ciclo_adiado_ate: null,
    cliente_id: 'c-1', cliente_nome: 'MARIA DA SILVA', cliente_cpf: '12345678901', cliente_ativo: true, cliente_vinculo_ativo: true,
    cliente_vinculo_fim: null, cliente_cargo: 'PROFESSOR', cliente_orgao: 'SECRETARIA DE EDUCACAO', tem_pasta_drive: true,
    produto_id: 'p-fgts', produto_nome: 'FGTS', intervalo_meses: 25, documentos_exigidos: null,
    polo_passivo: 'Estado da Paraíba', polo_processo: null, polo_vinculo_unico: 'Estado da Paraíba', polo_cliente: 'Estado da Paraíba',
    polo_padrao_tese: null, padrao_tese_opcoes: 0, qtd_vinculos_ativos: 1, qtd_vinculos: 1, vinculos_ativos: [], vinculo_tarefa_id: null,
    anterior_id: 'proc-1', anterior_numero: '0800000-00.2022.8.15.2001', anterior_periodo_fim: '2023-12-01', anterior_status: 'ativo',
    anterior_vara: '1º Juizado Especial da Fazenda Pública da Capital', anterior_tribunal: 'TJPB', anterior_comarca: null,
    anterior_grau: '1', anterior_visibilidade: 'normal', cobrindo_qtd: 0, cobrindo_lista: [], processos_mesma_tese: 1,
    resp_proc_id: 'u1', resp_proc_nome: 'João', resp_proc_ativo: true, ...extra,
  };
}
const item = (extra, hoje = HOJE) => montarItem(linha(extra), { hoje });

const OFICIAL_OK = { status: 'encontrado', correspondencia: 'unica', vinculos: [{ regime: 'TEMPORARIO', ultima_paga: '2026-08', sem_pgto_meses: 1 }] };
const PASTA_OK = { status: 'unica', drive_pasta_id: 'pasta-1', titulo: 'MARIA DA SILVA X PB', pai: 'Outorgantes 2024', duplicidade: [] };
const codigos = (a) => [...a.bloqueios, ...a.conferir].map(m => m.codigo);

// ── regras ──

test('ciclo vencido, sem alertas, com fonte oficial e pasta única → confirmado', () => {
  const a = avaliarCiclo(item(), { oficial: OFICIAL_OK, pasta: PASTA_OK });
  assert.equal(a.grupo, GRUPO.CONFIRMADO);
  assert.deepEqual(codigos(a), []);
});

test('juízo de gabinete/núcleo do processo anterior NÃO gera alerta (re-protocolo é processo novo)', () => {
  const it = item({ anterior_vara: 'Gabinete do Desembargador X' });
  assert.ok(it.flags.includes('juizo_nao_e_de_origem'));
  assert.equal(avaliarCiclo(it, { oficial: OFICIAL_OK, pasta: PASTA_OK }).grupo, GRUPO.CONFIRMADO);
});

test('intervalo da tese incompleto → bloqueado com a data de vencimento', () => {
  const a = avaliarCiclo(item({ ciclo_inicio: '2026-01-01' }), { pasta: PASTA_OK });
  assert.equal(a.grupo, GRUPO.BLOQUEADO);
  assert.deepEqual(a.bloqueios.map(m => m.codigo), ['intervalo_incompleto']);
  assert.match(a.bloqueios[0].texto, /vence/);
});

test('processo cobrindo o período → bloqueado', () => {
  const a = avaliarCiclo(item({ cobrindo_qtd: 1, cobrindo_lista: [{ numero: '0801111-11.2026.8.15.2001' }] }), { oficial: OFICIAL_OK, pasta: PASTA_OK });
  assert.equal(a.grupo, GRUPO.BLOQUEADO);
  assert.ok(codigos(a).includes('processo_cobrindo_periodo'));
});

test('pasta da equipe (protocolo à mão): a tese da pasta decide; nome parecido só manda conferir', () => {
  const ctx = (duplicidade) => ({ oficial: OFICIAL_OK, pasta: { ...PASTA_OK, duplicidade } });
  const onda = { pasta: 'MARIA DA SILVA X PB', pai: '_REPROTOCOLO - 2026', criada: '2026-08-10', exato: true, teses: [], onda_fgts: true };
  assert.equal(avaliarCiclo(item(), ctx([onda])).grupo, GRUPO.BLOQUEADO);
  // pasta de outra tese no título não indica duplicidade de FGTS
  const outraTese = { ...onda, pai: 'Outorgantes 2026', pasta: 'MARIA DA SILVA X EMLUR (INSALUBRIDADE)', teses: ['INSALUBRIDADE'], onda_fgts: false };
  assert.equal(avaliarCiclo(item(), ctx([outraTese])).grupo, GRUPO.CONFIRMADO);
  // mesma tese explícita no título → bloqueia
  assert.equal(avaliarCiclo(item(), ctx([{ ...outraTese, teses: ['FGTS'] }])).grupo, GRUPO.BLOQUEADO);
  // recente sem tese no nome e fora da onda de re-protocolo → só conferir
  const semTese = { ...outraTese, pasta: 'MARIA DA SILVA X PB', teses: [] };
  assert.deepEqual(codigos(avaliarCiclo(item(), ctx([semTese]))), ['pasta_recente_sem_tese']);
  // tese diferente da tarefa (Insalubridade) com pasta da onda de FGTS: não é duplicidade dela
  assert.equal(avaliarCiclo(item({ produto_nome: 'INSALUBRIDADE' }), ctx([onda])).bloqueios.length, 0);
  // nome parecido (não exato) → conferir
  const parecida = { ...onda, exato: false, pasta: 'MARIA DA SILVA SOUZA' };
  const a = avaliarCiclo(item(), ctx([parecida]));
  assert.equal(a.grupo, GRUPO.CONFERIR);
  assert.deepEqual(codigos(a), ['pasta_reprotocolo_parecida']);
  // ainda não vencido: a duplicidade não é avaliada (o bloqueio por prazo já vale)
  assert.deepEqual(codigos(avaliarCiclo(item({ ciclo_inicio: '2026-01-01' }), { pasta: { ...PASTA_OK, duplicidade: [onda] } })), ['intervalo_incompleto']);
});

test('pasta do ano do processo anterior (Outorgantes {ano}) é o ajuizamento anterior, não duplicidade', () => {
  // processo anterior de 2022 → a pasta "Outorgantes 2022" é a dele
  const propria = { pasta: 'MARIA DA SILVA X PB - FGTS', pai: 'Outorgantes 2022', criada: '2022-05-01', exato: true, teses: ['FGTS'], onda_fgts: false };
  assert.equal(avaliarCiclo(item(), { oficial: OFICIAL_OK, pasta: { ...PASTA_OK, duplicidade: [propria] } }).grupo, GRUPO.CONFIRMADO);
  // pasta de outro ano, com a tese, continua sendo suspeita
  assert.equal(avaliarCiclo(item(), { oficial: OFICIAL_OK, pasta: { ...PASTA_OK, duplicidade: [{ ...propria, pai: 'Outorgantes 2026' }] } }).grupo, GRUPO.BLOQUEADO);
});

test('palavrasDeTese reconhece as teses pelo nome, com ou sem acento', () => {
  assert.deepEqual(palavrasDeTese('FGTS'), ['FGTS']);
  assert.deepEqual(palavrasDeTese('FÉRIAS 30 DIAS'), ['FERIAS']);
  assert.deepEqual(palavrasDeTese('MARIA X EMLUR (INSALUBRIDADE)'), ['INSALUBRIDADE']);
  assert.deepEqual(palavrasDeTese('30% NOTURNO'), ['NOTURNO']);
  assert.deepEqual(palavrasDeTese('MARIA DA SILVA X PB - PROF'), []);
});

test('pasta antiga: sem registro, não encontrada e ambígua mandam conferir', () => {
  const base = { oficial: OFICIAL_OK };
  assert.deepEqual(codigos(avaliarCiclo(item(), { ...base, pasta: null })), ['pasta_nao_verificada']);
  assert.deepEqual(codigos(avaliarCiclo(item(), { ...base, pasta: { status: 'nao_encontrada' } })), ['pasta_nao_encontrada']);
  assert.deepEqual(codigos(avaliarCiclo(item(), { ...base, pasta: { status: 'ambigua' } })), ['pasta_ambigua']);
});

test('fonte oficial: pendente, sem vínculo, homônimos, último pagamento antigo e regime diferente', () => {
  const it = item();
  const cod = (oficial) => codigos(avaliarCiclo(it, { oficial, pasta: PASTA_OK }));
  assert.deepEqual(cod(null), ['oficial_pendente']);
  assert.deepEqual(cod({ status: 'erro' }), ['oficial_indisponivel']);
  assert.deepEqual(cod({ status: 'nao_encontrado', vinculos: [] }), ['oficial_sem_vinculo']);
  assert.deepEqual(cod({ status: 'encontrado', correspondencia: 'ambigua', vinculos: [{}, {}] }), ['oficial_homonimos']);
  assert.deepEqual(cod({ status: 'encontrado', correspondencia: 'unica', vinculos: [{ regime: 'TEMPORARIO', ultima_paga: '2025-11', sem_pgto_meses: 10 }] }), ['oficial_ultimo_pagamento_antigo']);
  assert.deepEqual(cod({ status: 'encontrado', correspondencia: 'unica', vinculos: [{ regime: 'ESTATUTARIO', ultima_paga: '2026-08', sem_pgto_meses: 1 }] }), ['oficial_regime']);
});

test('sem fonte oficial (município) ou ente inferido: não exige conferência oficial mas manda conferir o ente inferido', () => {
  const mun = item({ polo_passivo: 'Município de João Pessoa', polo_vinculo_unico: 'Município de João Pessoa', polo_cliente: 'Município de João Pessoa' });
  assert.equal(avaliarCiclo(mun, { pasta: PASTA_OK }).grupo, GRUPO.CONFIRMADO);
});

test('períodos com mais de 5 anos, sem processo anterior e cadastro contraditório mandam conferir', () => {
  const antigo = avaliarCiclo(item({ ciclo_inicio: '2020-01-01' }), { oficial: OFICIAL_OK, pasta: PASTA_OK });
  assert.ok(codigos(antigo).includes('meses_acima_5_anos'));
  const contraditorio = avaliarCiclo(item({ cliente_vinculo_fim: '2023-01-01' }), { oficial: OFICIAL_OK, pasta: PASTA_OK });
  assert.ok(contraditorio.conferir.length > 0);
  assert.equal(contraditorio.grupo, GRUPO.CONFERIR);
});

test('publicação de processo desconhecido cita o cliente → conferir (só se vencido)', () => {
  const pubs = [{ numero_processo: '0821301-50.2024.8.15.2001' }];
  assert.ok(codigos(avaliarCiclo(item(), { oficial: OFICIAL_OK, pasta: PASTA_OK, publicacoes: pubs })).includes('publicacao_desconhecida'));
  assert.ok(!codigos(avaliarCiclo(item({ ciclo_inicio: '2026-01-01' }), { pasta: PASTA_OK, publicacoes: pubs })).includes('publicacao_desconhecida'));
});

// ── hash ──

test('hash: estável na virada do mês (fim do período muda), muda quando a pasta ou a fonte oficial mudam', () => {
  const ctx = { oficial: OFICIAL_OK, pasta: PASTA_OK };
  const h = (it, c = ctx) => hashVerificacao(it, avaliarCiclo(it, c), c);
  assert.equal(h(item({}, '2026-09-28')), h(item({}, '2026-10-05')));
  assert.notEqual(h(item()), h(item(), { ...ctx, pasta: { ...PASTA_OK, drive_pasta_id: 'outra' } }));
  assert.notEqual(h(item()), h(item(), { ...ctx, oficial: { ...OFICIAL_OK, vinculos: [{ ...OFICIAL_OK.vinculos[0], ultima_paga: '2026-05' }] } }));
  assert.notEqual(h(item()), h(item({ ciclo_inicio: '2024-02-01' })));
});

// ── validade da confirmação ──

const atualOk = { grupo: GRUPO.CONFIRMADO, hash: 'h1', bloqueios: [], conferir: [] };
const salvaOk = (extra = {}) => ({ decisao: 'confirmada', snapshot_hash: 'h1', decidido_em: '2026-09-20T12:00:00Z', decidido_por: 'u1', motivos_aceitos: [], ...extra });

test('confirmação válida: mesma hash, dentro de 30 dias', () => {
  const s = situacaoConfirmacao(atualOk, salvaOk(), AGORA);
  assert.equal(s.confirmada, true);
  assert.equal(new Date(s.valida_ate).toISOString(), '2026-10-20T12:00:00.000Z');
});

test('confirmação perde a validade: sem decisão, dados mudaram, expirada, bloqueio novo, motivo novo', () => {
  assert.equal(situacaoConfirmacao(atualOk, null, AGORA).motivo, 'sem_decisao');
  assert.equal(situacaoConfirmacao(atualOk, salvaOk({ snapshot_hash: 'h0' }), AGORA).motivo, 'dados_mudaram');
  const velha = new Date(AGORA.getTime() - (VALIDADE_CONFIRMACAO_DIAS + 1) * 86_400_000).toISOString();
  assert.equal(situacaoConfirmacao(atualOk, salvaOk({ decidido_em: velha }), AGORA).motivo, 'expirada');
  const bloq = { ...atualOk, grupo: GRUPO.BLOQUEADO, bloqueios: [{ codigo: 'intervalo_incompleto', texto: 'x' }] };
  assert.equal(situacaoConfirmacao(bloq, salvaOk(), AGORA).motivo, 'bloqueada');
  const conf = { ...atualOk, grupo: GRUPO.CONFERIR, conferir: [{ codigo: 'pasta_ambigua', texto: 'x' }] };
  assert.equal(situacaoConfirmacao(conf, salvaOk(), AGORA).motivo, 'motivos_nao_aceitos');
  assert.equal(situacaoConfirmacao(conf, salvaOk({ motivos_aceitos: ['pasta_ambigua'] }), AGORA).confirmada, true);
});

test('bloqueio liberável (protocolo à mão) pode ser confirmado com o motivo aceito', () => {
  const at = { ...atualOk, grupo: GRUPO.BLOQUEADO, bloqueios: [{ codigo: 'protocolo_a_mao', texto: 'x' }] };
  assert.equal(situacaoConfirmacao(at, salvaOk({ motivos_aceitos: ['protocolo_a_mao'] }), AGORA).confirmada, true);
});

// ── fluxo com banco simulado ──

function bancoSimulado({ linhas, oficiais = [], pastas = [], pubs = [] }) {
  const verificacoes = []; // linhas de verificacoes_reprotocolo
  let seq = 0;
  const conexao = {
    verificacoes,
    async queryOne(sql, params) {
      if (sql === SQL_HOJE) return { hoje: HOJE };
      if (sql === SQL_ADIADOS) return { adiados: 0 };
      if (sql.startsWith('SELECT demanda_id FROM tarefas')) return { demanda_id: null };
      if (sql.includes('INSERT INTO verificacoes_reprotocolo')) {
        const l = { id: `v-${++seq}`, tarefa_id: params[0], grupo: params[2], snapshot_hash: params[5], decisao: null, decidido_por: null, decidido_em: null, motivos_aceitos: [], observacao: null, verificado_em: new Date().toISOString() };
        verificacoes.push(l); return { id: l.id };
      }
      throw new Error(`queryOne inesperada: ${sql.slice(0, 60)}`);
    },
    async query(sql, params) {
      if (sql === sqlItens() || sql === sqlItens({ porTarefa: true })) return linhas;
      if (sql === SQL_DOCUMENTOS) return [];
      if (sql === SQL_PUBLICACOES_DESCONHECIDAS) return pubs;
      if (sql === SQL_PASTAS) return pastas;
      if (sql === SQL_OFICIAL) return oficiais;
      if (sql === SQL_ULTIMAS) {
        const ult = new Map();
        for (const v of verificacoes) if (params[0].includes(v.tarefa_id)) ult.set(v.tarefa_id, v);
        return [...ult.values()];
      }
      throw new Error(`query inesperada: ${sql.slice(0, 60)}`);
    },
    async execute(sql, params) {
      if (sql.startsWith('UPDATE verificacoes_reprotocolo SET decisao')) {
        const v = verificacoes.find(x => x.id === params[3]);
        Object.assign(v, { decisao: 'confirmada', decidido_por: params[0], decidido_em: new Date().toISOString(), motivos_aceitos: JSON.parse(params[1]), observacao: params[2] });
        return { rowCount: 1 };
      }
      throw new Error(`execute inesperado: ${sql.slice(0, 60)}`);
    },
  };
  return conexao;
}

const ctxBanco = () => ({
  linhas: [linha()],
  oficiais: [{ tarefa_id: 't-1', resultado: OFICIAL_OK }],
  pastas: [{ cliente_id: 'c-1', ...PASTA_OK }],
});

test('fluxo: verificar → confirmar grupo confirmado → confirmação válida; mudar a pasta invalida', async () => {
  const banco = bancoSimulado(ctxBanco());
  let { resultados } = await verificarCiclos({ conexao: banco, agora: AGORA });
  assert.equal(resultados[0].grupo, GRUPO.CONFIRMADO);
  assert.deepEqual(totaisPorGrupo(resultados), { confirmado: 1, conferir: 0, bloqueado: 0, confirmadas_validas: 0, total: 1 });
  assert.deepEqual(await semConfirmacaoValida(['t-1'], { conexao: banco, agora: AGORA }), ['t-1']);

  const r = await confirmarCiclos({ conexao: banco, usuarioId: 'm1', pedidos: [{ tarefaId: 't-1', motivosAceitos: [] }], agora: AGORA });
  assert.deepEqual(r, [{ tarefa_id: 't-1', ok: true }]);
  assert.deepEqual(await semConfirmacaoValida(['t-1'], { conexao: banco, agora: AGORA }), []);
  assert.equal(banco.verificacoes.length, 1);

  // a pasta antiga trocou → o hash muda e a confirmação deixa de valer
  const outraPasta = bancoSimulado({ ...ctxBanco(), pastas: [{ cliente_id: 'c-1', ...PASTA_OK, drive_pasta_id: 'pasta-2' }] });
  outraPasta.verificacoes.push(...banco.verificacoes);
  assert.deepEqual(await semConfirmacaoValida(['t-1'], { conexao: outraPasta, agora: AGORA }), ['t-1']);
});

test('fluxo: conferir exige aceitar todos os motivos e observação; bloqueio por prazo nunca é confirmado', async () => {
  const banco = bancoSimulado({ ...ctxBanco(), pastas: [{ cliente_id: 'c-1', status: 'ambigua' }] });
  const semAceite = await confirmarCiclos({ conexao: banco, usuarioId: 'm1', pedidos: [{ tarefaId: 't-1', motivosAceitos: [] }], agora: AGORA });
  assert.equal(semAceite[0].ok, false);
  assert.deepEqual(semAceite[0].pendentes, ['pasta_ambigua']);
  const semObs = await confirmarCiclos({ conexao: banco, usuarioId: 'm1', pedidos: [{ tarefaId: 't-1', motivosAceitos: ['pasta_ambigua'] }], agora: AGORA });
  assert.match(semObs[0].erro, /observação/);
  const ok = await confirmarCiclos({ conexao: banco, usuarioId: 'm1', pedidos: [{ tarefaId: 't-1', motivosAceitos: ['pasta_ambigua'] }], observacao: 'Pasta conferida com a equipe', agora: AGORA });
  assert.equal(ok[0].ok, true);

  const prazo = bancoSimulado({ ...ctxBanco(), linhas: [linha({ ciclo_inicio: '2026-01-01' })] });
  const bloq = await confirmarCiclos({ conexao: prazo, usuarioId: 'm1', pedidos: [{ tarefaId: 't-1', motivosAceitos: ['intervalo_incompleto'] }], observacao: 'tentativa', agora: AGORA });
  assert.equal(bloq[0].ok, false);
  assert.match(bloq[0].erro, /Bloqueado/);
  assert.equal(prazo.verificacoes.length, 0);
});

test('fluxo: tarefa inexistente nas filas é recusada', async () => {
  const banco = bancoSimulado(ctxBanco());
  const r = await confirmarCiclos({ conexao: banco, usuarioId: 'm1', pedidos: [{ tarefaId: 'nao-existe', motivosAceitos: [] }], agora: AGORA });
  assert.equal(r[0].ok, false);
});
