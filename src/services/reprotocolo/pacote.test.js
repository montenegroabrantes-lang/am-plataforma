import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/index.js';
import { item, HOJE } from './fixturesTeste.js';
import { avaliarCiclo, hashVerificacao, situacaoConfirmacao } from './verificacao.js';
import {
  resolverPeriodoPedido, montarRelatorio, relatorioEmTexto, reservarPacotes, montarPacote, cancelarPacote, cadastrarModelo, aprovarPacote,
  slugEnteAcervo, slugTeseAcervo, usuarioPodeAprovar, aprovadoresConfigurados, pacotesPorTarefas, SQL_MODELOS, SQL_MODELO_ACERVO,
} from './pacote.js';
import { montarChecklist } from './checklist.js';
import { calcularValorCausa } from './valorCausa.js';

for (const metodo of ['query', 'queryOne', 'execute']) {
  db[metodo] = async () => { throw new Error('banco real proibido nos testes'); };
}

const AGORA = new Date('2026-09-28T15:00:00Z');
const OFICIAL = { status: 'encontrado', correspondencia: 'unica', risco: 8000, periodo_consultado: { inicio: '2021-10', fim: '2026-09' }, vinculos: [{ regime: 'TEMPORARIO', ultima_paga: '2026-08', sem_pgto_meses: 1 }] };
const PASTA = { status: 'unica', drive_pasta_id: 'pasta-1', titulo: 'MARIA X PB', pai: 'Outorgantes 2024', duplicidade: [], documentos: { identidade: { qtd: 1, ultima: '2024-03-01' }, procuracao: { qtd: 1, ultima: '2024-05-01' }, inicial: { qtd: 1, ultima: '2024-05-01' } } };

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
  assert.ok(rel.pendencias.some(p => p.codigo === 'modelo_inicial' && /Modelo aprovado de inicial/.test(p.texto)));
  assert.equal(rel.pendencias.some(p => /procuração/i.test(p.texto)), false, 'a procuração anterior é reaproveitada: não há modelo a cadastrar');
  assert.deepEqual(rel.documentos.reaproveita, ['identidade', 'procuracao']);
  assert.equal(rel.valor_da_causa.valor, 8000);
  assert.equal(rel.decisao_humana.confirmado_em, '2026-09-27T12:00:00.000Z');
  const texto = relatorioEmTexto(rel);
  assert.match(texto, /MARIA DA SILVA/);
  assert.match(texto, /R\$\s?8\.000,00/);
  assert.match(texto, /o juízo não é herdado/);
  const completo = montarRelatorio({ item: r.item, resultado: r, periodo, valor: calcularValorCausa({ tese: 'FGTS', oficial: OFICIAL, salarioMinimo: null }), checklist: montarChecklist({ documentos: PASTA.documentos }), modelos: { inicial: { titulo: 'I', drive_arquivo_id: 'arq-1' } } });
  assert.equal(completo.pronto_para_gerar_pecas, true);
  const semArquivo = montarRelatorio({ item: r.item, resultado: r, periodo, valor: calcularValorCausa({ tese: 'FGTS', oficial: OFICIAL, salarioMinimo: null }), checklist: montarChecklist({ documentos: PASTA.documentos }), modelos: { inicial: { titulo: 'I', drive_arquivo_id: null } } });
  assert.deepEqual(semArquivo.pendencias.map(p => p.codigo), ['modelo_sem_arquivo']);
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

function conexaoMontagem({ pacote = { id: 'pac-1', tarefa_id: 't-1', status: 'reservado' }, modelos = [], acervo = null } = {}) {
  const updates = [];
  const consultasAcervo = [];
  return {
    updates, consultasAcervo,
    async queryOne(sql, params) {
      if (sql === SQL_MODELO_ACERVO) { consultasAcervo.push(params); return acervo; }
      assert.match(sql, /FROM pacotes_reprotocolo WHERE id = \$1 FOR UPDATE/); return pacote;
    },
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
  assert.equal(r.relatorio.modelos.inicial.origem, 'ajuste_manual');
  assert.equal(conexao.consultasAcervo.length, 0, 'ajuste manual tem precedência: não consulta o acervo');
  const [inicio, fim, meses, valor, exige] = conexao.updates[0];
  assert.deepEqual([inicio, fim, meses, valor, exige], ['2024-01-01', '2026-09-01', 33, 8000, false]);
  assert.doesNotMatch(r.texto, /Modelo aprovado de inicial/);
});

