import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  mensagemErroSync,
  fecharExecucaoSync,
  fecharExecucoesAbertas,
  criarMetricasSync,
  ERRO_INTERROMPIDA,
} from './syncExecucao.js';

// Banco falso: registra cada chamada e deixa escolher qual chamada (1ª, 2ª...) falha.
function bancoFalso({ falhaExecute = [], linhasQuery = [] } = {}) {
  const chamadas = [];
  return {
    chamadas,
    async execute(sql, params) {
      chamadas.push({ tipo: 'execute', sql, params });
      if (falhaExecute.includes(chamadas.length)) throw new Error('column "erro" of relation "sync_execucoes" does not exist');
      return { rowCount: 1 };
    },
    async query(sql, params) {
      chamadas.push({ tipo: 'query', sql, params });
      return linhasQuery;
    },
  };
}

// ── mensagemErroSync ─────────────────────────────────────────────────────────

test('mensagemErroSync: mantém só a primeira linha e limita o tamanho', () => {
  assert.equal(mensagemErroSync(new Error('linha um\nlinha dois com stack')), 'linha um');
  assert.equal(mensagemErroSync(new Error('x'.repeat(1000))).length, 300);
});

test('mensagemErroSync: remove e-mail, CPF, número de processo e sequências longas de dígitos', () => {
  const msg = mensagemErroSync(new Error(
    'falha para maria@exemplo.com.br cpf 123.456.789-09 (12345678909) processo 0801234-56.2024.8.15.0001 tel 83999998888'
  ));
  assert.doesNotMatch(msg, /maria@|123\.456|12345678909|0801234|83999998888/);
  assert.match(msg, /\[e-mail\]/);
  assert.match(msg, /\[cpf\]/);
  assert.match(msg, /\[processo\]/);
});

test('mensagemErroSync: preserva a causa técnica que ajuda a diagnosticar (sem dado pessoal)', () => {
  assert.equal(mensagemErroSync(new Error('DataJud HTTP 503 — TJPB')), 'DataJud HTTP 503 — TJPB');
  assert.equal(mensagemErroSync(new Error("Cannot read properties of null (reading 'replace')")),
    "Cannot read properties of null (reading 'replace')");
});

test('mensagemErroSync: aceita valores que não são Error e mensagem vazia', () => {
  assert.equal(mensagemErroSync('falhou'), 'falhou');
  assert.equal(mensagemErroSync(undefined), 'Erro sem mensagem');
  assert.equal(mensagemErroSync(new Error('')), 'Erro sem mensagem');
});

// ── fecharExecucaoSync ───────────────────────────────────────────────────────

test('fecharExecucaoSync: fecha com concluido_em, falhas e erro no mesmo UPDATE', async () => {
  const banco = bancoFalso();
  const ok = await fecharExecucaoSync(banco, 'exec-1', { viaDatajud: 3, falhas: 2, novasMovimentacoes: 5, erro: 'boom' });
  assert.equal(ok, true);
  assert.equal(banco.chamadas.length, 1);
  assert.match(banco.chamadas[0].sql, /concluido_em = NOW\(\)/);
  assert.match(banco.chamadas[0].sql, /erro = \$4/);
  assert.deepEqual(banco.chamadas[0].params, [3, 2, 5, 'boom', 'exec-1']);
});

test('fecharExecucaoSync: execução normal grava erro nulo (limpa marca de um fechamento anterior)', async () => {
  const banco = bancoFalso();
  await fecharExecucaoSync(banco, 'exec-1', { viaDatajud: 1, falhas: 0, novasMovimentacoes: 0 });
  assert.equal(banco.chamadas[0].params[3], null);
});

test('fecharExecucaoSync: sem id (INSERT da execução falhou) não toca no banco', async () => {
  const banco = bancoFalso();
  assert.equal(await fecharExecucaoSync(banco, null, { falhas: 1 }), false);
  assert.equal(banco.chamadas.length, 0);
});

test('fecharExecucaoSync: sem a coluna erro (migração pendente) ainda fecha a linha', async () => {
  const banco = bancoFalso({ falhaExecute: [1] });
  const ok = await fecharExecucaoSync(banco, 'exec-1', { falhas: 1, erro: 'boom' });
  assert.equal(ok, true);
  assert.equal(banco.chamadas.length, 2);
  assert.doesNotMatch(banco.chamadas[1].sql, /erro/);
  assert.match(banco.chamadas[1].sql, /concluido_em = NOW\(\)/);
});

test('fecharExecucaoSync: nunca lança, nem quando o banco recusa as duas tentativas', async () => {
  const banco = bancoFalso({ falhaExecute: [1, 2] });
  assert.equal(await fecharExecucaoSync(banco, 'exec-1', { falhas: 1, erro: 'boom' }), false);
  assert.equal(banco.chamadas.length, 2);
});

// ── fecharExecucoesAbertas (boot) ────────────────────────────────────────────

