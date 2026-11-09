import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

// Fecho da peça pelas skills: consultar o processo (só leitura), cumprir UM prazo confirmado e
// concluir a tarefa de protocolo da inicial.

const PROC = '11111111-1111-4111-8111-111111111111';
const CLIENTE = '33333333-3333-4333-8333-333333333333';
const PRAZO = '77777777-7777-4777-8777-777777777777';
const PECA = '55555555-5555-4555-8555-555555555555';
const OUTRO_PROC = '99999999-9999-4999-8999-999999999999';

const { db } = await import('../db/index.js');
let consultas, updates, tarefa, peca, processos;
function instalarBancoFalso() {
  consultas = []; updates = [];
  processos = [{ id: PROC, numero: '0806065-73.2026.8.15.2005', tribunal: 'TJPB', grau: '1', cliente_id: CLIENTE, cliente_nome: 'X', tese: 'FGTS' }];
  tarefa = { id: PRAZO, tipo: 'prazo', status: 'pendente', processo_id: PROC, descricao: 'Impugnar contestação', calendar_event_id: null };
  peca = { id: PECA, titulo: 'Impugnação', processo_id: PROC };
  db.query = async (sql, params = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    consultas.push(s);
    if (s.startsWith('SELECT p.id, p.numero, p.tribunal')) return processos.filter(p => p.numero.replace(/\D/g, '') === params[0]);
    if (s.includes("t.tipo='prazo'")) return [{ id: PRAZO, processo_id: PROC, descricao: 'Impugnar contestação', prazo_data: '2026-11-20', status: 'pendente' }];
    if (s.includes("t.tipo='protocolar'")) return [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'pendente', tese: 'FGTS' }];
    if (s.startsWith('SELECT id, cargo, orgao, polo_passivo FROM cliente_vinculos')) return [{ id: 'v1', polo_passivo: 'União Federal' }];
    throw new Error(`consulta inesperada no teste: ${s.slice(0, 80)}`);
  };
  db.queryOne = async (sql) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('SELECT id, tipo, status, processo_id')) return tarefa;
    if (s.startsWith('SELECT id, titulo, processo_id FROM acervo_pecas')) return peca;
    return null;
  };
  db.execute = async (sql, params = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('UPDATE tarefas SET status=\'concluida\'')) { updates.push(params); return { rowCount: 1, rows: [] }; }
    return { rowCount: 1, rows: [] };
  };
}
instalarBancoFalso();
beforeEach(instalarBancoFalso);

const { acervoRouter } = await import('./acervo.js');
const app = express();
app.use(express.json());
let perfil = 'master';
app.use((req, _res, next) => { req.user = { id: '44444444-4444-4444-8444-444444444444', perfil, pode_marcar_restrito: true }; next(); });
app.use('/api/acervo', acervoRouter);
const servidor = app.listen(0);
const base = `http://127.0.0.1:${servidor.address().port}`;
after(() => servidor.close());
beforeEach(() => { perfil = 'master'; });

async function chamar(metodo, caminho, corpo) {
  const r = await fetch(`${base}/api/acervo${caminho}`, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined });
  return { status: r.status, corpo: await r.json().catch(() => null) };
}

test('contexto: processo existente traz os prazos abertos e não lista protocolos', async () => {
  const r = await chamar('GET', '/contexto-processo?numero=08060657320268152005');
  assert.equal(r.status, 200);
  assert.equal(r.corpo.processos[0].id, PROC);
  assert.equal(r.corpo.prazos_abertos.length, 1);
  assert.deepEqual(r.corpo.protocolos_pendentes, []);
  assert.ok(!consultas.some(s => s.startsWith('UPDATE') || s.startsWith('INSERT')));
});

