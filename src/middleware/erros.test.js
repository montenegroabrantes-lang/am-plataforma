import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import 'express-async-errors'; // igual ao index.js: sem isto, erro de rota async penduraria a requisição

// S-22 — erro interno sem a mensagem crua, com código de correlação; erro de entrada (JSON quebrado)
// continua 400 com mensagem clara; tabelas de filtro só aceitam chaves próprias.
// Nada aqui toca banco ou rede externa: o banco é uma dublê que recusa qualquer consulta inesperada.

const { db } = await import('../db/index.js');
for (const metodo of ['query', 'queryOne', 'execute']) {
  db[metodo] = async () => { throw new Error('banco real proibido nos testes'); };
}

const { tratadorGlobalDeErros, erroInterno, responderErro, limparParaLog, gerarCodigoErro } = await import('./erros.js');
const { daTabela } = await import('../utils/tabelaSegura.js');
const { tarefasRouter } = await import('../routes/tarefas.js');
const { processosRouter } = await import('../routes/processos.js');

const CPF_FICTICIO = '529.982.247-25';
const EMAIL_FICTICIO = 'maria.teste@exemplo.invalid';

let servidor, base, saidaDoLog;
const consoleErrorOriginal = console.error;

before(async () => {
  const app = express();
  app.use(express.json({ limit: '50b' }));
  app.use((req, _res, next) => { req.user = { id: 'u-teste', perfil: 'master', pode_marcar_restrito: false }; next(); });

  // Erro do Postgres com dado pessoal na mensagem (é o que a rota cru devolvia).
  app.get('/explode-pg', () => {
    const e = new Error(`duplicate key value violates unique constraint "clientes_cpf_key" -- Key (cpf)=(${CPF_FICTICIO}) de ${EMAIL_FICTICIO}`);
    e.code = '23505';
    e.constraint = 'clientes_cpf_key';
    throw e;
  });
  app.get('/explode-async', async () => { throw new Error('falha interna qualquer'); });
  app.get('/catch-da-rota', (req, res) => {
    try { throw new Error('senha do banco: hunter2'); } catch (e) { erroInterno(res, e); }
  });
  app.get('/erro-de-negocio', (req, res) => responderErro(res, Object.assign(new Error('Onboarding não encontrado.'), { status: 404 })));
  app.get('/erro-inesperado', (req, res) => responderErro(res, new Error('relation "x" does not exist')));
  app.post('/json', (req, res) => res.json({ ok: true, recebido: req.body }));

  app.use('/api/tarefas', tarefasRouter);
  app.use('/api/processos', processosRouter);
  app.use(tratadorGlobalDeErros);

  servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  console.error = consoleErrorOriginal;
  await new Promise(r => servidor.close(r));
});

beforeEach(() => {
  saidaDoLog = [];
  console.error = (...args) => { saidaDoLog.push(args.join(' ')); };
});

const pegar = async (caminho) => {
  const r = await fetch(`${base}${caminho}`);
  return { status: r.status, corpo: await r.json() };
};

const CODIGO_RE = /^Erro interno\. Código [0-9A-F]{8}\.$/;

test('erro do Postgres vira 500 genérico com código, sem a mensagem crua nem dado pessoal', async () => {
  const { status, corpo } = await pegar('/explode-pg');
  assert.equal(status, 500);
  assert.equal(corpo.ok, false);
  assert.match(corpo.erro, CODIGO_RE);
  for (const vazou of ['duplicate key', 'clientes_cpf_key', CPF_FICTICIO, EMAIL_FICTICIO]) {
    assert.equal(JSON.stringify(corpo).includes(vazou), false, `a resposta não pode conter "${vazou}"`);
  }
});

test('o mesmo código aparece no log, com o detalhe do erro e SEM CPF nem e-mail', async () => {
  const { corpo } = await pegar('/explode-pg');
  const codigo = corpo.erro.match(/Código ([0-9A-F]{8})/)[1];
  const linha = saidaDoLog.find(l => l.includes(`codigo=${codigo}`));
  assert.ok(linha, 'o log precisa ter a linha com o código da resposta');
  assert.match(linha, /code=23505/);
  assert.match(linha, /constraint=clientes_cpf_key/);
  assert.match(linha, /duplicate key value/);
  assert.equal(linha.includes(CPF_FICTICIO), false, 'CPF fora do log');
  assert.equal(linha.replace(/\D/g, '').includes('52998224725'), false, 'CPF fora do log, mesmo sem pontuação');
  assert.equal(linha.includes(EMAIL_FICTICIO), false, 'e-mail fora do log');
  assert.match(linha, /\[cpf\]/);
  assert.match(linha, /\[email\]/);
});

test('rota async que lança (express-async-errors) também recebe o erro genérico', async () => {
  const app = express();
  app.get('/x', (req, res, next) => Promise.reject(new Error('detalhe interno')).catch(next));
  app.use(tratadorGlobalDeErros);
  const s = http.createServer(app);
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  try {
    const r = await fetch(`http://127.0.0.1:${s.address().port}/x`);
    const corpo = await r.json();
    assert.equal(r.status, 500);
    assert.match(corpo.erro, CODIGO_RE);
    assert.equal(JSON.stringify(corpo).includes('detalhe interno'), false);
  } finally { await new Promise(r => s.close(r)); }
});

test('erroInterno() nos blocos catch das rotas: 500 com código, mensagem só no log', async () => {
  const { status, corpo } = await pegar('/catch-da-rota');
  assert.equal(status, 500);
  assert.match(corpo.erro, CODIGO_RE);
  assert.equal(JSON.stringify(corpo).includes('hunter2'), false);
  assert.ok(saidaDoLog.some(l => l.includes('hunter2')), 'o detalhe fica no log do servidor');
});

