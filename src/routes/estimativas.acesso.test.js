// S-12 / D7 — todos os GETs do proxy da Camila (Revisão, Leads, aprendizado, monitoramento, aba Camila)
// e os VALORES de Rankings ficam só para Master. Exceções que o júnior continua usando:
//   GET /api/estimativas/pendencias-processuais (aba Processual) e
//   GET /api/estimativas/leads/:contactId/mensagens (aberta de propósito).
// A Camila é um servidor local de mentira (127.0.0.1, porta sorteada); não há banco real nem rede externa.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
// (sem 'express-async-errors' de propósito: ele embrulha os handlers e o teste estrutural compara a identidade do apenasMaster)
import jwt from 'jsonwebtoken';
import { definirCarregador, carregadorEcoDoToken } from '../middleware/sessao.js';
definirCarregador(carregadorEcoDoToken); // S-03: nestes testes a conta vale o que o token diz (sem banco)

process.env.JWT_SECRET = 'segredo-de-teste';

let camilaFalsa, servidor, base;
let recebidas = [];

const { db } = await import('../db/index.js');
const consultasRankings = [];
db.queryOne = async () => { throw new Error('banco real proibido nos testes'); };
db.execute = async () => { throw new Error('banco real proibido nos testes'); };
db.query = async (sql) => {
  consultasRankings.push(sql);
  // só a consulta da carteira devolve linhas (com valores em R$)
  if (/valor_homologado/.test(sql) && /valor_causa/.test(sql)) return [
    { tipo: 'rpv', total: '3', valor_total: '15000.00', valor_causa_total: '9000.00' },
    { tipo: 'a_definir', total: '7', valor_total: '0', valor_causa_total: '0' },
  ];
  if (/COALESCE\(acao/.test(sql)) return [{ demanda: 'Cumprimento', total: '5', urgentes: '1', percentual: '100.0' }];
  return [];
};

const { autenticar, apenasMaster } = await import('../middleware/auth.js');
const { estimativasRouter } = await import('./estimativas.js');
const { rankingsRouter } = await import('./rankings.js');

before(async () => {
  camilaFalsa = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', c => { corpo += c; });
    req.on('end', () => {
      recebidas.push({ metodo: req.method, url: req.url });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, leads: [], pendencias: [], resumo: {}, itens: [], estimativas: [], pendentes: 0 }));
    });
  });
  await new Promise(r => camilaFalsa.listen(0, '127.0.0.1', r));
  process.env.CAMILA_API_URL = `http://127.0.0.1:${camilaFalsa.address().port}`;
  process.env.CAMILA_API_KEY = 'chave-de-teste';

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req._ip = '127.0.0.1'; next(); });
  app.use('/api/estimativas', autenticar, estimativasRouter);
  app.use('/api/rankings', autenticar, rankingsRouter);
  app.use((err, _req, res, _next) => res.status(500).json({ ok: false, erro: err.message }));
  servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(async () => {
  await new Promise(r => servidor.close(r));
  await new Promise(r => camilaFalsa.close(r));
});
beforeEach(() => { recebidas = []; consultasRankings.length = 0; });