test('montar: modelo de inicial vem do acervo (ente + tese); sem arquivo ou inexistente vira pendência', async () => {
  const verificar = async () => ({ resultados: [resultado()] });
  const achado = conexaoMontagem({ acervo: { id: 'a1', titulo: 'INICIAL FGTS x ESTADO DA PARAÍBA — modelo', drive_file_id: 'arq-9' } });
  const r1 = await montarPacote({ conexao: achado, pacoteId: 'p', verificar, agora: AGORA });
  assert.deepEqual(achado.consultasAcervo[0], ['estado-paraiba', 'fgts-nulidade']);
  assert.deepEqual(r1.relatorio.modelos.inicial, { origem: 'acervo', acervo_id: 'a1', titulo: 'INICIAL FGTS x ESTADO DA PARAÍBA — modelo', drive_arquivo_id: 'arq-9' });
  assert.equal(r1.relatorio.pendencias.some(p => p.codigo.startsWith('modelo')), false);
  const semArq = await montarPacote({ conexao: conexaoMontagem({ acervo: { id: 'a2', titulo: 'PMJP', drive_file_id: null } }), pacoteId: 'p', verificar, agora: AGORA });
  assert.deepEqual(semArq.relatorio.pendencias.filter(p => p.codigo.startsWith('modelo')).map(p => p.codigo), ['modelo_sem_arquivo']);
  const nenhum = await montarPacote({ conexao: conexaoMontagem({ acervo: null }), pacoteId: 'p', verificar, agora: AGORA });
  assert.deepEqual(nenhum.relatorio.pendencias.filter(p => p.codigo.startsWith('modelo')).map(p => p.codigo), ['modelo_inicial']);
  // ente sem código no acervo: nem consulta
  const semSlug = conexaoMontagem();
  await montarPacote({ conexao: semSlug, pacoteId: 'p', verificar: async () => ({ resultados: [resultado({ extra: { polo_passivo: 'Município de Cabedelo', polo_vinculo_unico: 'Município de Cabedelo', polo_cliente: 'Município de Cabedelo' }, oficial: null })] }), agora: AGORA });
  assert.equal(semSlug.consultasAcervo.length, 0);
});

