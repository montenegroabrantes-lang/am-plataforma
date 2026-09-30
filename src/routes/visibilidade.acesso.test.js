// S-21 — processo "restrito" nas rotas com id de processo e nas listagens: quem não é o Master 01
// recebe 404 (igual a um id inexistente) e NADA é lido nem gravado. Sem banco real, sem Redis e sem
// chamada externa: o db é um dublê que registra cada consulta.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import 'express-async-errors';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'segredo-de-teste';

const { db } = await import('../db/index.js');
let chamadas = [];
let regras = [];
function usarBanco(novas = []) {
  chamadas = [];
  regras = novas;
  const responder = (metodo) => async (sql, params) => {
    chamadas.push({ metodo, sql, params });
    const r = regras.find(x => x.metodo === metodo && x.quando.test(sql));
    if (!r) throw new Error(`${metodo} inesperada: ${sql.replace(/\s+/g, ' ').slice(0, 90)}`);
    return typeof r.resp === 'function' ? r.resp(sql, params) : r.resp;
  };
  db.query = responder('query'); db.queryOne = responder('queryOne'); db.execute = responder('execute');
}
usarBanco();
const regra = (metodo, quando, resp) => ({ metodo, quando, resp });
const gravacoes = () => chamadas.filter(c => c.metodo === 'execute' || (c.metodo === 'query' && /^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql)));

const { autenticar } = await import('../middleware/auth.js');
const { processosRouter } = await import('./processos.js');
const { movimentacoesRouter } = await import('./movimentacoes.js');
const { classificacoesRouter } = await import('./classificacoes.js');
const { agendaRouter } = await import('./agenda.js');
const { relatorioRouter } = await import('./relatorio.js');
const { clientesRouter } = await import('./clientes.js');

const app = express();
app.use(express.json());
app.use((req, _res, next) => { req._ip = '127.0.0.1'; next(); });
app.use('/api/processos', autenticar, processosRouter);
app.use('/api/movimentacoes', autenticar, movimentacoesRouter);
app.use('/api/classif', autenticar, classificacoesRouter);
app.use('/api/agenda', autenticar, agendaRouter);
app.use('/api/relatorio', autenticar, relatorioRouter);
app.use('/api/clientes', autenticar, clientesRouter);
app.use((err, _req, res, _next) => res.status(500).json({ ok: false, erro: err.message }));
const servidor = app.listen(0);
const base = `http://127.0.0.1:${servidor.address().port}`;
after(() => servidor.close());

const assinar = p => jwt.sign(p, process.env.JWT_SECRET, { expiresIn: '1h' });
const T = {
  master: assinar({ id: 'm1', perfil: 'master', email: 'master@exemplo.com' }),
  master01: assinar({ id: 'm0', perfil: 'master', email: 'dono@exemplo.com', pode_marcar_restrito: true }),
  junior: assinar({ id: 'j1', perfil: 'junior', email: 'junior@exemplo.com', master_id: 'm1' }),
};
async function chamar(metodo, caminho, token, corpo) {
  const r = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await r.text();
  let corpoResp; try { corpoResp = JSON.parse(texto); } catch { corpoResp = texto; }
  return { status: r.status, corpo: corpoResp, texto };
}

const PID = '11111111-1111-4111-8111-111111111111';
const CID = '22222222-2222-4222-8222-222222222222';
const AID = '33333333-3333-4333-8333-333333333333';
const NUMERO_SECRETO = '0800123-45.2024.8.15.2001';
const processo = (visibilidade) => ({ id: PID, numero: NUMERO_SECRETO, visibilidade, cliente_id: null, master_responsavel_id: 'm1', compartilhado: false, tribunal: 'TJPB', grau: '1' });
const soVisibilidade = (visibilidade) => regra('queryOne', /SELECT visibilidade FROM processos/, { visibilidade });
const nunca404 = (r) => assert.notEqual(r.status, 404, r.texto);
beforeEach(() => usarBanco());

