// R-07 (Onda 1) — contenção da IA: só Master aciona as rotas pagas (e só em processo que pode ver)
// e o fallback da classificação nunca apaga status definidos à mão.
// Sem banco, sem Redis, sem chamada externa: db, ai e redis são trocados por dublês.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import 'express-async-errors';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'segredo-de-teste';
process.env.REDIS_URL = 'redis://127.0.0.1:1'; // nunca usado: get/set abaixo são falsos e a conexão é encerrada

const { db } = await import('../db/index.js');
// Guarda: nada aqui pode tocar o banco real. Cada teste instala o dublê de que precisa.
const bancoBloqueado = async () => { throw new Error('banco real proibido nos testes'); };
function usarBanco({ queryOne = bancoBloqueado, query = bancoBloqueado, execute = bancoBloqueado } = {}) {
  db.queryOne = queryOne; db.query = query; db.execute = execute;
}
usarBanco();

const { ai } = await import('../services/ai/index.js');
const iaProibida = async () => { throw new Error('IA real proibida nos testes'); };
ai.classificar = iaProibida;
ai.diagnosticar = iaProibida;

const { redis } = await import('../cache/redis.js');
redis.disconnect();
const gravacoesRedis = [];
redis.get = async () => null;
redis.set = async (chave, valor) => { gravacoesRedis.push({ chave, estado: JSON.parse(valor) }); return 'OK'; };

const { autenticar } = await import('../middleware/auth.js');
const { processosRouter } = await import('./processos.js');
const { movimentacoesRouter } = await import('./movimentacoes.js');
const { configAiRouter } = await import('./config.ai.js');

const app = express();
app.use(express.json());
app.use('/api/processos', autenticar, processosRouter);
app.use('/api/movimentacoes', autenticar, movimentacoesRouter);
app.use('/api/config/ai', autenticar, configAiRouter);
app.use((err, _req, res, _next) => res.status(500).json({ ok: false, erro: err.message }));

const servidor = app.listen(0);
const base = `http://127.0.0.1:${servidor.address().port}`;
after(() => servidor.close());

const assinar = payload => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
const TOKENS = {
  junior: assinar({ id: 'j1', perfil: 'junior', email: 'junior@exemplo.com' }),
  master: assinar({ id: 'm1', perfil: 'master', email: 'master@exemplo.com' }),
  master01: assinar({ id: 'm0', perfil: 'master', email: 'dono@exemplo.com', pode_marcar_restrito: true }),
};

