import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import 'express-async-errors';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'segredo-de-teste';

// S-13 — GET /api/auditoria só para o Master 01, somente leitura, 50 linhas por página, filtros por
// ação, usuário e período. Banco = dublê que registra o SQL e os parâmetros.

const { criarAuditoriaRouter, montarFiltros, POR_PAGINA } = await import('./auditoria.js');
const { autenticar } = await import('../middleware/auth.js');
const { tratadorGlobalDeErros } = await import('../middleware/erros.js');
const { CONTA_SERVICO_EMAIL } = await import('../oauth/escopos.js');

let consultas, totalNoBanco, servidor, base;

const banco = {
  async query(sql, params = []) {
    const s = sql.replace(/\s+/g, ' ').trim();
    consultas.push({ s, params });
    if (s.startsWith('SELECT COUNT(*)::int AS total')) return [{ total: totalNoBanco }];
    if (s.startsWith('SELECT acao, COUNT(*)::int AS total FROM logs_auditoria GROUP BY acao')) return [{ acao: 'editar', total: 3 }];
    return [{ id: '10', criado_em: '2026-09-30T12:00:00Z', acao: 'editar', entidade: 'processo', usuario_nome: 'Master 01', usuario_email: 'm1@exemplo.invalid', valor_antes: { a: 1 }, valor_depois: { a: 2 } }];
  },
};

const token = (payload) => jwt.sign({ id: '1', ...payload }, process.env.JWT_SECRET, { expiresIn: '1h' });
const MASTER01 = { perfil: 'master', pode_marcar_restrito: true, email: 'master01@exemplo.invalid' };
const MASTER02 = { perfil: 'master', pode_marcar_restrito: false, email: 'master02@exemplo.invalid' };
const JUNIOR = { perfil: 'junior', pode_marcar_restrito: false, email: 'junior@exemplo.invalid' };

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/auditoria', autenticar, criarAuditoriaRouter({ banco }));
  app.use(tratadorGlobalDeErros);
  servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(async () => { await new Promise(r => servidor.close(r)); });
beforeEach(() => { consultas = []; totalNoBanco = 120; });

const pegar = async (caminho, payload = MASTER01, metodo = 'GET') => {
  const r = await fetch(`${base}/api/auditoria${caminho}`, { method: metodo, headers: { authorization: `Bearer ${token(payload)}` } });
  return { status: r.status, corpo: await r.json().catch(() => null) };
};

test('Master comum e júnior → 403 e nenhuma consulta ao banco', async () => {
  assert.equal((await pegar('', MASTER02)).status, 403);
  assert.equal((await pegar('', JUNIOR)).status, 403);
  assert.equal((await pegar('/acoes', MASTER02)).status, 403);
  assert.equal(consultas.length, 0);
});

test('sem login → 401', async () => {
  const r = await fetch(`${base}/api/auditoria`);
  assert.equal(r.status, 401);
});

test('token do conector (com escopos) e a conta de serviço → 403 mesmo que a conta tenha o flag de Master 01', async () => {
  assert.equal((await pegar('', { ...MASTER01, escopos: ['acervo'] })).status, 403);
  assert.equal((await pegar('', { ...MASTER01, email: CONTA_SERVICO_EMAIL })).status, 403);
  assert.equal(consultas.length, 0);
});

test('Master 01: 200 com 50 linhas por página, total e número de páginas', async () => {
  const r = await pegar('');
  assert.equal(r.status, 200);
  assert.equal(r.corpo.ok, true);
  assert.equal(r.corpo.total, 120);
  assert.equal(r.corpo.por_pagina, 50);
  assert.equal(r.corpo.paginas, 3);
  assert.equal(r.corpo.pagina, 1);
  assert.equal(r.corpo.registros[0].usuario_nome, 'Master 01');
  const listagem = consultas.find(c => c.s.startsWith('SELECT l.id'));
  assert.match(listagem.s, /ORDER BY l\.criado_em DESC, l\.id DESC LIMIT 50 OFFSET 0$/);
  assert.match(listagem.s, /COALESCE\(l\.usuario_nome, u\.nome\) AS usuario_nome/);
  assert.equal(POR_PAGINA, 50);
});