// ───────────────────────────── processos: rotas com :id ─────────────────────────────
test('GET /processos/:id — restrito: Master comum e júnior recebem 404 (não 403), sem vazar o número; Master 01 lê', async () => {
  usarBanco([regra('queryOne', /SELECT p\.\*, c\.nome AS cliente_nome/, processo('restrito')), regra('query', /cessoes_credito|cliente_produtos/, [])]);
  for (const t of [T.master, T.junior]) {
    const r = await chamar('GET', `/api/processos/${PID}`, t);
    assert.equal(r.status, 404);
    assert.equal(r.corpo.erro, 'Processo não encontrado.');
    assert.ok(!r.texto.includes(NUMERO_SECRETO), 'a resposta não pode conter dados do processo');
  }
  const ok = await chamar('GET', `/api/processos/${PID}`, T.master01);
  assert.equal(ok.status, 200);
  assert.equal(ok.corpo.processo.numero, NUMERO_SECRETO);
});

test('GET /processos/:id — normal: júnior e Master comum leem normalmente', async () => {
  usarBanco([regra('queryOne', /SELECT p\.\*, c\.nome AS cliente_nome/, processo('normal')), regra('query', /cessoes_credito|cliente_produtos/, [])]);
  for (const t of [T.junior, T.master, T.master01]) assert.equal((await chamar('GET', `/api/processos/${PID}`, t)).status, 200);
});

test('PATCH /processos/:id — restrito: Master comum recebe 404 e nada é gravado; Master 01 grava', async () => {
  usarBanco([regra('queryOne', /SELECT master_responsavel_id, compartilhado, visibilidade, tribunal, grau/, processo('restrito')), regra('execute', /UPDATE processos/, { rowCount: 1 })]);
  const negado = await chamar('PATCH', `/api/processos/${PID}`, T.master, { notas: 'x' });
  assert.equal(negado.status, 404);
  assert.equal(gravacoes().length, 0);
  const ok = await chamar('PATCH', `/api/processos/${PID}`, T.master01, { notas: 'x' });
  assert.equal(ok.status, 200);
  assert.equal(gravacoes().length, 1);
});

test('PATCH /processos/:id — visibilidade fora de normal|restrito é 400 (antes virava erro cru do Postgres)', async () => {
  usarBanco([regra('queryOne', /SELECT master_responsavel_id, compartilhado, visibilidade/, processo('normal')), regra('execute', /UPDATE processos/, { rowCount: 1 })]);
  const r = await chamar('PATCH', `/api/processos/${PID}`, T.master01, { visibilidade: 'secreto' });
  assert.equal(r.status, 400);
  assert.equal(gravacoes().length, 0);
});

test('PATCH /processos/:id/urgente — o furo: restrito não pode ser marcado por Master comum nem por júnior', async () => {
  usarBanco([regra('queryOne', /SELECT master_responsavel_id, compartilhado, visibilidade FROM processos/, processo('restrito')), regra('execute', /UPDATE processos SET urgente/, { rowCount: 1 })]);
  for (const t of [T.master, T.junior]) {
    assert.equal((await chamar('PATCH', `/api/processos/${PID}/urgente`, t, { urgente: true })).status, 404);
  }
  assert.equal(gravacoes().length, 0);
  assert.equal((await chamar('PATCH', `/api/processos/${PID}/urgente`, T.master01, { urgente: true })).status, 200);
  assert.equal(gravacoes().length, 1);
});

test('PATCH /processos/:id/urgente — normal: júnior continua marcando (regra da matriz de hoje não muda aqui)', async () => {
  usarBanco([regra('queryOne', /SELECT master_responsavel_id, compartilhado, visibilidade FROM processos/, processo('normal')), regra('execute', /UPDATE processos SET urgente/, { rowCount: 1 })]);
  assert.equal((await chamar('PATCH', `/api/processos/${PID}/urgente`, T.junior, { urgente: true })).status, 200);
});