async function chamar(metodo, caminho, token) {
  const r = await fetch(`${base}${caminho}`, { method: metodo, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: r.status, corpo: await r.json() };
}

const PID = '11111111-1111-4111-8111-111111111111';
const MID = '22222222-2222-4222-8222-222222222222';

// ── dublês ───────────────────────────────────────────────────────────────────────────────────
const processoBase = (extra = {}) => ({
  id: PID, numero: '0800000-00.2024.8.15.2001', tribunal: 'TJPB', produto_nome: 'FGTS',
  situacao_atual: 'em_precatorio', etapa_atual: 'Aguardando', visibilidade: 'normal',
  tipo_requisicao: 'rpv', status_rpv: 'expedida', status_precatorio: 'nao_iniciado', status_alvara: 'nao_iniciado',
  ...extra,
});

// Devolve o dublê de banco da rota /classificar; `atualNoUpdate` simula o que o processo tem
// quando a IA termina (pode ser diferente do que havia ao começar, se alguém editou no meio).
function bancoClassificar({ processo = processoBase(), atualNoUpdate = processo } = {}) {
  const escritas = [];
  usarBanco({
    async queryOne(sql) {
      if (sql.includes('SELECT p.*, pr.nome AS produto_nome')) return processo;
      if (sql.includes('SELECT tipo_requisicao')) return atualNoUpdate;
      throw new Error(`queryOne inesperada: ${sql.slice(0, 60)}`);
    },
    async query() { return []; },
    async execute(sql, params) { escritas.push({ sql, params }); return { rowCount: 1 }; },
  });
  return escritas;
}

const resultadoIA = (extra = {}) => ({
  situacao_atual: 'em_precatorio', etapa_atual: 'Precatório em andamento', localizacao_processual: null,
  tipo_requisicao: null, status_rpv: null, status_precatorio: null, status_alvara: null, confianca: 'ALTA',
  ...extra,
});
const updateDeClassificacao = escritas => escritas.find(e => e.sql.includes("classificado_por = 'claude'"));
// posições dos parâmetros do UPDATE: 0 situação, 1 etapa, 2 localização, 3 tipo, 4 rpv, 5 precatório, 6 alvará
const [P_TIPO, P_RPV, P_PREC, P_ALV] = [3, 4, 5, 6];

// ── 1) perfil junior recebe 403; sem token, 401 ──────────────────────────────────────────────
test('junior: POST /processos/:id/classificar → 403 e nada é tocado (nem banco, nem IA)', async () => {
  usarBanco(); // qualquer acesso ao banco lança
  let chamouIA = false;
  ai.classificar = async () => { chamouIA = true; return resultadoIA(); };
  const r = await chamar('POST', `/api/processos/${PID}/classificar`, TOKENS.junior);
  assert.equal(r.status, 403);
  assert.equal(r.corpo.ok, false);
  assert.equal(chamouIA, false);
  ai.classificar = iaProibida;
});

test('junior: POST /movimentacoes/:id/diagnosticar → 403 e nada é tocado', async () => {
  usarBanco();
  let chamouIA = false;
  ai.diagnosticar = async () => { chamouIA = true; return {}; };
  const r = await chamar('POST', `/api/movimentacoes/${MID}/diagnosticar`, TOKENS.junior);
  assert.equal(r.status, 403);
  assert.equal(chamouIA, false);
  ai.diagnosticar = iaProibida;
});

test('junior: GET /config/ai/test → 403 (não chega a chamar provedor pago)', async () => {
  for (const provider of ['claude', 'openai']) {
    const r = await chamar('GET', `/api/config/ai/test?provider=${provider}`, TOKENS.junior);
    assert.equal(r.status, 403, provider);
    assert.match(r.corpo.erro, /Master/);
  }
});

test('junior: POST /processos/classificar-lote continua 403 (regressão)', async () => {
  const r = await chamar('POST', '/api/processos/classificar-lote', TOKENS.junior);
  assert.equal(r.status, 403);
});

test('sem token: as três rotas → 401', async () => {
  assert.equal((await chamar('POST', `/api/processos/${PID}/classificar`)).status, 401);
  assert.equal((await chamar('POST', `/api/movimentacoes/${MID}/diagnosticar`)).status, 401);
  assert.equal((await chamar('GET', '/api/config/ai/test?provider=claude')).status, 401);
});

// ── 2) master passa ──────────────────────────────────────────────────────────────────────────
test('master: GET /config/ai/test passa pelo portão (provedor inválido → 400, sem chamada externa)', async () => {
  const r = await chamar('GET', '/api/config/ai/test?provider=inexistente', TOKENS.master);
  assert.equal(r.status, 400);
  assert.equal(r.corpo.erro, 'Provedor inválido.');
});

test('master: /classificar em processo inexistente → 404 (passou do portão)', async () => {
  usarBanco({ async queryOne() { return null; } });
  const r = await chamar('POST', `/api/processos/${PID}/classificar`, TOKENS.master);
  assert.equal(r.status, 404);
});

test('master: /diagnosticar devolve o diagnóstico já salvo sem chamar a IA', async () => {
  usarBanco({
    async queryOne() {
      return { id: MID, processo_visibilidade: 'normal', diagnostico_em: '2026-09-01', pendencia_tipo: 'PETICIONAR', diagnostico_urgencia: 'ALTO' };
    },
  });
  const r = await chamar('POST', `/api/movimentacoes/${MID}/diagnosticar`, TOKENS.master);
  assert.equal(r.status, 200);
  assert.equal(r.corpo.ja_diagnosticada, true);
});

test('master: /diagnosticar sem diagnóstico prévio chama a IA e grava', async () => {
  const escritas = [];
  usarBanco({
    async queryOne() { return { id: MID, processo_id: PID, processo_visibilidade: 'normal', numero: '1', tribunal: 'TJPB', texto: 't', data_movimentacao: '2026-09-01' }; },
    async query() { return []; },
    async execute(sql, params) { escritas.push({ sql, params }); return { rowCount: 1 }; },
  });
  ai.diagnosticar = async () => ({ ultimaMovimentacao: { descricao: 'd' }, pendencia: { tipo: 'PETICIONAR', resumo: 'r' }, prioridade: 'MEDIO' });
  const r = await chamar('POST', `/api/movimentacoes/${MID}/diagnosticar`, TOKENS.master);
  assert.equal(r.status, 200);
  assert.equal(escritas.length, 1);
  ai.diagnosticar = iaProibida;
});

// ── 3) visibilidade (S-20 / A6-17; S-21: quem não pode ver recebe 404, como um id inexistente) ──
test('processo restrito: master sem pode_marcar_restrito → 404 em /classificar, sem chamar a IA nem gravar', async () => {
  const escritas = bancoClassificar({ processo: processoBase({ visibilidade: 'restrito' }) });
  let chamouIA = false;
  ai.classificar = async () => { chamouIA = true; return resultadoIA(); };
  const r = await chamar('POST', `/api/processos/${PID}/classificar`, TOKENS.master);
  assert.equal(r.status, 404);
  assert.equal(r.corpo.erro, 'Processo não encontrado.');
  assert.equal(chamouIA, false);
  assert.equal(escritas.length, 0);
  ai.classificar = iaProibida;
});

test('processo restrito: master 01 (pode_marcar_restrito) segue normalmente em /classificar', async () => {
  const escritas = bancoClassificar({ processo: processoBase({ visibilidade: 'restrito' }) });
  ai.classificar = async () => resultadoIA();
  const r = await chamar('POST', `/api/processos/${PID}/classificar`, TOKENS.master01);
  assert.equal(r.status, 200);
  assert.ok(updateDeClassificacao(escritas));
  ai.classificar = iaProibida;
});

test('processo restrito: master sem pode_marcar_restrito → 404 em /diagnosticar, mesmo com diagnóstico salvo', async () => {
  usarBanco({ async queryOne() { return { id: MID, processo_visibilidade: 'restrito', diagnostico_em: '2026-09-01' }; } });
  const r = await chamar('POST', `/api/movimentacoes/${MID}/diagnosticar`, TOKENS.master);
  assert.equal(r.status, 404);
  assert.equal(r.corpo.erro, 'Movimentação não encontrada.');
  assert.equal(r.corpo.diagnostico, undefined);
});

test('processo restrito: master 01 recebe o diagnóstico em /diagnosticar', async () => {
  usarBanco({ async queryOne() { return { id: MID, processo_visibilidade: 'restrito', diagnostico_em: '2026-09-01' }; } });
  const r = await chamar('POST', `/api/movimentacoes/${MID}/diagnosticar`, TOKENS.master01);
  assert.equal(r.status, 200);
  assert.equal(r.corpo.ja_diagnosticada, true);
});

// ── 4) fallback preserva o manual ────────────────────────────────────────────────────────────
test('fallback (IA devolve null): 502, nada gravado, status manuais intactos', async () => {
  const escritas = bancoClassificar();
  ai.classificar = async () => null;
  const r = await chamar('POST', `/api/processos/${PID}/classificar`, TOKENS.master);
  assert.equal(r.status, 502);
  assert.equal(r.corpo.ok, false);
  assert.match(r.corpo.erro, /Nada foi alterado/);
  assert.equal(escritas.length, 0, 'nenhum UPDATE nem INSERT em historico_situacao');
  ai.classificar = iaProibida;
});

test('IA responde nao_iniciado/a_definir sobre RPV expedida manual: UPDATE não leva tipo nem status (COALESCE mantém)', async () => {
  const escritas = bancoClassificar();
  // resultado como sai do classificarProcesso com valor inválido: tipo e status null
  ai.classificar = async () => resultadoIA({ tipo_requisicao: 'a_definir', status_rpv: 'nao_iniciado', status_precatorio: 'nao_iniciado', status_alvara: 'nao_iniciado' });
  const r = await chamar('POST', `/api/processos/${PID}/classificar`, TOKENS.master);
  assert.equal(r.status, 200);
  const up = updateDeClassificacao(escritas);
  assert.ok(up, 'a classificação (situação/etapa) ainda é gravada');
  assert.equal(up.params[P_TIPO], null);
  assert.equal(up.params[P_RPV], null);
  assert.equal(up.params[P_PREC], null);
  assert.equal(up.params[P_ALV], null);
  assert.match(up.sql, /status_rpv = COALESCE\(\$5, status_rpv\)/);
  ai.classificar = iaProibida;
});

test('IA avança RPV determinada → expedida: o avanço é gravado', async () => {
  const p = processoBase({ status_rpv: 'determinada' });
  const escritas = bancoClassificar({ processo: p });
  ai.classificar = async () => resultadoIA({ tipo_requisicao: 'rpv', status_rpv: 'expedida' });
  const r = await chamar('POST', `/api/processos/${PID}/classificar`, TOKENS.master);
  assert.equal(r.status, 200);
  const up = updateDeClassificacao(escritas);
  assert.equal(up.params[P_RPV], 'expedida');
  assert.equal(up.params[P_TIPO], null, 'tipo já era rpv: nada a regravar');
  ai.classificar = iaProibida;
});

test('edição manual DURANTE a chamada da IA: vale o status relido antes do UPDATE, não o do início', async () => {
  // no início o RPV estava "determinada"; enquanto a IA respondia, alguém marcou "expedida"
  const escritas = bancoClassificar({
    processo: processoBase({ status_rpv: 'determinada' }),
    atualNoUpdate: processoBase({ status_rpv: 'expedida' }),
  });
  ai.classificar = async () => resultadoIA({ tipo_requisicao: 'rpv', status_rpv: 'confeccionada' });
  const r = await chamar('POST', `/api/processos/${PID}/classificar`, TOKENS.master);
  assert.equal(r.status, 200);
  assert.equal(updateDeClassificacao(escritas).params[P_RPV], null, 'confeccionada não rebaixa a expedida manual');
  ai.classificar = iaProibida;
});

test('IA discorda do tipo manual (rpv → precatório): requisição inteira preservada', async () => {
  const escritas = bancoClassificar();
  ai.classificar = async () => resultadoIA({ tipo_requisicao: 'precatorio', status_precatorio: 'incluido_fila' });
  const r = await chamar('POST', `/api/processos/${PID}/classificar`, TOKENS.master);
  assert.equal(r.status, 200);
  const up = updateDeClassificacao(escritas);
  assert.deepEqual([up.params[P_TIPO], up.params[P_RPV], up.params[P_PREC], up.params[P_ALV]], [null, null, null, null]);
  ai.classificar = iaProibida;
});

// ── 5) o lote também preserva o manual e conta resposta ilegível como erro ───────────────────
test('classificar-lote (master): resposta ilegível vira erro contado e sem UPDATE; a outra é gravada sem rebaixar', async () => {
  const P1 = { id: PID, numero: 'proc-ilegivel', tribunal: 'TJPB', situacao_atual: 'x', etapa_atual: 'y', produto_nome: 'FGTS' };
  const P2 = { id: '33333333-3333-4333-8333-333333333333', numero: 'proc-ok', tribunal: 'TJPB', situacao_atual: 'x', etapa_atual: 'y', produto_nome: 'FGTS' };
  const escritas = [];
  usarBanco({
    async query(sql) { return sql.includes('LIMIT 500') ? [P1, P2] : []; },
    async queryOne(sql, params) {
      if (sql.includes('SELECT tipo_requisicao')) return processoBase({ id: params[0] }); // RPV expedida manual
      throw new Error(`queryOne inesperada: ${sql.slice(0, 60)}`);
    },
    async execute(sql, params) { escritas.push({ sql, params }); return { rowCount: 1 }; },
  });
  ai.classificar = async (dados) => dados.numero === 'proc-ilegivel'
    ? null
    : resultadoIA({ tipo_requisicao: 'a_definir', status_rpv: 'nao_iniciado' });

  gravacoesRedis.length = 0;
  const r = await chamar('POST', '/api/processos/classificar-lote', TOKENS.master);
  assert.equal(r.status, 200);
  assert.equal(r.corpo.ok, true);

  const inicio = Date.now();
  let final;
  while (!(final = gravacoesRedis.map(g => g.estado).find(e => e.rodando === false && e.finalizado_em))) {
    if (Date.now() - inicio > 10_000) assert.fail('lote não terminou');
    await new Promise(res => setTimeout(res, 20));
  }
  assert.equal(final.erros, 1);
  assert.equal(final.ok, 1);
  assert.match(final.ultimo_erro, /proc-ilegivel: A IA não devolveu uma classificação utilizável/);

  const updates = escritas.filter(e => e.sql.includes("classificado_por = 'claude'"));
  assert.equal(updates.length, 1, 'só o processo legível é gravado');
  assert.equal(updates[0].params[9], P2.id);
  assert.equal(updates[0].params[P_TIPO], null);
  assert.equal(updates[0].params[P_RPV], null);
  ai.classificar = iaProibida;
});