test('paginação: pagina=3 → OFFSET 100; inválida/negativa/fracionada vira a 1ª; nunca SQL inválido', async () => {
  await pegar('?pagina=3');
  assert.match(consultas.find(c => c.s.startsWith('SELECT l.id')).s, /OFFSET 100$/);
  for (const ruim of ['abc', '-5', '0', '1.7', '', '9999999999999999999999']) {
    consultas = [];
    const r = await pegar(`?pagina=${ruim}`);
    assert.equal(r.status, 200, ruim);
    const sql = consultas.find(c => c.s.startsWith('SELECT l.id')).s;
    assert.match(sql, /OFFSET \d+$/, ruim);
    assert.equal(/NaN|Infinity|-\d+$/.test(sql), false, ruim);
  }
});

test('filtros: ação exata, usuário (id ou nome/e-mail, com % e _ escapados) e período em dias de Brasília', async () => {
  await pegar('?acao=confirmar_prazo&usuario=100%25_ana&de=2026-09-01&ate=2026-09-30');
  const listagem = consultas.find(c => c.s.startsWith('SELECT l.id'));
  assert.match(listagem.s, /WHERE l\.acao = \$1 AND \(l\.usuario_id::text = \$2 OR COALESCE\(l\.usuario_nome, u\.nome\) ILIKE \$3 OR COALESCE\(l\.usuario_email, u\.email\) ILIKE \$3\) AND l\.criado_em >= \(\$4::date\)::timestamp AT TIME ZONE 'America\/Sao_Paulo' AND l\.criado_em < \(\(\$5::date \+ 1\)::timestamp AT TIME ZONE 'America\/Sao_Paulo'\)/);
  assert.deepEqual(listagem.params, ['confirmar_prazo', '100%_ana', '%100\\%\\_ana%', '2026-09-01', '2026-09-30']);
  // a contagem usa exatamente o mesmo filtro
  const contagem = consultas.find(c => c.s.startsWith('SELECT COUNT(*)'));
  assert.deepEqual(contagem.params, listagem.params);
});

test('valores vêm sempre por parâmetro: tentativa de injeção em acao/usuario não entra no SQL', async () => {
  await pegar(`?usuario=${encodeURIComponent("x' OR 1=1; DROP TABLE logs_auditoria;--")}`);
  const listagem = consultas.find(c => c.s.startsWith('SELECT l.id'));
  assert.equal(/DROP|OR 1=1/.test(listagem.s), false);
  assert.ok(listagem.params.some(p => String(p).includes('DROP TABLE')));
  const r = await pegar(`?acao=${encodeURIComponent("editar'; DROP TABLE x;--")}`);
  assert.equal(r.status, 400);
});

test('data inválida → 400 com mensagem (nada de 500 do Postgres); array na query também', async () => {
  for (const q of ['?de=30/09/2026', '?ate=2026-02-31', '?de=2026-13-01', '?de=abc', '?de[]=2026-09-01', '?de=2026-09-01&de=2026-09-02']) {
    const r = await pegar(q);
    assert.equal(r.status, 400, q);
    assert.match(r.corpo.erro, /inválida/);
  }
  assert.equal(consultas.length, 0);
});

test('/acoes lista as ações existentes para o filtro da tela', async () => {
  const r = await pegar('/acoes');
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo.acoes, [{ acao: 'editar', total: 3 }]);
});

test('somente leitura: o router não tem rota de escrita, e POST/PUT/PATCH/DELETE não existem', async () => {
  const router = criarAuditoriaRouter({ banco });
  const metodos = router.stack.filter(l => l.route).flatMap(l => Object.keys(l.route.methods));
  assert.deepEqual([...new Set(metodos)], ['get']);
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const r = await pegar('', MASTER01, m);
    assert.equal(r.status, 404, m);
  }
});

test('montarFiltros sem filtro devolve WHERE vazio', () => {
  assert.deepEqual(montarFiltros({}), { condicoes: [], params: [] });
});
