import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

// S-13 — registrarAuditoria: retrato do autor no INSERT, id que não é UUID não derruba o log,
// e o erro é relançado dentro de transação (senão o COMMIT vira ROLLBACK em silêncio).
// O banco é uma dublê; nada toca rede nem banco real.

const { db } = await import('../db/index.js');
const { registrarAuditoria } = await import('./auditoria.js');

const AUTOR = '11111111-1111-4111-8111-111111111111';
const ENTIDADE = '22222222-2222-4222-8222-222222222222';

let inserts, falhar;
const consoleErrorOriginal = console.error;
let saidaDoLog;

beforeEach(() => {
  inserts = []; falhar = null; saidaDoLog = [];
  db.execute = async (sql, params) => {
    if (falhar) throw falhar;
    inserts.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    return { rowCount: 1 };
  };
  console.error = (...a) => { saidaDoLog.push(a.join(' ')); };
});
after(() => { console.error = consoleErrorOriginal; });

test('o INSERT grava o retrato do autor (nome e e-mail) lido do cadastro, sem novos parâmetros', async () => {
  await registrarAuditoria({ usuarioId: AUTOR, acao: 'editar', entidade: 'processo', entidadeId: ENTIDADE, valorAntes: { a: 1 }, valorDepois: { a: 2 }, ip: '10.0.0.1' });
  assert.equal(inserts.length, 1);
  const { sql, params } = inserts[0];
  assert.match(sql, /INSERT INTO logs_auditoria \(usuario_id, acao, entidade, entidade_id, valor_antes, valor_depois, ip, usuario_nome, usuario_email\)/);
  assert.match(sql, /\(SELECT nome FROM usuarios WHERE id = \$1::uuid\)/);
  assert.match(sql, /\(SELECT email FROM usuarios WHERE id = \$1::uuid\)/);
  // a ordem dos 7 parâmetros é a de sempre (as dublês dos outros testes dependem dela)
  assert.deepEqual(params, [AUTOR, 'editar', 'processo', ENTIDADE, '{"a":1}', '{"a":2}', '10.0.0.1']);
});

test('ação sem usuário (login_falhou, integração): usuario_id nulo e o resto igual', async () => {
  await registrarAuditoria({ acao: 'login_falhou', entidade: 'usuario', valorDepois: { origem: 'senha' }, ip: '10.0.0.2' });
  assert.equal(inserts[0].params[0], null);
  assert.equal(inserts[0].params[3], null);
});

test('entidade_id que não é UUID (id de publicação, contactId) vai para valor_depois.entidade_ref', async () => {
  await registrarAuditoria({ usuarioId: AUTOR, acao: 'confirmar_prazo', entidade: 'publicacao', entidadeId: 123456789, valorDepois: { prazo_data: '2026-10-20' } });
  const { params } = inserts[0];
  assert.equal(params[3], null, 'a coluna UUID não recebe o id numérico (derrubaria o INSERT)');
  assert.deepEqual(JSON.parse(params[5]), { prazo_data: '2026-10-20', entidade_ref: '123456789' });
});

test('entidade_id fora do formato e sem valor_depois: o id ainda fica registrado', async () => {
  await registrarAuditoria({ usuarioId: AUTOR, acao: 'marcar_publicacao_lida', entidade: 'publicacao', entidadeId: '987' });
  assert.deepEqual(JSON.parse(inserts[0].params[5]), { entidade_ref: '987' });
});

test('fora de transação: falha do INSERT é engolida e vai para o log (não derruba a rota)', async () => {
  falhar = Object.assign(new Error('boom'), { code: '53300' });
  await assert.doesNotReject(registrarAuditoria({ usuarioId: AUTOR, acao: 'editar', entidade: 'processo' }));
  assert.ok(saidaDoLog.some(l => l.includes('[Auditoria] Falha ao registrar') && l.includes('editar') && l.includes('53300')));
});

test('dentro de transação: falha do INSERT é RELANÇADA (a ação e o log caem juntos)', async () => {
  const tx = { execute: async () => { throw Object.assign(new Error('violação'), { code: '23503' }); } };
  await assert.rejects(
    registrarAuditoria({ usuarioId: AUTOR, acao: 'excluir', entidade: 'usuario' }, tx),
    err => err.code === '23503'
  );
});

test('dentro de transação: sem falha, grava pela conexão da transação (não pelo pool)', async () => {
  const chamadas = [];
  const tx = { execute: async (sql, params) => { chamadas.push(params); return { rowCount: 1 }; } };
  await registrarAuditoria({ usuarioId: AUTOR, acao: 'excluir', entidade: 'usuario', entidadeId: ENTIDADE }, tx);
  assert.equal(chamadas.length, 1);
  assert.equal(inserts.length, 0);
});
