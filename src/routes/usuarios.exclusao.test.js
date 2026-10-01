import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import 'express-async-errors';
import { definirCarregador, carregadorEcoDoToken } from '../middleware/sessao.js';
definirCarregador(carregadorEcoDoToken); // S-03: nestes testes a conta vale o que o token diz (sem banco)

// S-13 / D-S3 — quem já tem registro na auditoria não é excluído (409 "desative"); o log nunca tem o
// autor anulado (o UPDATE em logs_auditoria saiu da rota); falha ao gravar o log DENTRO da transação
// derruba a exclusão em vez de a rota responder "ok"; redefinição de senha é auditada sem a senha.
// Banco = dublê com transação; nada toca banco real.

const { db } = await import('../db/index.js');
const { usuariosRouter } = await import('./usuarios.js');
const { tratadorGlobalDeErros } = await import('../middleware/erros.js');

const MASTER01 = { id: '11111111-1111-4111-8111-111111111111', perfil: 'master', pode_marcar_restrito: true, nome: 'Master 01' };
const MASTER02 = { id: '44444444-4444-4444-8444-444444444444', perfil: 'master', pode_marcar_restrito: false, nome: 'Master 02' };
const ALVO = '22222222-2222-4222-8222-222222222222';

let usuario, temHistorico, erroNoDelete, erroNoInsertDeAuditoria, comandos, transacoes, auditoria, servidor, base;
const consoleErrorOriginal = console.error;

db.queryOne = async (sql, params) => {
  const s = sql.replace(/\s+/g, ' ').trim();
  if (s.startsWith('SELECT id, nome, email, perfil, ativo FROM usuarios WHERE id')) return { id: params[0], nome: 'Fulano de Teste', email: 'fulano@exemplo.invalid', perfil: 'junior', ativo: false };
  if (s.startsWith('SELECT 1 AS existe FROM logs_auditoria WHERE usuario_id')) return temHistorico ? { existe: 1 } : null;
  if (s.startsWith('SELECT perfil FROM usuarios WHERE id')) return { perfil: 'junior' };
  // S-05 (G4): a rota confere a hierarquia lendo id, perfil e master_id do alvo.
  if (s.startsWith('SELECT id, perfil, master_id FROM usuarios WHERE id')) return { id: params[0], perfil: 'junior', master_id: null };
  // S-03/S-04 (G7): redefinir a senha grava senha provisória, sobe a versão de sessão e devolve o id.
  if (s.startsWith('UPDATE usuarios SET senha_hash = $1, senha_temporaria = true, sessao_versao = sessao_versao + 1 WHERE id = $2 RETURNING id')) return { id: params[1] };
  throw new Error(`consulta inesperada: ${s.slice(0, 80)}`);
};
db.query = async () => { throw new Error('banco real proibido nos testes'); };
db.execute = async (sql, params) => {
  const s = sql.replace(/\s+/g, ' ').trim();
  if (/INSERT INTO logs_auditoria/.test(s)) auditoria.push({ usuarioId: params[0], acao: params[1], entidade: params[2], entidadeId: params[3], antes: params[4] && JSON.parse(params[4]), depois: params[5] && JSON.parse(params[5]) });
  return { rowCount: 1, rows: [] };
};
db.transaction = async (fn) => {
  transacoes.push('BEGIN');
  const tx = {
    async execute(sql, params) {
      const s = sql.replace(/\s+/g, ' ').trim();
      comandos.push(s);
      if (erroNoDelete && s === 'DELETE FROM usuarios WHERE id = $1') throw Object.assign(new Error('violates foreign key constraint "chaves_api_externas_master_id_fkey"'), { code: '23503' });
      if (/INSERT INTO logs_auditoria/.test(s)) {
        if (erroNoInsertDeAuditoria) throw Object.assign(new Error('disco cheio'), { code: '53100' });
        auditoria.push({ acao: params[1], entidadeId: params[3], antes: params[4] && JSON.parse(params[4]) });
      }
      return { rowCount: 1, rows: [] };
    },
  };
  try { const r = await fn(tx); transacoes.push('COMMIT'); return r; }
  catch (e) { transacoes.push('ROLLBACK'); throw e; }
};

