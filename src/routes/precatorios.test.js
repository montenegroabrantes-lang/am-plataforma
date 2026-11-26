import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import 'express-async-errors';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'segredo-de-teste';

const { db } = await import('../db/index.js');
for (const metodo of ['query', 'queryOne', 'execute']) {
  db[metodo] = async () => { throw new Error('banco real proibido nos testes'); };
}
const { autenticar } = await import('../middleware/auth.js');
const { definirCarregador, carregadorEcoDoToken } = await import('../middleware/sessao.js');
definirCarregador(carregadorEcoDoToken);
const { criarPrecatoriosRouter } = await import('./precatorios.js');

const PREC = '99999999-9999-4999-8999-999999999999';
const PROC = '33333333-3333-4333-8333-333333333333';
const CLI = '11111111-1111-4111-8111-111111111111';
const NUM = '0826410-63.2026.8.15.0000';
const ORIGEM = '0809017-10.2024.8.15.2001';

let linhas, existente, processo, duplicado;
const execucoes = [], auditoria = [], inserts = [];
const banco = {
  async execute(sql, params) { execucoes.push({ sql: sql.replace(/\s+/g, ' ').trim(), params }); },
  async query(sql, params) {
    if (sql.includes('INSERT INTO precatorios')) { inserts.push(params); return [{ id: PREC }]; }
    if (sql.includes('FROM precatorio_eventos')) return [{ campo: 'etapa', de: 'autuado', para: 'incluido_orcamento' }];
    if (sql.includes('FROM precatorios pr')) return linhas;
    throw new Error(`inesperado: ${sql.slice(0, 60)}`);
  },
  async queryOne(sql) {
    if (sql.includes('FROM processos WHERE numero')) return processo;
    if (sql.includes('SELECT id FROM precatorios WHERE numero')) return duplicado ? { id: 'outro' } : null;
    if (sql.includes('SELECT * FROM precatorios WHERE id')) return existente;
    throw new Error(`inesperado: ${sql.slice(0, 60)}`);
  },
};

const app = express();
app.use(express.json());
app.use('/api/precatorios', autenticar, criarPrecatoriosRouter({ banco, auditar: async r => { auditoria.push(r); }, anoAtual: () => 2026 }));
app.use((err, _req, res, _next) => res.status(500).json({ ok: false, erro: err.message }));
const servidor = app.listen(0);
const base = `http://127.0.0.1:${servidor.address().port}`;
after(() => servidor.close());