test('PATCH /processos/:id/situacao — restrito: 404 e nada gravado; Master 01 grava', async () => {
  usarBanco([regra('queryOne', /SELECT master_responsavel_id, compartilhado, situacao_atual/, processo('restrito')), regra('execute', /UPDATE processos SET/, { rowCount: 1 })]);
  const negado = await chamar('PATCH', `/api/processos/${PID}/situacao`, T.master, { urgente: true });
  assert.equal(negado.status, 404);
  assert.equal(gravacoes().length, 0);
  const ok = await chamar('PATCH', `/api/processos/${PID}/situacao`, T.master01, { urgente: true });
  assert.equal(ok.status, 200);
  assert.equal(gravacoes().length, 1);
});

test('POST /processos/:id/cessao — restrito: Master comum recebe 404 e nada é inserido; Master 01 cria', async () => {
  usarBanco([
    regra('queryOne', /SELECT id, numero, visibilidade FROM processos/, processo('restrito')),
    regra('query', /INSERT INTO cessoes_credito/, [{ id: 'c1' }]),
    regra('query', /INSERT INTO tarefas/, [{ id: 't1' }]),
    regra('execute', /INSERT INTO logs_auditoria/, { rowCount: 1 }),
  ]);
  const negado = await chamar('POST', `/api/processos/${PID}/cessao`, T.master, { cessionario_nome: 'Fulano de Tal' });
  assert.equal(negado.status, 404);
  assert.equal(gravacoes().length, 0);
  const ok = await chamar('POST', `/api/processos/${PID}/cessao`, T.master01, { cessionario_nome: 'Fulano de Tal' });
  assert.equal(ok.status, 201);
});

test('DELETE /processos/:id/cessao/:cessaoId — o furo: restrito não deixa Master comum apagar a cessão', async () => {
  usarBanco([
    soVisibilidade('restrito'),
    regra('queryOne', /FROM cessoes_credito WHERE id/, { id: 'c1' }),
    regra('execute', /DELETE FROM cessoes_credito/, { rowCount: 1 }),
    regra('execute', /INSERT INTO logs_auditoria/, { rowCount: 1 }),
  ]);
  assert.equal((await chamar('DELETE', `/api/processos/${PID}/cessao/${CID}`, T.master)).status, 404);
  assert.equal(gravacoes().length, 0);
  assert.equal((await chamar('DELETE', `/api/processos/${PID}/cessao/${CID}`, T.master01)).status, 200);
  assert.ok(chamadas.some(c => /DELETE FROM cessoes_credito/.test(c.sql)));
});

test('POST /processos/:id/sync — restrito: 404 antes de enfileirar (só a consulta de visibilidade acontece)', async () => {
  usarBanco([soVisibilidade('restrito')]);
  const r = await chamar('POST', `/api/processos/${PID}/sync`, T.master);
  assert.equal(r.status, 404);
  assert.equal(chamadas.length, 1);
  assert.match(chamadas[0].sql, /SELECT visibilidade FROM processos/);
});

test('POST /processos/:id/sync — processo inexistente também é 404', async () => {
  usarBanco([regra('queryOne', /SELECT visibilidade FROM processos/, null)]);
  assert.equal((await chamar('POST', `/api/processos/${PID}/sync`, T.master)).status, 404);
});

test('DELETE /processos/:id — restrito: Master comum recebe 404 e nada é apagado; Master 01 apaga', async () => {
  usarBanco([regra('queryOne', /SELECT \* FROM processos WHERE id/, processo('restrito')), regra('execute', /./, { rowCount: 1 })]);
  const negado = await chamar('DELETE', `/api/processos/${PID}`, T.master);
  assert.equal(negado.status, 404);
  assert.equal(gravacoes().length, 0);
  assert.equal((await chamar('DELETE', `/api/processos/${PID}`, T.master01)).status, 200);
  assert.ok(gravacoes().some(c => /DELETE FROM processos WHERE id/.test(c.sql)));
});

// ───────────────────────────── movimentações, classificação, agenda ─────────────────────────────
test('GET /movimentacoes/:processoId — restrito: 404 e as movimentações nem são lidas; Master 01 lê', async () => {
  usarBanco([soVisibilidade('restrito'), regra('query', /FROM movimentacoes m/, [{ id: 'm1', texto: 'sigiloso' }])]);
  for (const t of [T.master, T.junior]) {
    const r = await chamar('GET', `/api/movimentacoes/${PID}`, t);
    assert.equal(r.status, 404);
    assert.ok(!r.texto.includes('sigiloso'));
  }
  assert.ok(!chamadas.some(c => /FROM movimentacoes m/.test(c.sql)));
  const ok = await chamar('GET', `/api/movimentacoes/${PID}`, T.master01);
  assert.equal(ok.status, 200);
  assert.equal(ok.corpo.movimentacoes.length, 1);
});

