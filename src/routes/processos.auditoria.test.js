import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import 'express-async-errors';

// S-13 — PATCH de processo e marcação de urgência entram na auditoria com o autor e só com os campos
// que mudaram; texto livre (notas) só marca "[alterado]". S-22 — falha inesperada do banco na
// exclusão vira 500 genérico com código. Banco = dublê; nada toca banco real.

const { db } = await import('../db/index.js');
const { processosRouter } = await import('./processos.js');
const { tratadorGlobalDeErros } = await import('../middleware/erros.js');

const MASTER = { id: '11111111-1111-4111-8111-111111111111', perfil: 'master', pode_marcar_restrito: false, nome: 'Operador Teste' };
const PROC = '33333333-3333-4333-8333-333333333333';

let auditoria, updates, linhaAtual, falharNoDelete, servidor, base;
const consoleErrorOriginal = console.error;

db.queryOne = async (sql, params) => {
  const s = sql.replace(/\s+/g, ' ').trim();
  if (s.startsWith('SELECT master_responsavel_id, compartilhado, visibilidade, tribunal, grau FROM processos')) {
    return { master_responsavel_id: MASTER.id, compartilhado: false, visibilidade: 'normal', tribunal: 'TJPB', grau: '1' };
  }
  if (s.startsWith('SELECT master_responsavel_id, compartilhado FROM processos')) return { master_responsavel_id: MASTER.id, compartilhado: false };
  if (s === 'SELECT urgente FROM processos WHERE id = $1') return { urgente: linhaAtual.urgente };
  const m = s.match(/^SELECT (.+) FROM processos WHERE id = \$1$/);
  if (m) {
    const colunas = m[1].split(', ');
    return Object.fromEntries(colunas.map(c => [c, linhaAtual[c] ?? null]));
  }
  if (s === 'SELECT * FROM processos WHERE id = $1') return { id: PROC, numero: '0001234-56.2021.8.15.0001' };
  throw new Error(`consulta inesperada no teste: ${s.slice(0, 80)}`);
};
db.query = async () => { throw new Error('banco real proibido nos testes'); };
db.execute = async (sql, params) => {
  const s = sql.replace(/\s+/g, ' ').trim();
  if (/INSERT INTO logs_auditoria/.test(s)) {
    auditoria.push({ usuarioId: params[0], acao: params[1], entidade: params[2], entidadeId: params[3], antes: params[4] && JSON.parse(params[4]), depois: params[5] && JSON.parse(params[5]), ip: params[6] });
  } else if (/^UPDATE processos SET/.test(s)) {
    updates.push({ sql: s, params });
  } else if (falharNoDelete && /^DELETE FROM processos/.test(s)) {
    throw new Error('update or delete on table "processos" violates foreign key constraint "fk_secreta"');
  }
  return { rowCount: 1, rows: [] };
};

before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = MASTER; req._ip = '203.0.113.9'; next(); });
  app.use('/api/processos', processosRouter);
  app.use(tratadorGlobalDeErros);
  servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(async () => { console.error = consoleErrorOriginal; await new Promise(r => servidor.close(r)); });

beforeEach(() => {
  auditoria = []; updates = []; falharNoDelete = false;
  linhaAtual = { vara: '1ª Vara Federal', juiz: null, status: 'ativo', valor_causa: '812.35', notas: 'nota antiga confidencial', urgente: false, pje_id_processo: null, visibilidade: 'normal' };
  console.error = () => {};
});

const enviar = async (metodo, caminho, corpo) => {
  const r = await fetch(`${base}/api/processos${caminho}`, { method: metodo, headers: { 'content-type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined });
  return { status: r.status, corpo: await r.json() };
};

test('PATCH grava auditoria só com os campos alterados (antes e depois) e o autor', async () => {
  const r = await enviar('PATCH', `/${PROC}`, { vara: '2ª Vara Federal', status: 'ativo', valor_causa: 812.35, juiz: 'Dr. Fulano' });
  assert.equal(r.status, 200);
  assert.equal(updates.length, 1, 'o UPDATE do processo continua acontecendo');
  assert.equal(auditoria.length, 1);
  const [linha] = auditoria;
  assert.equal(linha.usuarioId, MASTER.id);
  assert.equal(linha.acao, 'editar');
  assert.equal(linha.entidade, 'processo');
  assert.equal(linha.entidadeId, PROC);
  assert.equal(linha.ip, '203.0.113.9');
  assert.deepEqual(linha.antes, { vara: '1ª Vara Federal', juiz: null });
  assert.deepEqual(linha.depois, { vara: '2ª Vara Federal', juiz: 'Dr. Fulano' });
  // status e valor_causa vieram iguais ao que já estava (812.35 == "812.35"): não entram
  assert.equal('status' in linha.depois, false);
  assert.equal('valor_causa' in linha.depois, false);
});

test('PATCH que muda o valor da causa registra o valor anterior e o novo', async () => {
  await enviar('PATCH', `/${PROC}`, { valor_causa: 8123.5 });
  assert.deepEqual(auditoria[0].antes, { valor_causa: '812.35' });
  assert.deepEqual(auditoria[0].depois, { valor_causa: 8123.5 });
});

test('PATCH em texto livre (notas): o log só marca "[alterado]", sem o conteúdo antigo nem o novo', async () => {
  await enviar('PATCH', `/${PROC}`, { notas: 'nota nova com dado sensível' });
  const [linha] = auditoria;
  assert.deepEqual(linha.antes, { notas: '[alterado]' });
  assert.deepEqual(linha.depois, { notas: '[alterado]' });
  const texto = JSON.stringify(linha);
  assert.equal(texto.includes('confidencial'), false);
  assert.equal(texto.includes('sensível'), false);
});

test('PATCH sem mudança real: grava o UPDATE mas não polui a auditoria', async () => {
  const r = await enviar('PATCH', `/${PROC}`, { vara: '1ª Vara Federal', status: 'ativo' });
  assert.equal(r.status, 200);
  assert.equal(updates.length, 1);
  assert.equal(auditoria.length, 0);
});

test('PATCH: o id do PJe é auditado pelo valor de fato gravado', async () => {
  await enviar('PATCH', `/${PROC}`, { pje_id_processo: '123456' });
  assert.deepEqual(auditoria[0].depois, { pje_id_processo: '123456' });
  assert.deepEqual(auditoria[0].antes, { pje_id_processo: null });
});

test('urgência: marcar e desmarcar deixam duas linhas com o autor (efeito líquido zero, rastro completo)', async () => {
  await enviar('PATCH', `/${PROC}/urgente`, { urgente: true });
  linhaAtual.urgente = true;
  await enviar('PATCH', `/${PROC}/urgente`, { urgente: false });
  assert.equal(auditoria.length, 2);
  assert.deepEqual(auditoria.map(a => [a.acao, a.antes, a.depois]), [
    ['urgente', { urgente: false }, { urgente: true }],
    ['urgente', { urgente: true }, { urgente: false }],
  ]);
  assert.equal(auditoria[0].usuarioId, MASTER.id);
});

test('S-22: falha inesperada na exclusão → 500 genérico com código, sem a mensagem do banco, sem auditoria falsa', async () => {
  falharNoDelete = true;
  const r = await enviar('DELETE', `/${PROC}`);
  assert.equal(r.status, 500);
  assert.match(r.corpo.erro, /^Erro interno\. Código [0-9A-F]{8}\.$/);
  assert.equal(JSON.stringify(r.corpo).includes('fk_secreta'), false);
  assert.equal(auditoria.length, 0, 'a exclusão não aconteceu: não pode haver linha "excluir"');
});
