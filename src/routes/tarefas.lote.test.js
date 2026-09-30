import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'segredo-de-teste';
// Sem token do Google o serviço de Calendar retorna na hora: nenhum teste sai para a rede.
delete process.env.GOOGLE_REFRESH_TOKEN;

const { db } = await import('../db/index.js');
// Guarda: nada aqui pode tocar o banco real. Cada teste instala o dublê que precisa.
let consultas = [];
let respostaUpdate = [];
const RESPONSAVEL = '99999999-9999-4999-8999-999999999999';
db.query = async (sql, params) => {
  consultas.push({ sql, params });
  if (/^\s*UPDATE tarefas SET/.test(sql)) return respostaUpdate;
  throw new Error('consulta inesperada nos testes do lote');
};
db.queryOne = async (sql) => {
  if (/FROM usuarios WHERE id=\$1 AND ativo=true/.test(sql)) return { id: RESPONSAVEL };
  throw new Error('queryOne inesperado nos testes do lote');
};
const auditoria = [];
db.execute = async (sql, params) => {
  if (/INSERT INTO logs_auditoria/.test(sql)) { auditoria.push(params); return { rowCount: 1 }; }
  throw new Error('execute inesperado nos testes do lote');
};

const { autenticar } = await import('../middleware/auth.js');
const { tarefasRouter, atualizarCalendarDoLote } = await import('./tarefas.js');

const app = express();
app.use(express.json());
app.use('/api/tarefas', autenticar, tarefasRouter);
app.use((err, _req, res, _next) => res.status(500).json({ ok: false, erro: err.message }));
const servidor = app.listen(0);
const base = `http://127.0.0.1:${servidor.address().port}`;
after(() => servidor.close());

const assinar = payload => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
const MASTER = assinar({ id: 'm1', perfil: 'master', email: 'master@exemplo.com' });
const JUNIOR = assinar({ id: 'j1', perfil: 'junior', email: 'junior@exemplo.com' });

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const T3 = '33333333-3333-4333-8333-333333333333';

async function patchLote(corpo, token = MASTER) {
  const r = await fetch(`${base}/api/tarefas/lote`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(corpo),
  });
  return { status: r.status, corpo: await r.json() };
}

const ultimoUpdate = () => consultas.filter(c => /^\s*UPDATE tarefas SET/.test(c.sql)).at(-1);

beforeEach(() => { consultas = []; respostaUpdate = []; auditoria.length = 0; });

test('U-02: por padrão o lote mantém a data dos prazos judiciais que já têm data', async () => {
  // T1 = prazo judicial que tinha 05/10 (o banco o devolve com a data antiga);
  // T2 = tarefa comum, recebe a data nova; T3 = prazo que estava sem data, recebe a nova.
  respostaUpdate = [
    { id: T1, tipo: 'prazo', onboarding_id: null, prazo_data: '2026-10-05', calendar_event_id: 'ev1' },
    { id: T2, tipo: 'geral', onboarding_id: null, prazo_data: '2026-11-10', calendar_event_id: null },
    { id: T3, tipo: 'prazo', onboarding_id: null, prazo_data: '2026-11-10', calendar_event_id: null },
  ];
  const r = await patchLote({ ids: [T1, T2, T3], atribuido_a: RESPONSAVEL, prazo_data: '2026-11-10', precisa_triagem: false });

  assert.equal(r.status, 200);
  assert.equal(r.corpo.atualizadas, 3);
  assert.equal(r.corpo.prazos_mantidos, 1);
  const up = ultimoUpdate();
  assert.match(up.sql, /prazo_data=CASE WHEN tipo IN \('prazo','prazo_pagamento'\) AND prazo_data IS NOT NULL THEN prazo_data ELSE \$2::date END/);
  assert.deepEqual(up.params.slice(0, 2), [RESPONSAVEL, '2026-11-10']);
  const valorDepois = JSON.parse(auditoria.at(-1)[5]);
  assert.deepEqual(valorDepois.prazos_mantidos, [T1]);
  assert.equal(valorDepois.confirmar_troca_prazo, false);
});

test('U-02: prazo_pagamento (RPV/precatório) também é preservado por padrão', async () => {
  respostaUpdate = [{ id: T1, tipo: 'prazo_pagamento', onboarding_id: null, prazo_data: '2026-12-01', calendar_event_id: null }];
  const r = await patchLote({ ids: [T1], prazo_data: '2026-11-10' });
  assert.equal(r.corpo.prazos_mantidos, 1);
  assert.match(ultimoUpdate().sql, /tipo IN \('prazo','prazo_pagamento'\)/);
});

