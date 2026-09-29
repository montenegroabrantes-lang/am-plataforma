import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/index.js';
import { item, HOJE } from './fixturesTeste.js';
import { avaliarCiclo, hashVerificacao, situacaoConfirmacao } from './verificacao.js';
import {
  resolverPeriodoPedido, montarRelatorio, relatorioEmTexto, reservarPacotes, montarPacote, cancelarPacote, cadastrarModelo, SQL_MODELOS,
} from './pacote.js';
import { montarChecklist } from './checklist.js';
import { calcularValorCausa } from './valorCausa.js';

for (const metodo of ['query', 'queryOne', 'execute']) {
  db[metodo] = async () => { throw new Error('banco real proibido nos testes'); };
}

const AGORA = new Date('2026-09-28T15:00:00Z');
const OFICIAL = { status: 'encontrado', correspondencia: 'unica', risco: 8000, periodo_consultado: { inicio: '2021-10', fim: '2026-09' }, vinculos: [{ regime: 'TEMPORARIO', ultima_paga: '2026-08', sem_pgto_meses: 1 }] };
const PASTA = { status: 'unica', drive_pasta_id: 'pasta-1', titulo: 'MARIA X PB', pai: 'Outorgantes 2024', duplicidade: [], documentos: { identidade: { qtd: 1, ultima: '2024-03-01' }, inicial: { qtd: 1, ultima: '2024-05-01' } } };

// Resultado de verificarCiclos com confirmação válida (ou não).
function resultado({ confirmada = true, extra, oficial = OFICIAL, pasta = PASTA } = {}) {
  const it = item(extra);
  const av = avaliarCiclo(it, { oficial, pasta });
  const hash = hashVerificacao(it, av, { oficial, pasta });
  const salva = confirmada ? { decisao: 'confirmada', snapshot_hash: hash, decidido_em: '2026-09-27T12:00:00Z', decidido_por: 'm1', motivos_aceitos: [] } : null;
  return { item: it, ...av, hash, pasta, oficial, salva, confirmacao: situacaoConfirmacao({ ...av, hash }, salva, AGORA) };
}

// ── período pedido ──

test('período pedido: por padrão o do ciclo; pode começar depois; nunca antes do ciclo nem depois do fim', () => {
  const it = item({ ciclo_inicio: '2020-01-01' }); // 81 meses; janela de 60 começa em 2021-10
  const total = resolverPeriodoPedido(it);
  assert.deepEqual([total.inicio, total.fim, total.meses, total.meses_acima_5_anos], ['2020-01-01', '2026-09-01', 81, 21]);
  const limitado = resolverPeriodoPedido(it, '2021-10');
  assert.deepEqual([limitado.inicio, limitado.meses, limitado.meses_acima_5_anos], ['2021-10-01', 60, 0]);
  assert.equal(resolverPeriodoPedido(it, '2019-12').ok, false);
  assert.equal(resolverPeriodoPedido(it, '2026-10').ok, false);
  assert.equal(resolverPeriodoPedido(it, 'lixo').ok, false);
});

// ── relatório ──

test('relatório: pendências de modelos e do valor; texto com o essencial; juízo não herdado', () => {
  const r = resultado();
  const periodo = resolverPeriodoPedido(r.item);
  const rel = montarRelatorio({ item: r.item, resultado: r, periodo, valor: calcularValorCausa({ tese: 'FGTS', oficial: OFICIAL, salarioMinimo: null }), checklist: montarChecklist({ documentos: PASTA.documentos, fonteOficial: 'PB' }), modelos: {} });
  assert.equal(rel.pronto_para_gerar_pecas, false);
  assert.ok(rel.pendencias.some(p => /Modelo aprovado de inicial/.test(p)));
  assert.ok(rel.pendencias.some(p => /procuração/.test(p)));
  assert.equal(rel.valor_da_causa.valor, 8000);
  assert.equal(rel.decisao_humana.confirmado_em, '2026-09-27T12:00:00.000Z');
  const texto = relatorioEmTexto(rel);
  assert.match(texto, /MARIA DA SILVA/);
  assert.match(texto, /R\$\s?8\.000,00/);
  assert.match(texto, /o juízo não é herdado/);
  const completo = montarRelatorio({ item: r.item, resultado: r, periodo, valor: calcularValorCausa({ tese: 'FGTS', oficial: OFICIAL, salarioMinimo: null }), checklist: montarChecklist({ documentos: PASTA.documentos }), modelos: { inicial: { titulo: 'I' }, procuracao: { titulo: 'P' } } });
  assert.equal(completo.pronto_para_gerar_pecas, true);
});

// ── reservar ──

function conexaoReserva() {
  const ativos = new Set();
  return {
    ativos,
    async queryOne(sql, params) {
      assert.match(sql, /INSERT INTO pacotes_reprotocolo/);
      if (ativos.has(params[0])) return null; // índice único: já existe pacote ativo
      ativos.add(params[0]); return { id: `pac-${params[0]}` };
    },
  };
}