test('GET /movimentacoes/:processoId — normal: júnior lê; id malformado é 404 sem consultar o banco', async () => {
  usarBanco([soVisibilidade('normal'), regra('query', /FROM movimentacoes m/, [])]);
  assert.equal((await chamar('GET', `/api/movimentacoes/${PID}`, T.junior)).status, 200);
  usarBanco();
  assert.equal((await chamar('GET', '/api/movimentacoes/nao-uuid', T.junior)).status, 404);
  assert.equal(chamadas.length, 0);
});

test('/classif/processo/:processoId — restrito: PATCH e GET dão 404 sem ler nem gravar; normal e Master 01 passam', async () => {
  usarBanco([soVisibilidade('restrito'), regra('execute', /INSERT INTO processo_classif/, { rowCount: 1 }), regra('query', /FROM processo_classif/, [{ campo_id: 'x', valor: 'y' }])]);
  assert.equal((await chamar('PATCH', `/api/classif/processo/${PID}`, T.master, { campo_id: CID, valor: 'v' })).status, 404);
  assert.equal((await chamar('GET', `/api/classif/processo/${PID}`, T.junior)).status, 404);
  assert.equal(gravacoes().length, 0);
  assert.ok(!chamadas.some(c => /FROM processo_classif/.test(c.sql)));
  assert.equal((await chamar('PATCH', `/api/classif/processo/${PID}`, T.master01, { campo_id: CID, valor: 'v' })).status, 200);
  assert.equal((await chamar('GET', `/api/classif/processo/${PID}`, T.master01)).status, 200);
  usarBanco([soVisibilidade('normal'), regra('query', /FROM processo_classif/, [])]);
  assert.equal((await chamar('GET', `/api/classif/processo/${PID}`, T.junior)).status, 200);
});

test('GET /agenda — o filtro entra no SQL para quem não é Master 01, com sintaxe válida (sem "AND AND")', async () => {
  usarBanco([regra('query', /FROM audiencias a/, [])]);
  for (const [t, comFiltro] of [[T.master, true], [T.junior, true], [T.master01, false]]) {
    await chamar('GET', '/api/agenda?de=2026-01-01&advogado_id=x', t);
    const sql = chamadas.at(-1).sql.replace(/\s+/g, ' ');
    assert.equal(/p\.visibilidade = 'normal'/.test(sql), comFiltro);
    assert.doesNotMatch(sql, /AND\s+AND/);
    assert.doesNotMatch(sql, /1=1 AND\s+ORDER/);
  }
  await chamar('GET', '/api/agenda', T.master); // sem nenhum filtro de query também
  assert.match(chamadas.at(-1).sql.replace(/\s+/g, ' '), /WHERE 1=1 AND \(p\.visibilidade = 'normal'\) ORDER BY/);
});

test('POST /agenda — processo restrito: 404 e nada é inserido; Master 01 cadastra', async () => {
  usarBanco([
    regra('queryOne', /SELECT p\.\*, c\.nome AS cliente_nome FROM processos p/, { ...processo('restrito'), cliente_nome: 'Cliente' }),
    regra('query', /INSERT INTO audiencias/, [{ id: AID }]),
    regra('execute', /UPDATE audiencias/, { rowCount: 1 }),
  ]);
  const corpo = { processo_id: PID, data_hora: '2027-01-10T10:00:00Z' };
  assert.equal((await chamar('POST', '/api/agenda', T.master, corpo)).status, 404);
  assert.equal(gravacoes().length, 0);
  assert.ok(!chamadas.some(c => /INSERT INTO audiencias/.test(c.sql)));
  assert.equal((await chamar('POST', '/api/agenda', T.master01, corpo)).status, 201);
});