test('fecharExecucoesAbertas: fecha TODAS as abertas (sem LIMIT), marca erro e devolve a contagem', async () => {
  const banco = bancoFalso({ linhasQuery: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
  const n = await fecharExecucoesAbertas(banco);
  assert.equal(n, 3);
  const { sql, params } = banco.chamadas[0];
  assert.doesNotMatch(sql, /LIMIT/i);
  assert.doesNotMatch(sql, /status/i);             // a coluna "status" nunca existiu em sync_execucoes
  assert.match(sql, /concluido_em IS NULL/);
  assert.match(sql, /erro = \$1/);
  assert.match(sql, /GREATEST\(COALESCE\(falhas, 0\), 1\)/);
  assert.deepEqual(params, [ERRO_INTERROMPIDA, 10]);
});

test('fecharExecucoesAbertas: nada aberto devolve 0 (o boot não reagenda sync)', async () => {
  const banco = bancoFalso({ linhasQuery: [] });
  assert.equal(await fecharExecucoesAbertas(banco, { minutos: 30 }), 0);
  assert.equal(banco.chamadas[0].params[1], 30);
});

test('workers/index.js: o boot usa fecharExecucoesAbertas (sem a coluna inexistente "status") e reagenda só se fechou algo', () => {
  const fonte = readFileSync(new URL('../../workers/index.js', import.meta.url), 'utf8');
  assert.match(fonte, /fecharExecucoesAbertas\(db\)/);
  assert.match(fonte, /if \(fechadas > 0\)/);
  assert.doesNotMatch(fonte, /status = 'interrompido'/);
});

// ── R-06: métricas da execução (status_http, hits, casados) ──────────────────

test('criarMetricasSync: statusHttp é o pior status visto; só 2xx = o último 2xx; nenhuma resposta = null', () => {
  const m = criarMetricasSync();
  assert.deepEqual(m.resumo(), { statusHttp: null, hits: 0, casados: 0 });
  m.registrarStatus(null);                 // timeout: sem status
  m.registrarStatus(undefined);
  assert.equal(m.resumo().statusHttp, null);
  m.registrarStatus(200);
  assert.equal(m.resumo().statusHttp, 200);
  m.registrarStatus(429);
  m.registrarStatus(200);                  // um 200 depois não apaga o 429 da execução
  assert.equal(m.resumo().statusHttp, 429);
  m.registrarStatus(503);
  assert.equal(m.resumo().statusHttp, 503);
  m.hits += 40; m.casados += 7;
  assert.deepEqual(m.resumo(), { statusHttp: 503, hits: 40, casados: 7 });
});

test('fecharExecucaoSync com métricas: grava status_http, hits e casados no MESMO UPDATE do fechamento', async () => {
  const banco = bancoFalso();
  const ok = await fecharExecucaoSync(banco, 'exec-1', {
    viaDatajud: 800, falhas: 11, novasMovimentacoes: 5, metricas: { statusHttp: 429, hits: 790, casados: 800 },
  });
  assert.equal(ok, true);
  assert.equal(banco.chamadas.length, 1);
  assert.match(banco.chamadas[0].sql, /concluido_em = NOW\(\)/);
  assert.match(banco.chamadas[0].sql, /status_http = \$5, hits = \$6, casados = \$7/);
  assert.deepEqual(banco.chamadas[0].params, [800, 11, 5, null, 429, 790, 800, 'exec-1']);
});

test('fecharExecucaoSync com métricas e sem status HTTP (timeout): grava NULL, não 0', async () => {
  const banco = bancoFalso();
  await fecharExecucaoSync(banco, 'exec-1', { falhas: 3, metricas: { statusHttp: null, hits: 0, casados: 0 } });
  assert.equal(banco.chamadas[0].params[4], null);
});

test('fecharExecucaoSync com métricas, colunas novas ainda ausentes (migração pendente): fecha mesmo assim, sem as métricas', async () => {
  const banco = bancoFalso({ falhaExecute: [1] });
  const ok = await fecharExecucaoSync(banco, 'exec-1', { falhas: 2, erro: 'boom', metricas: { statusHttp: 200, hits: 1, casados: 1 } });
  assert.equal(ok, true);
  assert.equal(banco.chamadas.length, 2);
  assert.doesNotMatch(banco.chamadas[1].sql, /status_http/);
  assert.match(banco.chamadas[1].sql, /erro = \$4/);
  assert.deepEqual(banco.chamadas[1].params, [0, 2, 0, 'boom', 'exec-1']);
});

test('fecharExecucaoSync com métricas: recusa das 3 tentativas ainda não lança', async () => {
  const banco = bancoFalso({ falhaExecute: [1, 2, 3] });
  assert.equal(await fecharExecucaoSync(banco, 'exec-1', { falhas: 1, metricas: { statusHttp: 200, hits: 0, casados: 0 } }), false);
  assert.equal(banco.chamadas.length, 3);
});