test('reservar: só com confirmação válida; segunda reserva da mesma tarefa é recusada', async () => {
  const conexao = conexaoReserva();
  const ok = resultado(); ok.item.tarefa_id = 't-ok';
  const semConf = resultado({ confirmada: false }); semConf.item.tarefa_id = 't-sem';
  const verificar = async ({ ids }) => ({ resultados: [ok, semConf].filter(r => ids.includes(r.item.tarefa_id)) });
  const r1 = await reservarPacotes({ conexao, usuarioId: 'm1', tarefaIds: ['t-ok', 't-sem', 't-nao'], verificar });
  assert.deepEqual(r1.map(x => [x.tarefa_id, x.ok]), [['t-ok', true], ['t-sem', false], ['t-nao', false]]);
  assert.match(r1[1].erro, /confirmação/);
  const r2 = await reservarPacotes({ conexao, usuarioId: 'm1', tarefaIds: ['t-ok'], verificar });
  assert.equal(r2[0].ok, false);
  assert.match(r2[0].erro, /Já existe pacote ativo/);
});

// ── montar ──

function conexaoMontagem({ pacote = { id: 'pac-1', tarefa_id: 't-1', status: 'reservado' }, modelos = [] } = {}) {
  const updates = [];
  return {
    updates,
    async queryOne(sql) { assert.match(sql, /FROM pacotes_reprotocolo WHERE id = \$1 FOR UPDATE/); return pacote; },
    async query(sql) { assert.equal(sql, SQL_MODELOS); return modelos; },
    async execute(sql, params) { assert.match(sql, /UPDATE pacotes_reprotocolo SET status = 'montado'/); updates.push(params); return { rowCount: 1 }; },
  };
}

test('montar: grava o relatório e o período; modelos cadastrados entram no relatório', async () => {
  const conexao = conexaoMontagem({ modelos: [{ tipo: 'inicial', titulo: 'Inicial FGTS PB', drive_arquivo_id: 'arq-1', tese_id: null }] });
  const verificar = async () => ({ resultados: [resultado()] });
  const r = await montarPacote({ conexao, pacoteId: 'pac-1', usuarioId: 'm1', verificar, agora: AGORA });
  assert.equal(r.ok, true);
  assert.equal(r.relatorio.modelos.inicial.titulo, 'Inicial FGTS PB');
  assert.equal(r.relatorio.modelos.procuracao, null);
  const [inicio, fim, meses, valor, exige] = conexao.updates[0];
  assert.deepEqual([inicio, fim, meses, valor, exige], ['2024-01-01', '2026-09-01', 33, 8000, false]);
  assert.match(r.texto, /Pendências para gerar as peças/);
});

test('montar: pacote inexistente 404, cancelado 409, confirmação vencida 409, período inválido 400', async () => {
  const verificar = async () => ({ resultados: [resultado()] });
  assert.equal((await montarPacote({ conexao: conexaoMontagem({ pacote: null }), pacoteId: 'x', verificar, agora: AGORA })).status, 404);
  assert.equal((await montarPacote({ conexao: conexaoMontagem({ pacote: { id: 'p', tarefa_id: 't-1', status: 'cancelado' } }), pacoteId: 'p', verificar, agora: AGORA })).status, 409);
  const vencida = async () => ({ resultados: [resultado({ confirmada: false })] });
  const r = await montarPacote({ conexao: conexaoMontagem(), pacoteId: 'p', verificar: vencida, agora: AGORA });
  assert.equal(r.status, 409);
  assert.match(r.erro, /perdeu a validade/);
  const semCiclo = async () => ({ resultados: [] });
  assert.equal((await montarPacote({ conexao: conexaoMontagem(), pacoteId: 'p', verificar: semCiclo, agora: AGORA })).status, 409);
  const invalido = await montarPacote({ conexao: conexaoMontagem(), pacoteId: 'p', verificar, periodoInicioPedido: '2019-01', agora: AGORA });
  assert.equal(invalido.status, 400);
});

test('cancelar e cadastrar modelo: SQL e parâmetros', async () => {
  const chamadas = [];
  const conexao = { async execute(sql, params) { chamadas.push([sql, params]); return { rowCount: sql.startsWith('UPDATE pacotes') ? 1 : 0 }; } };
  assert.equal(await cancelarPacote({ conexao, pacoteId: 'p', usuarioId: 'm1', motivo: 'Duplicado' }), true);
  await cadastrarModelo({ conexao, ente: 'Estado da Paraíba', tipo: 'inicial', titulo: 'I', driveId: 'arq-12345678', usuarioId: 'm1' });
  assert.match(chamadas[1][0], /UPDATE modelos_reprotocolo SET ativo = false/);
  assert.match(chamadas[2][0], /INSERT INTO modelos_reprotocolo/);
  await assert.rejects(cadastrarModelo({ conexao, ente: 'X', tipo: 'invalido', driveId: 'a', usuarioId: 'm1' }));
});