test('PATCH /agenda/:id — audiência de processo restrito: 404 e nada gravado; inexistente: 404; Master 01 e normal: 200', async () => {
  const audiencia = (proc) => regra('queryOne', /SELECT processo_id FROM audiencias/, proc ? { processo_id: PID } : null);
  const gravaAud = regra('execute', /UPDATE audiencias/, { rowCount: 1 });
  const lerEvento = regra('queryOne', /SELECT google_event_id FROM audiencias/, null);

  usarBanco([audiencia(true), soVisibilidade('restrito'), gravaAud, lerEvento]);
  assert.equal((await chamar('PATCH', `/api/agenda/${AID}`, T.master, { resultado: 'x' })).status, 404);
  assert.equal(gravacoes().length, 0);
  assert.equal((await chamar('PATCH', `/api/agenda/${AID}`, T.master01, { resultado: 'x' })).status, 200);
  assert.equal(gravacoes().length, 1);

  usarBanco([audiencia(false), gravaAud]);
  assert.equal((await chamar('PATCH', `/api/agenda/${AID}`, T.master, { resultado: 'x' })).status, 404);

  usarBanco([audiencia(true), soVisibilidade('normal'), gravaAud, lerEvento]);
  assert.equal((await chamar('PATCH', `/api/agenda/${AID}`, T.junior, { resultado: 'x' })).status, 200);
});

// ───────────────────────────── relatório e ficha do cliente ─────────────────────────────
test('GET /relatorio/diligencias — o filtro de visibilidade entra para quem não é Master 01', async () => {
  usarBanco([regra('query', /FROM processos p/, [])]);
  await chamar('GET', '/api/relatorio/diligencias', T.junior);
  assert.match(chamadas.at(-1).sql, /p\.status = 'ativo' AND \(p\.visibilidade = 'normal'\)/);
  await chamar('GET', '/api/relatorio/diligencias', T.master01);
  assert.doesNotMatch(chamadas.at(-1).sql, /visibilidade/);
});

test('GET /clientes/:id — processos restritos ficam fora da ficha para quem não é Master 01', async () => {
  const cliente = { id: CID, nome: 'Cliente', anotacoes_enc: null };
  usarBanco([regra('queryOne', /FROM clientes c/, cliente), regra('query', /./, [])]);
  await chamar('GET', `/api/clientes/${CID}`, T.junior);
  const sqlProc = chamadas.find(c => /FROM processos WHERE cliente_id/.test(c.sql)).sql;
  assert.match(sqlProc, /processos\.visibilidade = 'normal'/);
  await chamar('GET', `/api/clientes/${CID}`, T.master01);
  const sqlProc01 = chamadas.filter(c => /FROM processos WHERE cliente_id/.test(c.sql)).at(-1).sql;
  assert.doesNotMatch(sqlProc01, /visibilidade/);
});

test('GET /clientes — a contagem de processos do cliente ignora restritos para quem não é Master 01', async () => {
  usarBanco([regra('query', /COUNT\(\*\) AS total FROM clientes/, [{ total: 0 }]), regra('query', /COUNT\(p\.id\) AS total_processos/, [])]);
  await chamar('GET', '/api/clientes', T.master);
  assert.match(chamadas.at(-1).sql, /LEFT JOIN processos p ON p\.cliente_id = c\.id AND \(p\.visibilidade = 'normal'\)/);
  await chamar('GET', '/api/clientes', T.master01);
  assert.doesNotMatch(chamadas.at(-1).sql, /visibilidade/);
});

test('sem token: as rotas com id de processo respondem 401 antes de qualquer consulta', async () => {
  usarBanco();
  for (const [m, url] of [['GET', `/api/processos/${PID}`], ['PATCH', `/api/processos/${PID}/urgente`], ['GET', `/api/movimentacoes/${PID}`], ['GET', `/api/classif/processo/${PID}`], ['PATCH', `/api/agenda/${AID}`]]) {
    assert.equal((await chamar(m, url)).status, 401, `${m} ${url}`);
  }
  assert.equal(chamadas.length, 0);
});