test('U-02: com confirmar_troca_prazo === true a data vale para todas, sem CASE', async () => {
  respostaUpdate = [
    { id: T1, tipo: 'prazo', onboarding_id: null, prazo_data: '2026-11-10', calendar_event_id: 'ev1' },
    { id: T2, tipo: 'geral', onboarding_id: null, prazo_data: '2026-11-10', calendar_event_id: null },
  ];
  const r = await patchLote({ ids: [T1, T2], prazo_data: '2026-11-10', confirmar_troca_prazo: true });

  assert.equal(r.status, 200);
  assert.equal(r.corpo.prazos_mantidos, 0);
  const up = ultimoUpdate();
  assert.match(up.sql, /prazo_data=\$1::date/);
  assert.doesNotMatch(up.sql, /CASE/);
  assert.equal(JSON.parse(auditoria.at(-1)[5]).confirmar_troca_prazo, true);
});

test('U-02: só o booleano true confirma (string "true", 1 e "sim" continuam preservando)', async () => {
  for (const valor of ['true', 1, 'sim', null]) {
    consultas = [];
    respostaUpdate = [{ id: T1, tipo: 'prazo', onboarding_id: null, prazo_data: '2026-10-05', calendar_event_id: null }];
    const r = await patchLote({ ids: [T1], prazo_data: '2026-11-10', confirmar_troca_prazo: valor });
    assert.equal(r.status, 200);
    assert.match(ultimoUpdate().sql, /CASE WHEN tipo IN/, `confirmar_troca_prazo=${JSON.stringify(valor)} não pode liberar a troca`);
    assert.equal(r.corpo.prazos_mantidos, 1);
  }
});

test('U-02: limpar o prazo em lote (prazo_data vazio) também respeita os prazos judiciais', async () => {
  respostaUpdate = [
    { id: T1, tipo: 'prazo', onboarding_id: null, prazo_data: '2026-10-05', calendar_event_id: null },
    { id: T2, tipo: 'geral', onboarding_id: null, prazo_data: null, calendar_event_id: null },
  ];
  const r = await patchLote({ ids: [T1, T2], prazo_data: '' });
  assert.equal(r.status, 200);
  assert.match(ultimoUpdate().sql, /CASE WHEN tipo IN/);
  assert.equal(ultimoUpdate().params[0], null);
  assert.equal(r.corpo.prazos_mantidos, 1);
});

test('U-02: só responsável (sem prazo_data) não mexe na data nem no critério de prazos', async () => {
  respostaUpdate = [{ id: T1, tipo: 'prazo', onboarding_id: null, prazo_data: '2026-10-05', calendar_event_id: null }];
  const r = await patchLote({ ids: [T1], atribuido_a: RESPONSAVEL });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.atualizadas, 1);
  assert.equal(r.corpo.prazos_mantidos, 0);
  assert.doesNotMatch(ultimoUpdate().sql, /prazo_data=/);
  assert.doesNotMatch(ultimoUpdate().sql, /CASE/);
});

test('cancelar em lote (status + justificativa) segue igual e sem critério de prazo', async () => {
  respostaUpdate = [{ id: T1, tipo: 'geral', onboarding_id: null, prazo_data: null, calendar_event_id: null }];
  const r = await patchLote({ ids: [T1], status: 'cancelada', justificativa: 'duplicada' });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.prazos_mantidos, 0);
  assert.doesNotMatch(ultimoUpdate().sql, /CASE/);
  assert.match(ultimoUpdate().sql, /justificativa_cancelamento=/);
});

test('lote: validações continuam antes do banco (júnior 403, id ruim 400, data inválida 400)', async () => {
  assert.equal((await patchLote({ ids: [T1], prazo_data: '2026-11-10' }, JUNIOR)).status, 403);
  assert.equal((await patchLote({ ids: ['nao-e-uuid'], prazo_data: '2026-11-10' })).status, 400);
  assert.equal((await patchLote({ ids: [T1], prazo_data: '10/11/2026' })).status, 400);
  assert.equal((await patchLote({ ids: [T1] })).status, 400);
  assert.equal(consultas.length, 0, 'nenhuma dessas chamadas pode chegar ao UPDATE');
});

test('Calendar do lote: só atualiza tarefas com evento, uma por vez, e tolera falha do Google', async () => {
  const chamadas = [];
  const atualizar = async (eventId, { dataHora }) => {
    chamadas.push({ eventId, dia: dataHora.getFullYear() * 10000 + (dataHora.getMonth() + 1) * 100 + dataHora.getDate() });
    if (eventId === 'quebra-async') throw new Error('Google fora do ar');
    if (eventId === 'quebra-sync') return Promise.reject(new Error('rejeitada'));
  };
  const n = await atualizarCalendarDoLote(
    [{ calendar_event_id: 'ev1' }, { calendar_event_id: null }, { calendar_event_id: 'quebra-async' }, { calendar_event_id: 'quebra-sync' }, { calendar_event_id: 'ev2' }],
    '2026-11-10',
    atualizar,
  );
  assert.equal(n, 4);
  assert.deepEqual(chamadas.map(c => c.eventId), ['ev1', 'quebra-async', 'quebra-sync', 'ev2']);
  assert.ok(chamadas.every(c => c.dia === 20261110));
});