const assinar = p => jwt.sign(p, process.env.JWT_SECRET, { expiresIn: '1h' });
const T = {
  master: assinar({ id: 'm1', perfil: 'master', nome: 'Master', email: 'master@exemplo.com' }),
  master01: assinar({ id: 'm0', perfil: 'master', nome: 'Dono', email: 'dono@exemplo.com', pode_marcar_restrito: true }),
  junior: assinar({ id: 'j1', perfil: 'junior', nome: 'Junior', email: 'junior@exemplo.com', master_id: 'm1' }),
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

const CONTATO = '11111111-1111-4111-8111-111111111111';
// Todos os GETs do proxy que a Camila atende (o laço + as rotas soltas), com um caminho concreto de cada
const GETS_SO_MASTER = [
  '/', '/123', '/leads', '/123/referencia-estadual',
  '/dashboard', '/dashboard/detalhes', '/reabordagens/status',
  '/aprendizado-automatico', '/aprendizado-atendimentos', '/aprendizado-atendimentos/abc',
  '/achados-monitoramento', '/achados-monitoramento/abc',
  `/leads/${CONTATO}/continuidade`, '/sinteses-aprendizado', '/continuidade-metricas',
  '/camila/status', '/camila/uso-ia', '/camila/mudancas',
];

test('júnior: cada GET do proxy da Camila → 403, e NADA chega à Camila', async () => {
  for (const caminho of GETS_SO_MASTER) {
    const r = await chamar('GET', `/api/estimativas${caminho}`, T.junior);
    assert.equal(r.status, 403, `GET ${caminho}`);
    assert.equal(r.corpo.erro, 'Acesso restrito a Masters.');
  }
  assert.equal(recebidas.length, 0, 'nenhuma chamada foi repassada à Camila');
});

test('Master (e Master 01): os mesmos GETs passam e chegam à Camila', async () => {
  for (const token of [T.master, T.master01]) {
    for (const caminho of GETS_SO_MASTER) {
      recebidas = [];
      const r = await chamar('GET', `/api/estimativas${caminho}`, token);
      if (caminho.endsWith('/referencia-estadual')) { // consulta a fonte oficial (rede externa): só conferimos que passou do portão
        assert.notEqual(r.status, 403, `GET ${caminho}`); continue;
      }
      assert.equal(r.status, 200, `GET ${caminho}`);
      assert.ok(recebidas.length >= 1, `GET ${caminho} chegou à Camila`);
    }
  }
});

test('exceção 1: a aba Processual (GET /pendencias-processuais) continua aberta ao júnior', async () => {
  const r = await chamar('GET', '/api/estimativas/pendencias-processuais?estado=ativas', T.junior);
  assert.equal(r.status, 200);
  assert.deepEqual(recebidas.map(x => x.url.split('?')[0]), ['/api/pendencias-processuais']);
});

test('conversa do lead (GET /leads/:contactId/mensagens): só Master (S-27/D6 fechou a exceção da D7 para o júnior)', async () => {
  const junior = await chamar('GET', '/api/estimativas/leads/nao-uuid/mensagens', T.junior);
  assert.equal(junior.status, 403);
  const master = await chamar('GET', '/api/estimativas/leads/nao-uuid/mensagens', T.master);
  assert.equal(master.status, 400);
  assert.equal(master.corpo.erro, 'contactId inválido.');
});

test('escrita do proxy continua só Master (regressão): júnior → 403 em PATCH da Processual e nos POSTs', async () => {
  const casos = [
    ['PATCH', '/pendencias-processuais/abc', { acao: 'resolver' }],
    ['POST', '/123/aprovar', { valor: '100,00' }],
    ['POST', '/123/recusar', {}],
    ['POST', '/manual', {}],
    ['POST', '/camila/mudancas', {}],
    ['POST', `/leads/${CONTATO}/mensagem`, { mensagem: 'oi' }],
    ['POST', '/aprendizado-automatico/configuracao', {}],
  ];
  for (const [m, caminho, corpo] of casos) assert.equal((await chamar(m, `/api/estimativas${caminho}`, T.junior, corpo)).status, 403, `${m} ${caminho}`);
  assert.equal(recebidas.length, 0);
});

test('sem token: 401 em qualquer GET (a exceção do júnior não abre para anônimo)', async () => {
  for (const caminho of ['/', '/pendencias-processuais', `/leads/${CONTATO}/mensagens`, '/camila/status']) {
    assert.equal((await chamar('GET', `/api/estimativas${caminho}`)).status, 401, caminho);
  }
});

test('proteção estrutural: todo GET registrado no proxy tem apenasMaster, salvo as 2 exceções documentadas', () => {
  const excecoes = new Set(['/pendencias-processuais', '/leads/:contactId/mensagens']);
  const gets = estimativasRouter.stack.filter(l => l.route?.methods?.get);
  assert.ok(gets.length >= 20, `esperava ~30 rotas GET, achei ${gets.length}`);
  const semProtecao = gets
    .filter(l => !l.route.stack.some(h => h.handle === apenasMaster))
    .map(l => l.route.path)
    .filter(p => !excecoes.has(p));
  assert.deepEqual(semProtecao, [], 'GET novo do proxy sem apenasMaster');
  // e as exceções existem mesmo (o teste não pode passar por engano se alguém as renomear)
  for (const p of excecoes) assert.ok(gets.some(l => l.route.path === p), p);
});

// ───────────────────────────── Rankings: valores só para Master ─────────────────────────────
test('Rankings — Master recebe os valores em R$ (valor_total e valor_causa_total)', async () => {
  for (const token of [T.master, T.master01]) {
    const r = await chamar('GET', '/api/rankings', token);
    assert.equal(r.status, 200);
    assert.equal(r.corpo.valores_ocultos, false);
    const rpv = r.corpo.valor_por_tipo.find(v => v.tipo === 'rpv');
    assert.equal(rpv.valor_total, '15000.00');
    assert.equal(rpv.valor_causa_total, '9000.00');
  }
});

test('Rankings — júnior continua vendo as listas operacionais, mas SEM nenhum campo de valor', async () => {
  const r = await chamar('GET', '/api/rankings', T.junior);
  assert.equal(r.status, 200);
  assert.equal(r.corpo.valores_ocultos, true);
  // listas operacionais intactas
  assert.equal(r.corpo.ranking_demandas[0].demanda, 'Cumprimento');
  for (const chave of ['ranking_polos_passivos', 'ranking_varas', 'ranking_assuntos', 'tempo_por_etapa', 'distribuicao_ano', 'processos_parados', 'protocolos_por_mes', 'protocolos_por_responsavel']) {
    assert.ok(Array.isArray(r.corpo[chave]), chave);
  }
  // contagem por tipo (operacional) sim; valores em R$ não
  assert.deepEqual(r.corpo.valor_por_tipo, [{ tipo: 'rpv', total: '3' }, { tipo: 'a_definir', total: '7' }]);
  assert.ok(!/valor_total|valor_causa_total|15000|9000/.test(r.texto), 'nenhum valor em R$ na resposta do júnior');
});

test('Rankings — sem token é 401; restritos ficam fora das consultas de quem não é Master 01 (S-21)', async () => {
  assert.equal((await chamar('GET', '/api/rankings')).status, 401);
  consultasRankings.length = 0;
  await chamar('GET', '/api/rankings', T.junior);
  const processos = consultasRankings.filter(s => /FROM processos p/.test(s));
  assert.ok(processos.length >= 8);
  assert.ok(processos.every(s => /p\.visibilidade = 'normal'/.test(s)), 'todas as consultas de processos filtram restritos');
  consultasRankings.length = 0;
  await chamar('GET', '/api/rankings', T.master01);
  assert.ok(consultasRankings.filter(s => /FROM processos p/.test(s)).every(s => !/visibilidade/.test(s)), 'o Master 01 vê tudo');
});
