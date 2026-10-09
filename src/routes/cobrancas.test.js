import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'segredo-de-teste';

const { db } = await import('../db/index.js');
for (const metodo of ['query', 'queryOne', 'execute']) {
  db[metodo] = async () => { throw new Error('banco real proibido nos testes'); };
}
const { autenticar } = await import('../middleware/auth.js');
const { definirCarregador, carregadorEcoDoToken } = await import('../middleware/sessao.js');
definirCarregador(carregadorEcoDoToken);
const { criarCobrancasRouter } = await import('./cobrancas.js');
const { CONTA_SERVICO_EMAIL } = await import('../oauth/escopos.js');

const PROC = '33333333-3333-4333-8333-333333333333';
const CLI = '11111111-1111-4111-8111-111111111111';
const BEN = '77777777-7777-4777-8777-777777777777';
const COB = '88888888-8888-4888-8888-888888888888';

let processo, cobrancaAberta, cobranca, beneficiarioAtivo;
const execucoes = [], auditoria = [], inserts = [];
const banco = {
  async execute(sql, params) { execucoes.push({ sql, params }); },
  async query(sql, params) {
    if (sql.includes('INSERT INTO cobrancas_cliente')) { inserts.push(params); return [{ id: COB }]; }
    if (sql.includes('INSERT INTO beneficiarios_cobranca')) return [{ id: BEN, nome: params[0], funcao: params[1], chave_pix: params[2], ativo: true }];
    if (sql.includes('FROM cobrancas_cliente cb')) return cobranca ? [cobranca] : [];
    if (sql.includes('FROM beneficiarios_cobranca')) return [];
    throw new Error(`inesperado: ${sql.slice(0, 60)}`);
  },
  async queryOne(sql) {
    if (sql.includes('FROM processos WHERE id')) return processo;
    if (sql.includes('FROM beneficiarios_cobranca WHERE id')) return beneficiarioAtivo ? { id: BEN } : null;
    if (sql.includes("status IN ('a_cobrar','cobrado') LIMIT 1")) return cobrancaAberta ? { id: COB } : null;
    if (sql.includes('FROM cobrancas_cliente WHERE id')) return cobranca ? { status: cobranca.status, valor: cobranca.valor, tipo: 'contador', beneficiario_id: null, observacao: null } : null;
    throw new Error(`inesperado: ${sql.slice(0, 60)}`);
  },
};

const app = express();
app.use(express.json());
app.use('/api/cobrancas', autenticar, criarCobrancasRouter({ banco, auditar: async r => { auditoria.push(r); } }));
app.use((err, _req, res, _next) => res.status(500).json({ ok: false, erro: err.message }));
const servidor = app.listen(0);
const base = `http://127.0.0.1:${servidor.address().port}`;
after(() => servidor.close());