test('slugs do acervo: ente e tese', () => {
  assert.equal(slugEnteAcervo({ nome: 'Estado da Paraíba', fonte_oficial: 'PB' }), 'estado-paraiba');
  assert.equal(slugEnteAcervo({ nome: 'Estado de Pernambuco', fonte_oficial: 'PE' }), 'estado-pernambuco');
  assert.equal(slugEnteAcervo({ nome: 'Município de João Pessoa', fonte_oficial: null }), 'municipio-joao-pessoa');
  assert.equal(slugEnteAcervo({ nome: 'Prefeitura de João Pessoa' }), 'municipio-joao-pessoa');
  assert.equal(slugEnteAcervo({ nome: 'Município de Cabedelo' }), null);
  assert.equal(slugTeseAcervo('FGTS', 'estado-paraiba'), 'fgts-nulidade');
  assert.equal(slugTeseAcervo('FGTS', 'estado-pernambuco'), 'fgts-pernambuco');
  assert.equal(slugTeseAcervo('INSALUBRIDADE', 'estado-paraiba'), null);
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

// ── aprovação ──

function conexaoAprovacao({ pacote }) {
  const updates = [];
  return { updates, async queryOne() { return pacote; }, async execute(sql, params) { assert.match(sql, /SET status = 'aprovado'/); updates.push(params); return { rowCount: 1 }; } };
}
const montado = (extra = {}) => ({ id: 'pac-1', tarefa_id: 't-1', status: 'montado', dados: { pendencias: [{ codigo: 'valor', texto: 'v' }], valor_da_causa: { valor: null } }, ...extra });

test('aprovar: só pacote montado, sem pendência de modelo, com valor válido e confirmação ainda válida', async () => {
  const verificar = async () => ({ resultados: [resultado()] });
  const base = { pacoteId: 'pac-1', usuarioId: 'lu', valorCausa: 8000, verificar, agora: AGORA, salarioMinimo: null };
  assert.equal((await aprovarPacote({ ...base, conexao: conexaoAprovacao({ pacote: null }) })).status, 404);
  assert.equal((await aprovarPacote({ ...base, conexao: conexaoAprovacao({ pacote: montado({ status: 'reservado' }) }) })).status, 409);
  const semModelo = await aprovarPacote({ ...base, conexao: conexaoAprovacao({ pacote: montado({ dados: { pendencias: [{ codigo: 'modelo_sem_arquivo', texto: 'Modelo sem arquivo.' }] } }) }) });
  assert.equal(semModelo.status, 409);
  assert.deepEqual(semModelo.pendencias, ['modelo_sem_arquivo']);
  for (const v of [0, -5, 'abc', null]) assert.equal((await aprovarPacote({ ...base, valorCausa: v, conexao: conexaoAprovacao({ pacote: montado() }) })).status, 400, String(v));
  const vencida = await aprovarPacote({ ...base, verificar: async () => ({ resultados: [resultado({ confirmada: false })] }), conexao: conexaoAprovacao({ pacote: montado() }) });
  assert.equal(vencida.status, 409);
  assert.match(vencida.erro, /perdeu a validade/);
});

test('aprovar: grava valor, quem aprovou e a proposta do sistema; documentos e valor pendentes não impedem', async () => {
  const conexao = conexaoAprovacao({ pacote: montado({ dados: { pendencias: [{ codigo: 'valor', texto: 'v' }, { codigo: 'documentos', texto: 'd' }], valor_da_causa: { valor: 6118.03 } } }) });
  const r = await aprovarPacote({ conexao, pacoteId: 'pac-1', usuarioId: 'lu', valorCausa: '6.118,03'.replace('.', '').replace(',', '.'), observacao: ' conferido ', verificar: async () => ({ resultados: [resultado()] }), agora: AGORA, salarioMinimo: null });
  assert.equal(r.ok, true);
  const [valor, quem, json, id] = conexao.updates[0];
  assert.deepEqual([valor, quem, id], [6118.03, 'lu', 'pac-1']);
  assert.deepEqual(JSON.parse(json), { valor_causa: 6118.03, observacao: 'conferido', acima_do_teto_ciente: false, valor_divergente_ciente: false, proposta_do_sistema: 6118.03 });
});

test('aprovar: valor acima do teto de 60 salários mínimos exige ciência explícita', async () => {
  const verificar = async () => ({ resultados: [resultado()] });
  const base = { pacoteId: 'pac-1', usuarioId: 'lu', valorCausa: 100000, verificar, agora: AGORA, salarioMinimo: 1621 };
  const barrado = await aprovarPacote({ ...base, conexao: conexaoAprovacao({ pacote: montado() }) });
  assert.equal(barrado.status, 409);
  assert.equal(barrado.teto, 97260);
  assert.match(barrado.erro, /teto do Juizado/);
  assert.equal((await aprovarPacote({ ...base, acimaDoTetoCiente: true, conexao: conexaoAprovacao({ pacote: montado() }) })).ok, true);
  assert.equal((await aprovarPacote({ ...base, valorCausa: 97260, conexao: conexaoAprovacao({ pacote: montado() }) })).ok, true, 'exatamente no teto passa');
});

// ── trava do valor divergente (S-17) ──
const comProposta = (valor) => montado({ dados: { pendencias: [], valor_da_causa: { valor } } });
const aprovarValor = (valorCausa, proposta, extra = {}) => {
  const conexao = conexaoAprovacao({ pacote: comProposta(proposta) });
  return aprovarPacote({ conexao, pacoteId: 'pac-1', usuarioId: 'lu', valorCausa, verificar: async () => ({ resultados: [resultado()] }), agora: AGORA, salarioMinimo: null, ...extra })
    .then(r => ({ r, conexao }));
};

test('aprovar: valor em pt-BR e com ponto decimal chegam iguais; 812,35 e 812.35 passam', async () => {
  for (const v of ['812,35', '812.35', 812.35, 'R$ 812,35']) {
    const { r, conexao } = await aprovarValor(v, 812.35);
    assert.equal(r.ok, true, String(v));
    assert.equal(conexao.updates[0][0], 812.35, String(v));
  }
  assert.equal((await aprovarValor('1.234,56', 1234.56)).r.ok, true);
});

test('aprovar: valor 100 vezes maior (81235 e "81.235") é recusado com 409 e os dois valores na mensagem', async () => {
  for (const v of [81235, '81.235', '81235', '81.235,00']) {
    const { r, conexao } = await aprovarValor(v, 812.35);
    assert.equal(r.ok, false, String(v));
    assert.equal(r.status, 409);
    assert.equal(r.motivo, 'valor_divergente');
    assert.match(r.erro, /R\$\s81\.235,00/);
    assert.match(r.erro, /R\$\s812,35/);
    assert.equal(r.proposta, 812.35);
    assert.equal(r.valor_informado, 81235);
    assert.equal(conexao.updates.length, 0, 'nada gravado');
  }
});

test('aprovar: erro de uma casa decimal (812,30 → 8.123, exatamente 10 vezes) e o limite de 5 vezes', async () => {
  const dez = await aprovarValor('8.123', 812.3);
  assert.equal(dez.r.status, 409);
  assert.equal(dez.r.motivo, 'valor_divergente');
  assert.equal((await aprovarValor(8123, 812.3)).r.status, 409);
  // exatamente 5 vezes já trava; logo abaixo passa
  assert.equal((await aprovarValor(4000, 800)).r.status, 409);
  assert.equal((await aprovarValor(3999.99, 800)).r.ok, true);
  assert.equal((await aprovarValor(3000, 812.35)).r.ok, true, '3,7 vezes passa sem ciente');
  assert.equal((await aprovarValor(900, 812.35)).r.ok, true);
});

test('aprovar: valor 1/5 ou menos da proposta também trava (para menos)', async () => {
  const um5 = await aprovarValor(162.47, 812.35);
  assert.equal(um5.r.status, 409);
  assert.equal(um5.r.motivo, 'valor_divergente');
  assert.equal((await aprovarValor(8.12, 812.35)).r.status, 409);
  assert.equal((await aprovarValor(162.48, 812.35)).r.ok, true);
  assert.equal((await aprovarValor(400, 812.35)).r.ok, true);
});

test('aprovar: com a ciência explícita o valor divergente passa e a aprovação registra proposta e ciência', async () => {
  const { r, conexao } = await aprovarValor(81235, 812.35, { valorDivergenteCiente: true });
  assert.equal(r.ok, true);
  const aprov = JSON.parse(conexao.updates[0][2]);
  assert.equal(aprov.valor_causa, 81235);
  assert.equal(aprov.proposta_do_sistema, 812.35);
  assert.equal(aprov.valor_divergente_ciente, true);
  const normal = await aprovarValor(812.35, 812.35);
  assert.equal(JSON.parse(normal.conexao.updates[0][2]).valor_divergente_ciente, false);
});

test('aprovar: sem proposta (a informar) não há o que comparar; valor inválido continua 400', async () => {
  for (const proposta of [null, 0, undefined]) assert.equal((await aprovarValor(81235, proposta)).r.ok, true, String(proposta));
  for (const v of ['abc', '', 0, -812, null, undefined, true, {}, [], NaN, Infinity]) {
    const { r } = await aprovarValor(v, 812.35);
    assert.equal(r.status, 400, String(v));
  }
});

test('aprovar: a trava de valor divergente não substitui a do teto do Juizado (as duas valem)', async () => {
  const { r } = await aprovarValor(100000, 90000, { salarioMinimo: 1621 });
  assert.equal(r.status, 409);
  assert.match(r.erro, /teto do Juizado/);
});

// D-S4 / S-05: usuarioPodeAprovar é assíncrono e vale a UNIÃO da variável com a marcação no cadastro.
// `semMarcacao` é o dublê do banco sem ninguém marcado.
const semMarcacao = { async queryOne() { return null; } };
test('aprovador: só e-mails de REPROTOCOLO_APROVADORES; sem a variável (e sem marcação) ninguém aprova', async () => {
  const antes = process.env.REPROTOCOLO_APROVADORES;
  try {
    delete process.env.REPROTOCOLO_APROVADORES;
    assert.equal(await usuarioPodeAprovar({ email: 'lucianomlc@outlook.com' }, semMarcacao), false);
    process.env.REPROTOCOLO_APROVADORES = ' LucianoMLC@outlook.com , outro@x.com ';
    assert.deepEqual(aprovadoresConfigurados(), ['lucianomlc@outlook.com', 'outro@x.com']);
    assert.equal(await usuarioPodeAprovar({ email: 'lucianomlc@outlook.com' }, semMarcacao), true);
    assert.equal(await usuarioPodeAprovar({ email: 'ramona@x.com' }, semMarcacao), false);
    assert.equal(await usuarioPodeAprovar({}, semMarcacao), false);
    assert.equal(await usuarioPodeAprovar(null, semMarcacao), false);
  } finally { if (antes === undefined) delete process.env.REPROTOCOLO_APROVADORES; else process.env.REPROTOCOLO_APROVADORES = antes; }
});

test('aprovador (D-S4): a marcação no cadastro também aprova; a união NUNCA tira quem está na variável', async () => {
  const antes = process.env.REPROTOCOLO_APROVADORES;
  const consultas = [];
  const marcado = (id) => ({ async queryOne(sql, params) { consultas.push({ sql, params }); return params[0] === id ? { ok: 1 } : null; } });
  try {
    process.env.REPROTOCOLO_APROVADORES = 'luciano@x.com';
    // só a marcação (e-mail fora da variável)
    assert.equal(await usuarioPodeAprovar({ id: 'u-ana', email: 'ana@x.com' }, marcado('u-ana')), true);
    assert.equal(await usuarioPodeAprovar({ id: 'u-bia', email: 'bia@x.com' }, marcado('u-ana')), false);
    // só a variável (não marcado no cadastro): continua aprovando, e nem consulta o banco
    consultas.length = 0;
    assert.equal(await usuarioPodeAprovar({ id: 'u-lu', email: 'Luciano@X.com' }, marcado('ninguem')), true);
    assert.equal(consultas.length, 0, 'quem está na variável não depende do banco');
    // os dois ao mesmo tempo
    assert.equal(await usuarioPodeAprovar({ id: 'u-ana', email: 'luciano@x.com' }, marcado('u-ana')), true);
    // a consulta exige marcação + ativo + Master, parametrizada pelo id
    await usuarioPodeAprovar({ id: 'u-x', email: 'x@x.com' }, marcado('u-ana'));
    const sql = consultas.at(-1).sql;
    assert.match(sql, /aprova_reprotocolo = true/);
    assert.match(sql, /ativo = true/);
    assert.match(sql, /perfil = 'master'/);
    assert.deepEqual(consultas.at(-1).params, ['u-x']);
  } finally { if (antes === undefined) delete process.env.REPROTOCOLO_APROVADORES; else process.env.REPROTOCOLO_APROVADORES = antes; }
});

test('aprovador (D-S4): sem id não consulta; falha de leitura no banco = só vale a variável (nunca abre a porta)', async () => {
  const antes = process.env.REPROTOCOLO_APROVADORES;
  const quebrado = { async queryOne() { throw new Error('coluna inexistente'); } };
  try {
    process.env.REPROTOCOLO_APROVADORES = 'luciano@x.com';
    assert.equal(await usuarioPodeAprovar({ email: 'ana@x.com' }, { async queryOne() { throw new Error('não deveria consultar sem id'); } }), false);
    assert.equal(await usuarioPodeAprovar({ id: 'u-ana', email: 'ana@x.com' }, quebrado), false);
    assert.equal(await usuarioPodeAprovar({ id: 'u-lu', email: 'luciano@x.com' }, quebrado), true, 'a variável continua valendo com o banco quebrado');
  } finally { if (antes === undefined) delete process.env.REPROTOCOLO_APROVADORES; else process.env.REPROTOCOLO_APROVADORES = antes; }
});

test('cancelar aceita pacote aprovado; pacotesPorTarefas sem ids não consulta o banco', async () => {
  const chamadas = [];
  await cancelarPacote({ conexao: { async execute(sql) { chamadas.push(sql); return { rowCount: 1 }; } }, pacoteId: 'p', usuarioId: 'm1', motivo: 'Revisão' });
  assert.match(chamadas[0], /'reservado','montado','aprovado'/);
  assert.deepEqual(await pacotesPorTarefas({ conexao: { async query() { throw new Error('não deveria consultar'); } }, tarefaIds: [] }), []);
});