test('contexto: inicial sem processo no AM + cliente traz tarefas de protocolo e vínculos', async () => {
  const r = await chamar('GET', `/contexto-processo?numero=0000001-00.2026.8.15.2001&cliente_id=${CLIENTE}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo.processos, []);
  assert.equal(r.corpo.protocolos_pendentes.length, 1);
  assert.equal(r.corpo.vinculos_ativos.length, 1);
});

test('contexto: inicial sem processo, cliente pelo nome — um só resultado já traz o protocolo', async () => {
  let nomes = [{ id: CLIENTE, nome: 'MARIA DA SILVA' }];
  const orig = db.query;
  db.query = async (sql, params) => (sql.includes('FROM clientes WHERE ativo=true') ? nomes : orig(sql, params));
  const r = await chamar('GET', '/contexto-processo?numero=0000001-00.2026.8.15.2001&cliente_nome=maria silva');
  assert.equal(r.status, 200);
  assert.equal(r.corpo.clientes_encontrados.length, 1);
  assert.equal(r.corpo.protocolos_pendentes.length, 1);
  nomes = [{ id: CLIENTE, nome: 'MARIA DA SILVA' }, { id: PROC, nome: 'MARIA SILVA COSTA' }];
  const r2 = await chamar('GET', '/contexto-processo?numero=0000001-00.2026.8.15.2001&cliente_nome=maria silva');
  assert.equal(r2.corpo.clientes_encontrados.length, 2);
  assert.deepEqual(r2.corpo.protocolos_pendentes, []);
});

test('contexto: validações (número incompleto, nada informado, cliente inválido)', async () => {
  assert.equal((await chamar('GET', '/contexto-processo?numero=123')).status, 400);
  assert.equal((await chamar('GET', '/contexto-processo')).status, 400);
  assert.equal((await chamar('GET', '/contexto-processo?cliente_id=abc')).status, 400);
});

test('contexto e escritas são só do Master', async () => {
  perfil = 'junior';
  assert.equal((await chamar('GET', '/contexto-processo?numero=08060657320268152005')).status, 403);
  assert.equal((await chamar('POST', `/prazos/${PRAZO}/cumprir`, {})).status, 403);
  assert.equal(updates.length, 0);
});

test('cumprir: conclui o prazo e anota a peça', async () => {
  const r = await chamar('POST', `/prazos/${PRAZO}/cumprir`, { peca_id: PECA });
  assert.equal(r.status, 200);
  assert.equal(updates.length, 1);
  assert.equal(updates[0][0], PRAZO);
  assert.match(updates[0][1], /Impugnação/);
});

test('cumprir: recusa tarefa que não é prazo, prazo já concluído e peça de outro processo', async () => {
  tarefa = { ...tarefa, tipo: 'protocolar' };
  assert.equal((await chamar('POST', `/prazos/${PRAZO}/cumprir`, {})).status, 409);
  instalarBancoFalso(); tarefa = { ...tarefa, status: 'concluida' };
  assert.equal((await chamar('POST', `/prazos/${PRAZO}/cumprir`, {})).status, 409);
  instalarBancoFalso(); peca = { ...peca, processo_id: OUTRO_PROC };
  assert.equal((await chamar('POST', `/prazos/${PRAZO}/cumprir`, { peca_id: PECA })).status, 409);
  assert.equal(updates.length, 0);
});

test('cumprir: id inválido e tarefa inexistente', async () => {
  assert.equal((await chamar('POST', '/prazos/abc/cumprir', {})).status, 400);
  tarefa = null;
  assert.equal((await chamar('POST', `/prazos/${PRAZO}/cumprir`, {})).status, 404);
});

test('protocolo: id inválido → 400; número fora do CNJ → 400 da regra da tela de Tarefas', async () => {
  assert.equal((await chamar('POST', '/protocolos/abc/concluir', {})).status, 400);
  const r = await chamar('POST', `/protocolos/${PRAZO}/concluir`, { numero_processo: '123', periodo_fim: '2026-10' });
  assert.equal(r.status, 400);
  assert.match(r.corpo.erro, /CNJ/);
});