before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = usuario; req._ip = '203.0.113.9'; next(); });
  app.use('/api/usuarios', usuariosRouter);
  app.use(tratadorGlobalDeErros);
  servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(async () => { console.error = consoleErrorOriginal; await new Promise(r => servidor.close(r)); });

beforeEach(() => {
  usuario = MASTER01; temHistorico = false; erroNoDelete = false; erroNoInsertDeAuditoria = false;
  comandos = []; transacoes = []; auditoria = [];
  console.error = () => {};
});

const chamar = async (metodo, caminho, corpo) => {
  const r = await fetch(`${base}/api/usuarios${caminho}`, { method: metodo, headers: { 'content-type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined });
  return { status: r.status, corpo: await r.json() };
};

test('excluir usuário COM histórico na auditoria → 409 "desative em vez de excluir", sem abrir transação', async () => {
  temHistorico = true;
  const r = await chamar('DELETE', `/${ALVO}`);
  assert.equal(r.status, 409);
  assert.equal(r.corpo.ok, false);
  assert.match(r.corpo.erro, /histórico/);
  assert.match(r.corpo.erro, /Desative/);
  assert.deepEqual(transacoes, [], 'nada foi tocado');
  assert.equal(comandos.length, 0);
});

test('excluir usuário SEM histórico: transação completa, o autor do log NÃO é anulado, exclusão auditada', async () => {
  const r = await chamar('DELETE', `/${ALVO}`);
  assert.equal(r.status, 200);
  assert.deepEqual(transacoes, ['BEGIN', 'COMMIT']);
  assert.ok(comandos.includes('DELETE FROM usuarios WHERE id = $1'));
  // o UPDATE que anulava o autor de todo o log saiu (o log agora só aceita INSERT)
  assert.equal(comandos.some(c => /UPDATE logs_auditoria/i.test(c)), false);
  assert.equal(auditoria.length, 1);
  assert.equal(auditoria[0].acao, 'excluir');
  assert.equal(auditoria[0].entidadeId, ALVO);
  assert.equal(auditoria[0].antes.email, 'fulano@exemplo.invalid', 'quem foi excluído fica no log, por nome e e-mail');
});

test('ainda ligado a outro registro (FK 23503): 409 claro, transação desfeita', async () => {
  erroNoDelete = true;
  const r = await chamar('DELETE', `/${ALVO}`);
  assert.equal(r.status, 409);
  assert.match(r.corpo.erro, /Desative a conta/);
  assert.equal(r.corpo.erro.includes('chaves_api'), false);
  assert.equal(transacoes.at(-1), 'ROLLBACK');
});

test('falha ao gravar o log DENTRO da transação derruba a exclusão (antes o COMMIT virava ROLLBACK e a rota dizia "ok")', async () => {
  erroNoInsertDeAuditoria = true;
  const r = await chamar('DELETE', `/${ALVO}`);
  assert.equal(r.status, 500);
  assert.match(r.corpo.erro, /^Erro interno\. Código [0-9A-F]{8}\.$/);
  assert.equal(transacoes.at(-1), 'ROLLBACK');
});

test('só o Master 01 exclui (Master comum → 403); a própria conta não (400)', async () => {
  usuario = MASTER02;
  assert.equal((await chamar('DELETE', `/${ALVO}`)).status, 403);
  usuario = MASTER01;
  assert.equal((await chamar('DELETE', `/${MASTER01.id}`)).status, 400);
});

test('redefinir senha grava auditoria com quem redefiniu e de quem, sem a senha', async () => {
  const r = await chamar('PATCH', `/${ALVO}/senha`, { senha: 'NovaSenhaSegura#2026' });
  assert.equal(r.status, 200);
  assert.equal(auditoria.length, 1);
  assert.equal(auditoria[0].acao, 'redefinir_senha');
  assert.equal(auditoria[0].entidadeId, ALVO);
  assert.equal(auditoria[0].usuarioId, MASTER01.id);
  assert.equal(JSON.stringify(auditoria[0]).includes('NovaSenhaSegura'), false);
});