test('responderErro(): erro de negócio (com status) mantém a mensagem; erro inesperado vira genérico', async () => {
  const negocio = await pegar('/erro-de-negocio');
  assert.equal(negocio.status, 404);
  assert.equal(negocio.corpo.erro, 'Onboarding não encontrado.');

  const inesperado = await pegar('/erro-inesperado');
  assert.equal(inesperado.status, 500);
  assert.match(inesperado.corpo.erro, CODIGO_RE);
  assert.equal(JSON.stringify(inesperado.corpo).includes('does not exist'), false);
});

test('JSON inválido no corpo → 400 com mensagem clara (antes respondia 500)', async () => {
  const r = await fetch(`${base}/json`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
  const corpo = await r.json();
  assert.equal(r.status, 400);
  assert.equal(corpo.ok, false);
  assert.match(corpo.erro, /JSON/);
  assert.equal(saidaDoLog.length, 0, 'erro do cliente não vai para o log de erros internos');
});

test('corpo grande demais → 413 com mensagem clara', async () => {
  const r = await fetch(`${base}/json`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ texto: 'x'.repeat(500) }) });
  const corpo = await r.json();
  assert.equal(r.status, 413);
  assert.match(corpo.erro, /grande demais/);
});

test('JSON válido continua funcionando', async () => {
  const r = await fetch(`${base}/json`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).recebido, { a: 1 });
});

test('cada erro recebe um código diferente', () => {
  const codigos = new Set(Array.from({ length: 200 }, gerarCodigoErro));
  assert.ok(codigos.size > 190);
  for (const c of codigos) assert.match(c, /^[0-9A-F]{8}$/);
});

test('limparParaLog tira CPF (com e sem pontuação), e-mail e telefone e preserva o resto', () => {
  const limpo = limparParaLog(`erro em ${CPF_FICTICIO} / 52998224725 / ${EMAIL_FICTICIO} / (83) 99999-1234 / 5583999991234 / tabela clientes`);
  assert.equal(/\d{5}-?\d{4}/.test(limpo), false);
  assert.equal(limpo.includes('@'), false);
  assert.match(limpo, /tabela clientes/);
});

// ── Object.hasOwn nas tabelas de filtro ──

test('daTabela: só chaves próprias (constructor, __proto__, toString e afins não passam)', () => {
  const tabela = { minha: 'A', equipe: 'B' };
  assert.equal(daTabela(tabela, 'minha'), 'A');
  for (const chave of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'inexistente', '', undefined, null, ['minha'], { minha: 1 }]) {
    assert.equal(daTabela(tabela, chave), undefined, String(chave));
  }
});

test('Tarefas: ?fila=constructor e ?fila=__proto__ → 400 (não chama Object() nem quebra com 500)', async () => {
  for (const fila of ['constructor', '__proto__', 'toString']) {
    const lista = await pegar(`/api/tarefas?fila=${fila}`);
    assert.equal(lista.status, 400, `lista ${fila}`);
    assert.equal(lista.corpo.erro, 'Fila de tarefas inválida.');
    const resumo = await pegar(`/api/tarefas/resumo-teses?fila=${fila}`);
    assert.equal(resumo.status, 400, `resumo ${fila}`);
    assert.equal(resumo.corpo.erro, 'Fila de tarefas inválida.');
  }
});

test('Tarefas: triagem_motivo, origem e horizonte herdados do Object → 400 antes de virar SQL', async () => {
  assert.equal((await pegar('/api/tarefas?fila=triagem&triagem_motivo=constructor')).corpo.erro, 'Motivo de triagem inválido.');
  assert.equal((await pegar('/api/tarefas?fila=minha&origem=constructor')).corpo.erro, 'Origem de tarefa inválida.');
  assert.equal((await pegar('/api/tarefas?fila=minha&horizonte=__proto__')).corpo.erro, 'Período de tarefa inválido.');
  assert.equal((await pegar('/api/tarefas/resumo-teses?fila=minha&origem=constructor')).corpo.erro, 'Origem de tarefa inválida.');
  assert.equal((await pegar('/api/tarefas/resumo-teses?fila=minha&horizonte=toString')).corpo.erro, 'Período de tarefa inválido.');
});

test('Processos: ?periodo=constructor e ?etapa=__proto__ não viram SQL ("function Object...")', async () => {
  const consultas = [];
  db.query = async (sql, params) => { consultas.push({ sql, params }); return /COUNT\(\*\)/.test(sql) ? [{ total: 0 }] : []; };
  try {
    const r = await pegar('/api/processos?periodo=constructor&etapa=__proto__');
    assert.equal(r.status, 200);
    assert.ok(consultas.length >= 1);
    for (const { sql } of consultas) {
      assert.equal(/native code|function Object|\[object/.test(sql), false, 'nenhum código de função no SQL');
    }
    // a etapa desconhecida cai no ramo "etapa customizada" (parâmetro), que é o comportamento correto
    assert.ok(consultas[0].params.includes('__proto__'));
    assert.equal(/p\.etapa_atual = \$\d+/.test(consultas[0].sql), true);
  } finally {
    db.query = async () => { throw new Error('banco real proibido nos testes'); };
  }
});

test('Processos: filtro de período válido continua aplicando o SQL da tabela', async () => {
  const consultas = [];
  db.query = async (sql) => { consultas.push(sql); return /COUNT\(\*\)/.test(sql) ? [{ total: 0 }] : []; };
  try {
    await pegar('/api/processos?periodo=7d');
    assert.match(consultas[0], /INTERVAL '7 days'/);
  } finally {
    db.query = async () => { throw new Error('banco real proibido nos testes'); };
  }
});
