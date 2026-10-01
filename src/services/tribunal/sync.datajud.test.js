import test, { after, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// R-06 — captura de andamentos por número. Tudo com dublês: banco em memória (o que o sync usa de
// db), Redis em memória (lock) e o transporte HTTP do DataJud. Nenhuma rede, nenhum Redis, nenhuma IA.
process.env.REDIS_URL = 'redis://127.0.0.1:1';
process.env.ANTHROPIC_API_KEY = '';   // a IA de diagnóstico nunca pode chamar serviço externo aqui
process.env.OPENAI_API_KEY    = '';
const { db }    = await import('../../db/index.js');
const { redis } = await import('../../cache/redis.js');
const { transporte } = await import('./datajud.js');
const { sincronizarTodos, sincronizarProcesso } = await import('./sync.js');
const { SCRIPT_RENOVAR, SCRIPT_LIBERAR, CHAVE_LOCK_SYNC } = await import('./syncLock.js');
const { aiConfig } = await import('../../config/ai.js');

const avisos = [];
mock.method(console, 'log',   () => {});
mock.method(console, 'warn',  (...a) => { avisos.push(a.join(' ')); });
mock.method(console, 'error', (...a) => { avisos.push(a.join(' ')); });
after(() => redis.disconnect());

const postOriginal = transporte.post;
const esperarOriginal = transporte.esperar;
const dbOriginal = { query: db.query, queryOne: db.queryOne, execute: db.execute };
const redisOriginal = { set: redis.set, eval: redis.eval };
afterEach(() => {
  transporte.post = postOriginal; transporte.esperar = esperarOriginal;
  Object.assign(db, dbOriginal); Object.assign(redis, redisOriginal);
});

// ── dados fictícios ──────────────────────────────────────────────────────────

const CNJ  = (i) => `${String(i).padStart(7, '0')}-99.2026.8.15.0001`;
const PURO = (i) => `${String(i).padStart(7, '0')}9920268150001`;
const diasAtras = (d) => new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();

function novoProcesso(i, extra = {}) {
  return {
    id: `p${i}`, numero: CNJ(i), tribunal: 'TJPB', status: 'ativo',
    datajud_atualizado_em: null, sync_status: 'aguardando_primeira_captura', sync_falhas: 0, sync_fonte: null,
    ...extra,
  };
}
const nProcessos = (n, extra) => Array.from({ length: n }, (_, k) => novoProcesso(k + 1, extra));

function entrada(atualizado = '2026-09-29T10:00:00.000Z', movimentos) {
  return {
    atualizado,
    movimentos: movimentos ?? [{ codigo: 26, nome: 'Distribuição do processo', dataHora: '2026-08-01T10:00:00.000Z' }],
  };
}
function dataJudCom(indices, fazer = () => entrada()) {
  const m = new Map();
  for (const i of indices) m.set(PURO(i), fazer(i));
  return m;
}
const todos = (n) => Array.from({ length: n }, (_, k) => k + 1);

const ok   = (hits) => ({ status: 200, data: { hits: { total: { value: hits.length }, hits } } });
const http = (status, data = {}) => ({ status, data, headers: {} });

// ── o cenário: banco, Redis e DataJud de mentira ─────────────────────────────

function montarCenario({ processos, dataJud = new Map(), politica = async () => undefined, falhaInsercao = () => null } = {}) {
  const linhas = new Map(processos.map(p => [p.id, p]));
  const c = {
    linhas,
    dataJud,
    chamadasApi: [],
    esperas: [],
    execucoes: [],
    fechamentos: [],
    movs: new Set(),
    insertsMov: 0,
    updatesDados: 0,
    consultasIA: 0,
    updatesDiagnostico: 0,
    sqls: [],
    chaves: new Map(),       // Redis em memória
  };
  const chave = (r) => (r.datajud_atualizado_em ? new Date(r.datajud_atualizado_em).getTime() : -Infinity);

  // ── banco
  db.query = async (sql, params = []) => {
    c.sqls.push({ sql, params });
    if (/FROM processos\s+WHERE status IN/.test(sql)) {
      return [...linhas.values()]
        .filter(r => ['ativo', 'suspenso'].includes(r.status))
        .sort((a, b) => (chave(a) === chave(b) ? 0 : chave(a) < chave(b) ? -1 : 1))   // ORDER BY datajud_atualizado_em ASC NULLS FIRST
        .map(({ id, numero, tribunal, datajud_atualizado_em }) => ({ id, numero, tribunal, datajud_atualizado_em }));
    }
    if (/INSERT INTO movimentacoes/.test(sql)) {
      c.insertsMov++;
      const erro = falhaInsercao(params);
      if (erro) throw Object.assign(new Error(erro.mensagem || 'erro de gravação'), { code: erro.code });
      const k = `${params[0]}|${params[1].toISOString()}|${params[3]}`;
      if (c.movs.has(k)) return [];
      c.movs.add(k);
      return [{ id: `mov-${c.movs.size}` }];
    }
    if (/SELECT texto FROM movimentacoes/.test(sql)) return [];
    throw new Error(`query inesperada: ${sql}`);
  };
  db.queryOne = async (sql, params = []) => {
    c.sqls.push({ sql, params });
    if (/INSERT INTO sync_execucoes/.test(sql)) {
      const e = { id: `exec-${c.execucoes.length + 1}`, total: params[0] };
      c.execucoes.push(e);
      return { id: e.id };
    }
    if (/SELECT \* FROM processos WHERE id/.test(sql) || /FROM processos p\s+LEFT JOIN clientes/.test(sql)) {
      const r = linhas.get(params[0]);
      return r ? { ...r } : null;
    }
    if (/FROM movimentacoes m/.test(sql)) {           // bloco da IA: só chega aqui para andamento recente de processo já capturado
      c.consultasIA++;
      return { id: params[0], processo_id: 'p1', numero: CNJ(1), tribunal: 'TJPB', produto: null, data_movimentacao: new Date(), texto: 'Andamento fictício para diagnóstico' };
    }
    throw new Error(`queryOne inesperada: ${sql}`);
  };
  db.execute = async (sql, params = []) => {
    c.sqls.push({ sql, params });
    const r = (id) => linhas.get(id);
    if (/UPDATE sync_execucoes/.test(sql)) {
      const comMetricas = /status_http/.test(sql);
      c.fechamentos.push({
        id: params[comMetricas ? 7 : params.length - 1],
        via: params[0], falhas: params[1], novas: params[2], erro: params[3],
        statusHttp: comMetricas ? params[4] : undefined, hits: comMetricas ? params[5] : undefined, casados: comMetricas ? params[6] : undefined,
      });
      return { rowCount: 1 };
    }
    if (/UPDATE processos\s+SET vara/.test(sql)) { c.updatesDados++; return { rowCount: 1 }; }
    if (/UPDATE processos\s+SET sync_status = 'ok', sync_falhas = 0, atualizado_em = NOW\(\)/.test(sql)) {      // sucesso de verdade
      const p = r(params[0]);
      p.sync_status = 'ok'; p.sync_falhas = 0;
      p.datajud_atualizado_em = params[1] || p.datajud_atualizado_em || (/COALESCE\(\$2, datajud_atualizado_em, NOW\(\)\)/.test(sql) ? new Date() : null);   // COALESCE($2, marca, NOW())
      return { rowCount: 1 };
    }
    if (/UPDATE processos SET sync_status = 'ok', sync_falhas = 0, sync_fonte = 'datajud'/.test(sql)) {           // consulta ok, nada novo
      const p = r(params[0]);
      if (p.sync_status !== 'ok' || p.sync_falhas !== 0 || p.sync_fonte !== 'datajud') { p.sync_status = 'ok'; p.sync_falhas = 0; p.sync_fonte = 'datajud'; }
      return { rowCount: 1 };
    }
    if (/UPDATE processos SET sync_fonte/.test(sql)) { r(params[0]).sync_fonte = params.length === 2 ? params[0] : 'datajud'; return { rowCount: 1 }; }
    if (/UPDATE processos SET sync_falhas = 0, sync_status = 'aguardando_primeira_captura'/.test(sql)) {           // não encontrado
      const p = r(params[0]);
      if (p.sync_fonte === null && (p.sync_status !== 'aguardando_primeira_captura' || p.sync_falhas !== 0)) { p.sync_falhas = 0; p.sync_status = 'aguardando_primeira_captura'; }
      return { rowCount: 1 };
    }
    if (/SET sync_falhas = COALESCE\(sync_falhas, 0\) \+ 1/.test(sql)) {                                            // falha
      const p = r(params[0]);
      p.sync_falhas = (p.sync_falhas || 0) + 1;
      if (p.sync_falhas >= 3) p.sync_status = 'erro_sync';
      return { rowCount: 1 };
    }
    if (/UPDATE movimentacoes SET/.test(sql)) { c.updatesDiagnostico++; return { rowCount: 1 }; }
    throw new Error(`execute inesperado: ${sql}`);
  };

  // ── Redis: SET NX EX e os dois scripts do lock
  redis.set = async (k, v, ...args) => {
    if (args.includes('NX') && c.chaves.has(k)) return null;
    c.chaves.set(k, v);
    return 'OK';
  };
  redis.eval = async (script, _n, k, token) => {
    if (script === SCRIPT_RENOVAR) return c.chaves.get(k) === token ? 1 : 0;
    if (script === SCRIPT_LIBERAR) { if (c.chaves.get(k) === token) { c.chaves.delete(k); return 1; } return 0; }
    throw new Error('script desconhecido');
  };

  // ── DataJud
  transporte.esperar = async (ms) => { c.esperas.push(ms); };
  const docDe = (n) => {
    const e = c.dataJud.get(n);
    return { _source: {
      numeroProcesso: n, dataHoraUltimaAtualizacao: e.atualizado,
      classe: { codigo: 12078, nome: 'Cumprimento de Sentença' }, orgaoJulgador: { nome: 'Vara Fictícia' },
      movimentos: e.movimentos,
    } };
  };
  transporte.post = async (indice, body) => {
    c.chamadasApi.push({ indice, body });
    const sobrescrita = await politica(c.chamadasApi.length, body);
    if (sobrescrita instanceof Error) throw sobrescrita;
    if (sobrescrita) return sobrescrita;
    if (body.query.terms) return ok(body.query.terms.numeroProcesso.filter(n => c.dataJud.has(n)).map(docDe));
    if (body.query.match) { const n = body.query.match.numeroProcesso; return ok(c.dataJud.has(n) ? [docDe(n)] : []); }
    throw new Error('consulta inesperada');
  };
  return c;
}

const contarPorTerms = (c) => c.chamadasApi.filter(x => x.body.query.terms);
const ultimoFechamento = (c) => c.fechamentos[c.fechamentos.length - 1];

beforeEach(() => { avisos.length = 0; });

// ── segurança do próprio teste ───────────────────────────────────────────────

test('precondição: nenhuma chave de IA neste ambiente de teste (a IA não pode chamar serviço externo)', () => {
  assert.ok(!aiConfig.claude.apiKey);
  assert.ok(!aiConfig.openai.apiKey);
});

// ── lote de 100 ──────────────────────────────────────────────────────────────

test('lote de 100: 250 processos viram 3 consultas (100, 100 e 50), terms em numeroProcesso, sem varrer o tribunal', async () => {
  const c = montarCenario({ processos: nProcessos(250), dataJud: dataJudCom(todos(250)) });
  const resultados = await sincronizarTodos();

  const consultas = contarPorTerms(c);
  assert.deepEqual(consultas.map(x => x.body.query.terms.numeroProcesso.length), [100, 100, 50]);
  assert.equal(c.chamadasApi.length, 3);
  assert.ok(c.chamadasApi.every(x => x.indice === 'api_publica_tjpb'));
  assert.doesNotMatch(JSON.stringify(c.chamadasApi.map(x => x.body)), /range|dataHoraUltimaAtualizacao/);

  assert.equal(resultados.length, 250);
  assert.ok(resultados.every(r => r.ok));
  const f = ultimoFechamento(c);
  assert.deepEqual(
    { via: f.via, falhas: f.falhas, novas: f.novas, erro: f.erro, statusHttp: f.statusHttp, hits: f.hits, casados: f.casados },
    { via: 250, falhas: 0, novas: 250, erro: null, statusHttp: 200, hits: 250, casados: 250 },
  );
  assert.ok([...c.linhas.values()].every(p => p.sync_status === 'ok' && p.datajud_atualizado_em));
  assert.equal(c.chaves.has(CHAVE_LOCK_SYNC), false, 'lock liberado no fim');
});

test('os nunca capturados e mais atrasados entram primeiro nos lotes', async () => {
  const antigos = nProcessos(100).map(p => ({ ...p, datajud_atualizado_em: new Date('2026-09-01T00:00:00Z') }));
  const novos = [novoProcesso(101), novoProcesso(102)];
  const c = montarCenario({ processos: [...antigos, ...novos], dataJud: dataJudCom(todos(102)) });
  await sincronizarTodos();
  const primeiroLote = contarPorTerms(c)[0].body.query.terms.numeroProcesso;
  assert.ok(primeiroLote.includes(PURO(101)) && primeiroLote.includes(PURO(102)));
});

// ── 429 na 1ª página ─────────────────────────────────────────────────────────

test('429 na 1ª página: NÃO vira "nada mudou" — todos os processos do lote contam FALHA, a marca não avança e o status HTTP fica gravado', async () => {
  const c = montarCenario({
    processos: nProcessos(150),
    dataJud: dataJudCom(todos(150)),
    politica: async () => http(429, { error: 'Too Many Requests' }),
  });
  const resultados = await sincronizarTodos();

  assert.equal(resultados.length, 150);
  assert.ok(resultados.every(r => !r.ok));
  const f = ultimoFechamento(c);
  assert.equal(f.falhas, 150);
  assert.equal(f.via, 0);
  assert.equal(f.casados, 0);
  assert.equal(f.hits, 0);
  assert.equal(f.statusHttp, 429);
  assert.equal(f.erro, null, 'não é erro fatal: a execução terminou, com falhas');
  assert.ok([...c.linhas.values()].every(p => p.datajud_atualizado_em === null), 'a marca de nenhum processo avançou');
  assert.ok([...c.linhas.values()].every(p => p.sync_falhas === 1), 'cada um conta 1 falha');
  assert.equal(c.insertsMov, 0);
  assert.equal(c.chamadasApi.length, 8, '2 lotes x 4 tentativas — e para: não repete a mesma página para sempre');
  assert.equal(c.chaves.has(CHAVE_LOCK_SYNC), false);
});

test('disjuntor: com o tribunal fora do ar, para depois de 3 lotes seguidos sem resposta (não gasta 9 lotes x 65 s) e conta o resto como falha', async () => {
  const c = montarCenario({ processos: nProcessos(350), dataJud: dataJudCom(todos(350)), politica: async () => http(503) });
  const resultados = await sincronizarTodos();
  assert.equal(c.chamadasApi.length, 12, '3 lotes x 4 tentativas; o 4º lote nem foi consultado');
  assert.equal(resultados.filter(r => !r.ok).length, 350);
  assert.equal(ultimoFechamento(c).falhas, 350);
  assert.equal(ultimoFechamento(c).statusHttp, 503);
  assert.match(resultados[349].erro, /não consultado/);
});

test('timeout sem resposta nenhuma: falha, com status_http nulo', async () => {
  const c = montarCenario({
    processos: nProcessos(5), dataJud: dataJudCom(todos(5)),
    politica: async () => Object.assign(new Error('timeout of 35000ms exceeded'), { code: 'ECONNABORTED' }),
  });
  await sincronizarTodos();
  const f = ultimoFechamento(c);
  assert.equal(f.falhas, 5);
  assert.equal(f.statusHttp, null);
  assert.equal(f.casados, 0);
});

// ── 429 no meio ──────────────────────────────────────────────────────────────

test('429 no MEIO: só o lote afetado falha, os outros são capturados e a execução termina (não repete a página para sempre)', async () => {
  const c = montarCenario({
    processos: nProcessos(300),
    dataJud: dataJudCom(todos(300)),
    // o 2º lote (processos 101 a 200) leva 429 sempre; ordem dos lotes = ordem de id, pois todos são "nunca capturados"
    politica: async (_n, body) => (body.query.terms.numeroProcesso.includes(PURO(150)) ? http(429) : undefined),
  });
  const resultados = await sincronizarTodos();

  assert.equal(c.chamadasApi.length, 1 + 4 + 1);
  assert.equal(resultados.filter(r => r.ok).length, 200);
  assert.equal(resultados.filter(r => !r.ok).length, 100);
  const f = ultimoFechamento(c);
  assert.equal(f.casados, 200);
  assert.equal(f.falhas, 100);
  assert.equal(f.statusHttp, 429, 'o status ruim prevalece sobre o 200 dos outros lotes');

  for (let i = 1; i <= 300; i++) {
    const p = c.linhas.get(`p${i}`);
    if (i > 100 && i <= 200) { assert.equal(p.datajud_atualizado_em, null); assert.equal(p.sync_falhas, 1); }
    else { assert.ok(p.datajud_atualizado_em); assert.equal(p.sync_status, 'ok'); }
  }
});

// ── a "janela" não avança com falha ──────────────────────────────────────────

test('janela que não avança: o que falhou volta na execução seguinte e é capturado quando a API se recupera; o sucesso zera sync_falhas', async () => {
  let apiSaudavel = false;
  const c = montarCenario({
    processos: nProcessos(300),
    dataJud: dataJudCom(todos(300)),
    politica: async (_n, body) => (!apiSaudavel && body.query.terms.numeroProcesso.includes(PURO(150)) ? http(429) : undefined),
  });
  await sincronizarTodos();                                   // execução 1: lote do meio falha
  assert.equal(c.linhas.get('p150').datajud_atualizado_em, null);
  assert.equal(c.linhas.get('p150').sync_falhas, 1);

  apiSaudavel = true;
  c.chamadasApi.length = 0;
  c.insertsMov = 0;
  await sincronizarTodos();                                   // execução 2: a API voltou

  // a consulta seguinte pediu de novo os que falharam — e antes dos que já estavam em dia
  const primeiro = contarPorTerms(c)[0].body.query.terms.numeroProcesso;
  assert.equal(primeiro.length, 100);
  assert.ok(primeiro.includes(PURO(150)));
  // capturou-os: marca gravada, contador zerado, status ok
  const p150 = c.linhas.get('p150');
  assert.ok(p150.datajud_atualizado_em);
  assert.equal(p150.sync_falhas, 0);
  assert.equal(p150.sync_status, 'ok');
  assert.equal(c.insertsMov, 100, 'só os 100 que faltavam gravaram andamentos; os outros 200 estavam em dia');
  const f = ultimoFechamento(c);
  assert.equal(f.falhas, 0);
  assert.equal(f.casados, 300);
  assert.equal(f.statusHttp, 200);
});

test('sucesso zera sync_falhas e tira o processo de erro_sync (os 811 "erro_sync" com 63 falhas se recuperam)', async () => {
  const c = montarCenario({
    processos: [novoProcesso(1, { sync_status: 'erro_sync', sync_falhas: 63, sync_fonte: 'datajud' })],
    dataJud: dataJudCom([1]),
  });
  await sincronizarTodos();
  const p = c.linhas.get('p1');
  assert.equal(p.sync_status, 'ok');
  assert.equal(p.sync_falhas, 0);
});

// ── processo que o DataJud não tem ───────────────────────────────────────────

test('processo que o DataJud não tem não é falha: nunca capturado sai do erro_sync e volta a "aguardando primeira captura"; capturado antes fica como está', async () => {
  const c = montarCenario({
    processos: [
      novoProcesso(1, { sync_status: 'erro_sync', sync_falhas: 63, sync_fonte: null }),
      novoProcesso(2, { sync_status: 'erro_sync', sync_falhas: 63, sync_fonte: 'datajud' }),
      novoProcesso(3),
    ],
    dataJud: dataJudCom([3]),          // 1 e 2 o DataJud não devolve
  });
  const resultados = await sincronizarTodos();
  assert.deepEqual(resultados.map(r => r.processoId), ['p3'], 'só o que foi capturado entra nos resultados; não há falha');
  const f = ultimoFechamento(c);
  assert.equal(f.falhas, 0);
  assert.equal(f.casados, 1);
  assert.equal(f.hits, 1);

  assert.equal(c.linhas.get('p1').sync_status, 'aguardando_primeira_captura');
  assert.equal(c.linhas.get('p1').sync_falhas, 0);
  assert.equal(c.linhas.get('p2').sync_status, 'erro_sync', 'já capturado antes: não se mexe');
  assert.equal(c.linhas.get('p2').sync_falhas, 63);
});

test('resposta parcial (429 com processos no corpo): os que vieram são gravados; os que faltam contam como FALHA, não como "não existe"', async () => {
  const c = montarCenario({
    processos: nProcessos(2),
    dataJud: dataJudCom([1]),
    politica: async () => http(429, { hits: { hits: [{ _source: { numeroProcesso: PURO(1), dataHoraUltimaAtualizacao: '2026-09-29T10:00:00.000Z', movimentos: [] } }] } }),
  });
  const resultados = await sincronizarTodos();
  assert.equal(resultados.find(r => r.processoId === 'p1').ok, true);
  assert.equal(resultados.find(r => r.processoId === 'p2').ok, false);
  assert.equal(c.linhas.get('p1').sync_status, 'ok');
  assert.equal(c.linhas.get('p2').sync_falhas, 1);
  assert.equal(ultimoFechamento(c).statusHttp, 429);
});

test('número fora do padrão CNJ não entra nos lotes nem conta como falha', async () => {
  const c = montarCenario({
    processos: [novoProcesso(1), novoProcesso(2, { numero: '12345' })],
    dataJud: dataJudCom([1]),
  });
  const resultados = await sincronizarTodos();
  assert.equal(contarPorTerms(c)[0].body.query.terms.numeroProcesso.length, 1);
  assert.equal(resultados.length, 1);
  assert.equal(ultimoFechamento(c).falhas, 0);
  assert.ok(avisos.some(a => /fora do padrão CNJ/.test(a)));
});

// ── só regrava o que mudou ───────────────────────────────────────────────────

test('compara com a marca gravada: sem mudança no DataJud não regrava nada; com mudança grava só o que é novo', async () => {
  const c = montarCenario({ processos: nProcessos(3), dataJud: dataJudCom(todos(3)) });
  await sincronizarTodos();                                                  // 1ª: captura tudo
  assert.equal(c.insertsMov, 3);

  c.insertsMov = 0; c.updatesDados = 0;
  await sincronizarTodos();                                                  // 2ª: nada mudou no DataJud
  assert.equal(c.insertsMov, 0, 'nenhum andamento regravado');
  assert.equal(c.updatesDados, 0, 'nenhum dado do processo regravado');
  assert.equal(ultimoFechamento(c).casados, 3, 'mas os 3 foram reconhecidos');
  assert.equal(ultimoFechamento(c).falhas, 0);
  assert.ok([...c.linhas.values()].every(p => p.sync_status === 'ok'));

  // o DataJud atualiza o processo 2 (marca nova + 1 andamento novo)
  c.dataJud.set(PURO(2), entrada('2026-09-30T09:00:00.000Z', [
    { codigo: 26, nome: 'Distribuição do processo', dataHora: '2026-08-01T10:00:00.000Z' },
    { codigo: 123, nome: 'Juntada de petição de cumprimento', dataHora: '2026-09-30T08:00:00.000Z' },
  ]));
  c.insertsMov = 0;
  const resultados = await sincronizarTodos();                               // 3ª
  assert.equal(c.insertsMov, 2, 'só o processo que mudou foi regravado (2 andamentos, 1 já existia)');
  assert.equal(resultados.find(r => r.processoId === 'p2').novasMovimentacoes, 1);
  assert.equal(ultimoFechamento(c).novas, 1);
  assert.equal(c.linhas.get('p2').datajud_atualizado_em.toISOString(), '2026-09-30T09:00:00.000Z');
});

test('consulta ok sem novidade também limpa o erro_sync de um processo que estava em erro e já tem a marca em dia', async () => {
  const c = montarCenario({
    processos: [novoProcesso(1, { datajud_atualizado_em: new Date('2026-09-29T10:00:00.000Z'), sync_status: 'erro_sync', sync_falhas: 5, sync_fonte: 'datajud' })],
    dataJud: dataJudCom([1]),      // mesma marca do que já está gravado
  });
  await sincronizarTodos();
  assert.equal(c.insertsMov, 0);
  assert.equal(c.linhas.get('p1').sync_status, 'ok');
  assert.equal(c.linhas.get('p1').sync_falhas, 0);
});

// ── gravação que falha não perde andamento ───────────────────────────────────

test('erro ao gravar um andamento (que não seja duplicata) NÃO avança a marca: o processo conta falha e volta na próxima execução', async () => {
  let quebrar = true;
  const c = montarCenario({
    processos: nProcessos(2),
    dataJud: dataJudCom(todos(2)),
    falhaInsercao: (params) => (quebrar && params[0] === 'p1' ? { code: '40P01', mensagem: 'deadlock detected' } : null),
  });
  const r1 = await sincronizarTodos();
  assert.equal(r1.find(r => r.processoId === 'p1').ok, false);
  assert.equal(r1.find(r => r.processoId === 'p2').ok, true);
  assert.equal(c.linhas.get('p1').datajud_atualizado_em, null, 'a marca não avançou');
  assert.equal(c.linhas.get('p1').sync_falhas, 1);
  assert.equal(c.linhas.get('p2').sync_status, 'ok');

  quebrar = false;
  await sincronizarTodos();
  assert.ok(c.linhas.get('p1').datajud_atualizado_em, 'na execução seguinte o andamento foi gravado e a marca avançou');
  assert.equal(c.linhas.get('p1').sync_falhas, 0);
});

test('violação de unicidade (23505) é duplicata inofensiva: não conta como falha', async () => {
  const c = montarCenario({
    processos: nProcessos(1),
    dataJud: dataJudCom([1]),
    falhaInsercao: () => ({ code: '23505', mensagem: 'duplicate key value' }),
  });
  const r = await sincronizarTodos();
  assert.equal(r[0].ok, true);
  assert.ok(c.linhas.get('p1').datajud_atualizado_em);
});

test('andamento com data impossível (ex.: mês 13) é descartado, não conta como falha de gravação nem trava a marca', async () => {
  const c = montarCenario({
    processos: nProcessos(1),
    dataJud: dataJudCom([1], () => entrada('2026-09-30T09:00:00.000Z', [
      { codigo: 1, nome: 'Andamento com data impossível no tribunal', dataHora: '2026-13-45T10:00:00.000Z' },
      { codigo: 2, nome: 'Andamento normal de um mês atrás', dataHora: diasAtras(30) },
    ])),
  });
  const r = await sincronizarTodos();
  assert.equal(r[0].ok, true);
  assert.equal(r[0].novasMovimentacoes, 1);
  assert.equal(c.insertsMov, 1, 'a data inválida nem chegou ao banco');
  assert.ok(c.linhas.get('p1').datajud_atualizado_em);
});

test('DataJud sem dataHoraUltimaAtualizacao: a marca avança mesmo assim (senão o processo ficaria em backfill para sempre, sem IA nem alerta)', async () => {
  const c = montarCenario({
    processos: nProcessos(1),
    dataJud: dataJudCom([1], () => entrada(null, [{ codigo: 2, nome: 'Andamento de um mês atrás', dataHora: diasAtras(30) }])),
  });
  await sincronizarTodos();
  assert.ok(c.linhas.get('p1').datajud_atualizado_em, '1ª captura grava alguma marca');
  assert.equal(c.consultasIA, 0, 'a 1ª captura continua sem IA');

  // 2ª execução: já não é backfill, então o andamento recente vai para a IA
  c.dataJud.set(PURO(1), entrada(null, [{ codigo: 3, nome: 'Andamento recente de ontem', dataHora: diasAtras(1) }]));
  await sincronizarTodos();
  assert.equal(c.consultasIA, 1, 'o andamento de ontem foi para a IA na captura seguinte');
});

// ── backfill: sem IA e sem WhatsApp ──────────────────────────────────────────

test('backfill (1ª captura): grava andamentos antigos E recentes sem chamar a IA nem preparar WhatsApp CRÍTICO', async () => {
  const c = montarCenario({
    processos: nProcessos(3),
    dataJud: dataJudCom(todos(3), () => entrada('2026-09-30T09:00:00.000Z', [
      { codigo: 1, nome: 'Andamento de dois anos atrás', dataHora: diasAtras(700) },
      { codigo: 2, nome: 'Andamento de um mês atrás', dataHora: diasAtras(30) },
      { codigo: 3, nome: 'Andamento de ontem para conferir', dataHora: diasAtras(1) },
    ])),
  });
  const resultados = await sincronizarTodos();
  assert.equal(c.insertsMov, 9);
  assert.equal(resultados.reduce((s, r) => s + r.novasMovimentacoes, 0), 9, 'os andamentos foram gravados');
  assert.equal(c.consultasIA, 0, 'nenhum andamento foi para a IA (nem o de ontem: é a 1ª captura)');
  assert.equal(c.updatesDiagnostico, 0);
  assert.ok(avisos.every(a => !/\[IA\]|\[Alerta\]/.test(a)), 'nem tentativa de IA nem de alerta no log');
});

test('captura seguinte: só andamento recente (até 7 dias) vai para a IA; o antigo que aparecer agora é só gravado', async () => {
  const c = montarCenario({
    processos: [novoProcesso(1, { datajud_atualizado_em: new Date('2026-09-01T00:00:00Z'), sync_status: 'ok', sync_fonte: 'datajud' })],
    dataJud: dataJudCom([1], () => entrada('2026-09-30T09:00:00.000Z', [
      { codigo: 2, nome: 'Andamento antigo que só agora chegou', dataHora: diasAtras(60) },
      { codigo: 3, nome: 'Andamento recente de ontem', dataHora: diasAtras(1) },
    ])),
  });
  await sincronizarTodos();
  assert.equal(c.insertsMov, 2, 'os dois foram gravados');
  assert.equal(c.consultasIA, 1, 'só o de ontem foi para a IA');
  // sem chave configurada a IA falha em silêncio (como em produção hoje); nada externo foi chamado
  assert.ok(avisos.some(a => /\[IA\] Diagnóstico falhou/.test(a)));
});

// ── lock: dois syncs ao mesmo tempo ──────────────────────────────────────────

function portao() {
  let abrir;
  const promessa = new Promise(r => { abrir = r; });
  return { promessa, abrir };
}
const dormir = (ms) => new Promise(r => setTimeout(r, ms));
async function ate(condicao, ms = 2000) {
  const fim = Date.now() + ms;
  while (!condicao()) {
    if (Date.now() > fim) throw new Error('condição não atingida a tempo');
    await dormir(5);
  }
}

test('dois syncs simultâneos: o segundo é ignorado enquanto o primeiro roda; depois de terminar, o lock volta e um novo sync roda', async () => {
  const g = portao();
  const c = montarCenario({
    processos: nProcessos(3), dataJud: dataJudCom(todos(3)),
    politica: async () => { await g.promessa; return undefined; },     // a API "demora" até abrirmos o portão
  });

  const primeiro = sincronizarTodos();
  await ate(() => c.chamadasApi.length === 1);                          // o 1º está no meio da consulta, com o lock

  const segundo = await sincronizarTodos();
  assert.deepEqual(segundo, { ignorado: true, motivo: 'lock ativo' });
  assert.equal(c.execucoes.length, 1, 'o segundo nem abriu execução');
  assert.equal(c.chamadasApi.length, 1, 'nem consultou a API');
  assert.ok(c.chaves.has(CHAVE_LOCK_SYNC), 'o lock do primeiro segue de pé');

  g.abrir();
  const resultados = await primeiro;
  assert.equal(resultados.length, 3);
  assert.equal(c.chaves.has(CHAVE_LOCK_SYNC), false);

  const terceiro = await sincronizarTodos();                            // já com o lock livre
  assert.ok(Array.isArray(terceiro));
  assert.equal(c.execucoes.length, 2);
});

test('lock perdido no meio (outra execução o assumiu): o sync PARA no próximo ponto seguro, fecha a execução com o erro e não apaga o lock alheio', async () => {
  const g = portao();
  const c = montarCenario({
    processos: nProcessos(250), dataJud: dataJudCom(todos(250)),
    politica: async () => { await g.promessa; return undefined; },
  });
  const rodando = sincronizarTodos({ batimentoLockMs: 10 });
  const capturado = rodando.catch(e => e);                              // evita rejeição não tratada
  await ate(() => c.chamadasApi.length === 1);

  c.chaves.set(CHAVE_LOCK_SYNC, 'token-de-outra-execucao');            // ex.: o "forçar" antigo, ou o TTL vencido e outra execução entrou
  await ate(() => avisos.some(a => /Lock perdido/.test(a)));            // o batimento percebe
  g.abrir();

  const erro = await capturado;
  assert.ok(erro instanceof Error);
  assert.match(erro.message, /Lock do sync perdido/);
  assert.equal(c.chamadasApi.length, 1, 'não seguiu para o 2º lote');
  const f = ultimoFechamento(c);
  assert.match(f.erro, /Lock do sync perdido/);
  assert.ok(f.falhas >= 1);
  assert.equal(c.chaves.get(CHAVE_LOCK_SYNC), 'token-de-outra-execucao', 'o lock da outra execução não foi apagado');
});

// ── sync individual (botão "Sincronizar" e cadastro do processo) ─────────────

test('sync individual: grava a marca datajud_atualizado_em e trata a 1ª captura como backfill (sem IA)', async () => {
  const c = montarCenario({
    processos: [novoProcesso(1)],
    dataJud: dataJudCom([1], () => entrada('2026-09-30T09:00:00.000Z', [
      { codigo: 3, nome: 'Andamento de ontem para conferir', dataHora: diasAtras(1) },
    ])),
  });
  const r = await sincronizarProcesso('p1');
  assert.equal(r.novasMovimentacoes, 1);
  assert.equal(c.linhas.get('p1').datajud_atualizado_em.toISOString(), '2026-09-30T09:00:00.000Z');
  assert.equal(c.linhas.get('p1').sync_status, 'ok');
  assert.equal(c.consultasIA, 0);
});

test('sync individual: DataJud sobrecarregado (429 sempre) NÃO vira "processo não encontrado" — falha com a causa real, para o job tentar de novo', async () => {
  const c = montarCenario({ processos: [novoProcesso(1)], dataJud: dataJudCom([1]), politica: async () => http(429) });
  await assert.rejects(sincronizarProcesso('p1'), (err) => {
    assert.match(err.message, /sobrecarregado|429/);
    assert.doesNotMatch(err.message, /não encontrado/);
    return true;
  });
  assert.equal(c.linhas.get('p1').datajud_atualizado_em, null);
});

test('sync individual: processo que o DataJud realmente não tem continua dizendo "não encontrado"', async () => {
  montarCenario({ processos: [novoProcesso(1)], dataJud: new Map() });
  await assert.rejects(sincronizarProcesso('p1'), /não encontrado no DataJud/);
});

// ── a API recusa o lote ──────────────────────────────────────────────────────

test('se a API recusar a consulta em lote (400), o sync ainda captura, por número', async () => {
  const c = montarCenario({
    processos: nProcessos(3), dataJud: dataJudCom(todos(3)),
    politica: async (_n, body) => (body.query.terms ? http(400, { error: 'bad request' }) : undefined),
  });
  const resultados = await sincronizarTodos();
  assert.equal(resultados.filter(r => r.ok).length, 3);
  assert.equal(ultimoFechamento(c).casados, 3);
  assert.equal(ultimoFechamento(c).falhas, 0);
  assert.ok([...c.linhas.values()].every(p => p.datajud_atualizado_em));
});