const assinar = p => jwt.sign(p, process.env.JWT_SECRET, { expiresIn: '1h' });
const TOKENS = {
  master: assinar({ id: 'm1', perfil: 'master', email: 'master@exemplo.com' }),
  master01: assinar({ id: 'm0', perfil: 'master', email: 'm01@exemplo.com', pode_marcar_restrito: true }),
  junior: assinar({ id: 'j1', perfil: 'junior', email: 'junior@exemplo.com' }),
};
const chamar = async (metodo, caminho, corpo, token = TOKENS.master) => {
  const r = await fetch(`${base}/api/precatorios${caminho}`, {
    method: metodo, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { status: r.status, corpo: await r.json() };
};

const linha = extra => ({ id: PREC, numero: NUM, credor_nome: 'MARIA EXEMPLO', devedor: 'Mun. João Pessoa', cliente_id: CLI,
  processo_origem_id: PROC, numero_origem: ORIGEM, origem_numero: ORIGEM, origem_visibilidade: 'normal', regime_especial: false,
  exercicio: 2027, etapa: 'incluido_orcamento', valor_requisitado: '1000.00', habilitacao_ramon: 'habilitado', habilitacao_luciano: 'pendente', ...extra });

beforeEach(() => {
  execucoes.length = 0; auditoria.length = 0; inserts.length = 0;
  linhas = [linha(), linha({ id: 'b', exercicio: null, etapa: 'autuado', valor_requisitado: null })];
  existente = linha(); processo = { id: PROC, cliente_id: CLI, visibilidade: 'normal' }; duplicado = false;
});

test('acesso: só Master', async () => {
  assert.equal((await chamar('GET', '', null, TOKENS.junior)).status, 403);
  assert.equal((await chamar('POST', '', { numero: NUM }, TOKENS.junior)).status, 403);
  assert.equal((await chamar('GET', '')).status, 200);
});

test('lista: grupo, pendências e resumo por exercício', async () => {
  const { corpo } = await chamar('GET', '');
  assert.equal(corpo.precatorios[0].grupo.chave, '2027');
  assert.deepEqual(corpo.precatorios[0].pendencias.map(p => p.tipo), ['habilitacao']);
  assert.deepEqual(corpo.precatorios[1].pendencias.map(p => p.tipo), ['habilitacao', 'sem_decisao']);
  assert.deepEqual(corpo.resumo.map(g => [g.chave, g.total, g.valor]), [['2027', 1, 1000], ['sem_decisao', 1, 0]]);
  assert.equal(corpo.precatorios[0].origem_visibilidade, undefined);
});

test('lista: origem restrita some para o Master comum, sem virar pendência de origem', async () => {
  linhas = [linha({ origem_visibilidade: 'restrito' })];
  const comum = (await chamar('GET', '')).corpo.precatorios[0];
  assert.equal(comum.processo_origem_id, null);
  assert.equal(comum.origem_numero, null);
  assert.equal(comum.numero_origem, null);
  assert.deepEqual(comum.pendencias.map(p => p.tipo), ['habilitacao']);
  assert.equal((await chamar('GET', '', null, TOKENS.master01)).corpo.precatorios[0].origem_numero, ORIGEM);
});

test('ficha: devolve o histórico; id inválido e inexistente', async () => {
  assert.equal((await chamar('GET', '/x')).status, 400);
  const r = await chamar('GET', `/${PREC}`);
  assert.equal(r.corpo.eventos.length, 1);
  linhas = [];
  assert.equal((await chamar('GET', `/${PREC}`)).status, 404);
});

test('cadastrar: valida, recusa número repetido, vincula a origem e audita', async () => {
  assert.equal((await chamar('POST', '', { numero: '123', credor_nome: 'A', devedor: 'B' })).status, 400);
  assert.equal((await chamar('POST', '', { numero: NUM, devedor: 'B' })).status, 400);
  assert.equal((await chamar('POST', '', { numero: NUM, credor_nome: 'A', devedor: 'B', etapa: 'zzz' })).status, 400);
  assert.equal((await chamar('POST', '', { numero: NUM, credor_nome: 'A', devedor: 'B', valor_requisitado: 'abc' })).status, 400);
  const r = await chamar('POST', '', { numero: NUM, credor_nome: 'Maria', devedor: 'EMLUR', numero_origem: ORIGEM, exercicio: 2027, valor_requisitado: '184.300,00', habilitacao_ramon: 'habilitado' });
  assert.equal(r.status, 201);
  assert.equal(r.corpo.origem_vinculada, true);
  assert.deepEqual(inserts[0].slice(0, 10), [NUM, 'Maria', 'EMLUR', CLI, PROC, ORIGEM, false, 2027, 'autuado', 184300]);
  assert.deepEqual(inserts[0].slice(12, 14), ['habilitado', 'pendente']);
  assert.equal(auditoria[0].entidade, 'precatorio');
  duplicado = true;
  assert.equal((await chamar('POST', '', { numero: NUM, credor_nome: 'A', devedor: 'B' })).status, 409);
});

test('cadastrar: origem inexistente ou restrita não vincula, mas guarda o número digitado', async () => {
  processo = { id: PROC, cliente_id: CLI, visibilidade: 'restrito' };
  const r = await chamar('POST', '', { numero: NUM, credor_nome: 'Maria', devedor: 'EMLUR', numero_origem: ORIGEM });
  assert.equal(r.corpo.origem_vinculada, false);
  assert.deepEqual(inserts[0].slice(3, 6), [null, null, ORIGEM]);
});

test('editar: grava só o que veio, registra evento de etapa e habilitação e audita', async () => {
  const r = await chamar('PATCH', `/${PREC}`, { etapa: 'aguardando_pagamento', habilitacao_luciano: 'protocolada', observacao: 'ok', exercicio: 2027 });
  assert.equal(r.status, 200);
  assert.match(execucoes[0].sql, /^UPDATE precatorios SET exercicio = \$2, etapa = \$3, habilitacao_luciano = \$4, observacao = \$5, atualizado_em = NOW\(\) WHERE id = \$1$/);
  const eventos = execucoes.filter(e => e.sql.startsWith('INSERT INTO precatorio_eventos')).map(e => e.params.slice(1, 4));
  assert.deepEqual(eventos, [['etapa', 'incluido_orcamento', 'aguardando_pagamento'], ['habilitacao_luciano', 'pendente', 'protocolada']]);
  assert.deepEqual(auditoria[0].valorDepois, { etapa: 'aguardando_pagamento', habilitacao_luciano: 'protocolada', observacao: 'ok' });
});

test('editar: campo desconhecido é ignorado; inválido é recusado; inexistente dá 404', async () => {
  assert.equal((await chamar('PATCH', `/${PREC}`, { id: 'x', criado_por: 'y' })).corpo.alterado, false);
  assert.equal(execucoes.length, 0);
  assert.equal((await chamar('PATCH', `/${PREC}`, { habilitacao_ramon: 'sim' })).status, 400);
  assert.equal((await chamar('PATCH', `/${PREC}`, { exercicio: 1900 })).status, 400);
  existente = null;
  assert.equal((await chamar('PATCH', `/${PREC}`, { etapa: 'autuado' })).status, 404);
});

test('editar: trocar o número de origem refaz o vínculo', async () => {
  processo = null;
  await chamar('PATCH', `/${PREC}`, { numero_origem: '0800001-11.2026.8.15.2001' });
  assert.match(execucoes[0].sql, /SET numero_origem = \$2, processo_origem_id = \$3, atualizado_em/);
  assert.deepEqual(execucoes[0].params.slice(1), ['0800001-11.2026.8.15.2001', null]);
});