const assinar = p => jwt.sign(p, process.env.JWT_SECRET, { expiresIn: '1h' });
const TOKENS = {
  master: assinar({ id: 'm1', perfil: 'master', email: 'master@exemplo.com' }),
  junior: assinar({ id: 'j1', perfil: 'junior', email: 'junior@exemplo.com' }),
  conector: assinar({ id: 'svc', perfil: 'master', email: CONTA_SERVICO_EMAIL, escopos: ['comunicacao'] }),
};
const chamar = async (metodo, caminho, corpo, token = TOKENS.master) => {
  const r = await fetch(`${base}/api/cobrancas${caminho}`, {
    method: metodo, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { status: r.status, corpo: await r.json() };
};

beforeEach(() => {
  execucoes.length = 0; auditoria.length = 0; inserts.length = 0;
  processo = { id: PROC, cliente_id: CLI, visibilidade: 'normal' };
  cobrancaAberta = false; beneficiarioAtivo = true;
  cobranca = { id: COB, processo_id: PROC, cliente_id: CLI, tipo: 'contador', valor: '750.00', status: 'a_cobrar', processo_numero: '0809017-10.2024.8.15.2001',
    status_rpv: 'paga', status_precatorio: null, visibilidade: 'normal', cliente_nome: 'JOSEANE DIAS SANTOS', tem_whatsapp: true, tem_contato_digisac: false,
    beneficiario_id: BEN, beneficiario_nome: 'Raimunda Alves de Oliveira', chave_pix: 'chave-pix-1' };
});

test('acesso: só Master; conector do Claude (escopo comunicacao) não entra', async () => {
  assert.equal((await chamar('GET', '', null, TOKENS.junior)).status, 403);
  assert.equal((await chamar('GET', '', null, TOKENS.conector)).status, 403);
  assert.equal((await chamar('GET', '')).status, 200);
});

test('criar: valida valor e processo, grava com o cliente do processo e audita', async () => {
  assert.equal((await chamar('POST', '', { processo_id: 'x', valor: 750 })).status, 400);
  assert.equal((await chamar('POST', '', { processo_id: PROC, valor: 0 })).status, 400);
  const r = await chamar('POST', '', { processo_id: PROC, tipo: 'contador', valor: '1.320,00', beneficiario_id: BEN });
  assert.equal(r.status, 201);
  assert.deepEqual(inserts[0].slice(0, 5), [PROC, CLI, 'contador', 1320, BEN]);
  assert.equal(auditoria[0].entidade, 'cobranca_cliente');
});

test('criar: recusa segunda cobrança aberta do mesmo tipo e processo restrito', async () => {
  cobrancaAberta = true;
  assert.equal((await chamar('POST', '', { processo_id: PROC, valor: 750 })).status, 409);
  cobrancaAberta = false; processo = { id: PROC, cliente_id: CLI, visibilidade: 'restrito' };
  assert.equal((await chamar('POST', '', { processo_id: PROC, valor: 750 })).status, 404);
  assert.equal(inserts.length, 0);
});

test('lista: marca "pronta" quando a RPV está paga e filtra as prontas', async () => {
  const r = await chamar('GET', '?prontas=1');
  assert.equal(r.corpo.cobrancas.length, 1);
  assert.equal(r.corpo.cobrancas[0].pronta, true);
  cobranca.status_rpv = 'expedida';
  assert.equal((await chamar('GET', '?prontas=1')).corpo.cobrancas.length, 0);
  assert.equal((await chamar('GET', '')).corpo.cobrancas[0].pronta, false);
});

test('mensagem: texto pronto com valor, favorecido e chave', async () => {
  const r = await chamar('GET', `/${COB}/mensagem`);
  assert.equal(r.status, 200);
  assert.match(r.corpo.texto, /Olá, Joseane/);
  assert.match(r.corpo.texto, /R\$\s750,00/);
  assert.match(r.corpo.texto, /Chave: chave-pix-1/);
  assert.equal(r.corpo.cliente_id, CLI);
});

test('transições: cobrado, pago e cancelar só a partir de aberta; pago aceita valor_pago', async () => {
  assert.equal((await chamar('POST', `/${COB}/cobrado`, {})).status, 200);
  assert.match(execucoes.at(-1).sql, /status = 'cobrado'/);
  assert.equal((await chamar('POST', `/${COB}/pago`, { valor_pago: '700,00' })).status, 200);
  assert.deepEqual(execucoes.at(-1).params, [COB, 700]);
  assert.equal((await chamar('POST', `/${COB}/pago`, { valor_pago: 'abc' })).status, 400);
  cobranca.status = 'pago';
  assert.equal((await chamar('POST', `/${COB}/cobrado`, {})).status, 409);
  assert.equal((await chamar('POST', `/${COB}/cancelar`, {})).status, 409);
  assert.equal(auditoria.filter(a => a.acao.startsWith('cobranca_')).length, 2);
});

test('favorecido: exige nome e chave Pix', async () => {
  assert.equal((await chamar('POST', '/beneficiarios', { nome: 'Raimunda' })).status, 400);
  const r = await chamar('POST', '/beneficiarios', { nome: 'Raimunda Alves de Oliveira', chave_pix: 'abc', funcao: 'contador' });
  assert.equal(r.status, 201);
  assert.equal(r.corpo.beneficiario.nome, 'Raimunda Alves de Oliveira');
});
