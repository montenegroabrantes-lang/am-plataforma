import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'segredo-de-teste';
const { db } = await import('../db/index.js');
for (const metodo of ['query', 'queryOne', 'execute']) {
  db[metodo] = async () => { throw new Error('banco real proibido nos testes'); };
}
const { autenticar } = await import('../middleware/auth.js');
const { criarReprotocoloRouter } = await import('./reprotocolo.js');
const { CONTA_SERVICO_EMAIL } = await import('../oauth/escopos.js');

const P1 = '55555555-5555-4555-8555-555555555555';
const T1 = '11111111-1111-4111-8111-111111111111';
const TESE = '66666666-6666-4666-8666-666666666666';
const DRIVE = '1S6IMMEkOnW2VbWAdweLbJMUAznwPQEBG';

const auditoria = [];
const ch = { reservar: [], montar: [], cancelar: [], modelo: [], importar: [] };
let respostaMontar = { ok: true, pacote_id: P1, relatorio: { periodo: { meses: 33 }, pronto_para_gerar_pecas: false }, texto: 'texto' };
let cancelou = true;
let erroModelo = null;

const app = express();
app.use(express.json());
app.use('/api/reprotocolo', autenticar, criarReprotocoloRouter({
  levantar: async () => { throw new Error('não usado'); }, conferir: async () => null,
  auditar: async (r) => { auditoria.push(r); }, limitador: (_q, _s, n) => n(),
  verificar: async () => ({ hoje: '2026-09-28', resultados: [] }),
  transacao: async (fn) => fn('tx'),
  importar: async (a) => { ch.importar.push(a); return { dry_run: a.dryRun, pastas: { recebidas: a.pastas.length, validas: a.pastas.length, gravadas: 0, mantidas_manuais: 0, recusadas: [] }, oficiais: { recebidas: a.oficiais.length, validas: a.oficiais.length, gravadas: 0, recusadas: [] } }; },
  pacotes: {
    reservar: async (a) => { ch.reservar.push(a); return a.tarefaIds.map(id => ({ tarefa_id: id, ok: id === T1, pacote_id: id === T1 ? P1 : undefined })); },
    montar: async (a) => { ch.montar.push(a); return respostaMontar; },
    cancelar: async (a) => { ch.cancelar.push(a); return cancelou; },
    listar: async ({ status, limite }) => [{ id: P1, status: status ?? 'reservado', limite }],
    obter: async ({ pacoteId }) => (pacoteId === P1 ? { id: P1, status: 'montado', texto: 'texto' } : null),
    cadastrarModelo: async (a) => { if (erroModelo) throw erroModelo; ch.modelo.push(a); },
    listarModelos: async () => [{ ente: 'Estado da Paraíba', tipo: 'inicial' }],
  },
}));
app.use((err, _req, res, _next) => res.status(500).json({ ok: false, erro: err.message }));
const servidor = app.listen(0);
const base = `http://127.0.0.1:${servidor.address().port}`;
after(() => servidor.close());

const assinar = p => jwt.sign(p, process.env.JWT_SECRET, { expiresIn: '1h' });
const TOKENS = {
  master: assinar({ id: 'm1', perfil: 'master', email: 'm@x.com' }),
  junior: assinar({ id: 'j1', perfil: 'junior', email: 'j@x.com' }),
  conector: assinar({ id: 'svc', perfil: 'master', email: CONTA_SERVICO_EMAIL, escopos: ['reprotocolo'] }),
};
async function chamar(metodo, caminho, token, corpo) {
  const r = await fetch(`${base}${caminho}`, { method: metodo, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(corpo ? { 'Content-Type': 'application/json' } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
  return { status: r.status, corpo: await r.json() };
}

test('leitura de pacotes e modelos: Master e conector com escopo; júnior 403; sem token 401', async () => {
  assert.equal((await chamar('GET', '/api/reprotocolo/pacotes')).status, 401);
  assert.equal((await chamar('GET', '/api/reprotocolo/pacotes', TOKENS.junior)).status, 403);
  for (const t of [TOKENS.master, TOKENS.conector]) {
    assert.equal((await chamar('GET', '/api/reprotocolo/pacotes?status=montado&limite=5', t)).corpo.itens[0].status, 'montado');
    assert.equal((await chamar('GET', `/api/reprotocolo/pacotes/${P1}`, t)).corpo.pacote.texto, 'texto');
    assert.equal((await chamar('GET', '/api/reprotocolo/modelos', t)).status, 200);
  }
  assert.equal((await chamar('GET', '/api/reprotocolo/pacotes?status=xx', TOKENS.master)).status, 400);
  assert.equal((await chamar('GET', '/api/reprotocolo/pacotes?limite=0', TOKENS.master)).status, 400);
  assert.equal((await chamar('GET', '/api/reprotocolo/pacotes/nao-uuid', TOKENS.master)).status, 400);
  assert.equal((await chamar('GET', '/api/reprotocolo/pacotes/77777777-7777-4777-8777-777777777777', TOKENS.master)).status, 404);
});

test('escrita do pacote: o conector do chat nunca escreve (403)', async () => {
  const casos = [
    ['POST', '/api/reprotocolo/pacotes/reservar', { tarefa_ids: [T1] }],
    ['POST', `/api/reprotocolo/pacotes/${P1}/montar`, {}],
    ['POST', `/api/reprotocolo/pacotes/${P1}/cancelar`, { motivo: 'motivo válido' }],
    ['PUT', '/api/reprotocolo/modelos', { ente: 'X', tipo: 'inicial', drive_arquivo_id: DRIVE }],
  ];
  for (const [m, url, corpo] of casos) assert.equal((await chamar(m, url, TOKENS.conector, corpo)).status, 403, url);
  assert.equal(ch.reservar.length + ch.montar.length + ch.cancelar.length + ch.modelo.length, 0);
});

test('reservar: valida a lista, devolve o resultado de cada tarefa e audita', async () => {
  const url = '/api/reprotocolo/pacotes/reservar';
  assert.equal((await chamar('POST', url, TOKENS.master, { tarefa_ids: [] })).status, 400);
  assert.equal((await chamar('POST', url, TOKENS.master, { tarefa_ids: ['x'] })).status, 400);
  assert.equal((await chamar('POST', url, TOKENS.master, { tarefa_ids: Array(51).fill(T1) })).status, 400);
  const r = await chamar('POST', url, TOKENS.master, { tarefa_ids: [T1, '22222222-2222-4222-8222-222222222222'] });
  assert.equal(r.status, 200);
  assert.deepEqual([r.corpo.reservados, r.corpo.recusados], [1, 1]);
  assert.equal(ch.reservar.at(-1).usuarioId, 'm1');
  assert.equal(auditoria.at(-1).acao, 'reservar_pacote_reprotocolo');
});

test('montar: valida id e período; repassa o status de erro do serviço; devolve o texto do relatório', async () => {
  assert.equal((await chamar('POST', '/api/reprotocolo/pacotes/x/montar', TOKENS.master, {})).status, 400);
  assert.equal((await chamar('POST', `/api/reprotocolo/pacotes/${P1}/montar`, TOKENS.master, { periodo_inicio_pedido: '13/2021' })).status, 400);
  const ok = await chamar('POST', `/api/reprotocolo/pacotes/${P1}/montar`, TOKENS.master, { periodo_inicio_pedido: '2021-10' });
  assert.equal(ok.status, 200);
  assert.equal(ok.corpo.texto, 'texto');
  assert.equal(ch.montar.at(-1).periodoInicioPedido, '2021-10');
  assert.equal(auditoria.at(-1).acao, 'montar_pacote_reprotocolo');
  respostaMontar = { ok: false, status: 409, erro: 'A confirmação da verificação perdeu a validade: confirme de novo.', motivo: 'expirada' };
  const venc = await chamar('POST', `/api/reprotocolo/pacotes/${P1}/montar`, TOKENS.master, {});
  assert.equal(venc.status, 409);
  assert.equal(venc.corpo.motivo, 'expirada');
});

test('cancelar: exige motivo; 409 quando o pacote já não pode ser cancelado', async () => {
  const url = `/api/reprotocolo/pacotes/${P1}/cancelar`;
  assert.equal((await chamar('POST', url, TOKENS.master, { motivo: 'x' })).status, 400);
  assert.equal((await chamar('POST', url, TOKENS.master, { motivo: 'Cliente desistiu' })).status, 200);
  assert.equal(ch.cancelar.at(-1).motivo, 'Cliente desistiu');
  cancelou = false;
  assert.equal((await chamar('POST', url, TOKENS.master, { motivo: 'Cliente desistiu' })).status, 409);
});

test('modelos: valida ente, tipo, tese e id do Drive; cadastra e audita; tese inexistente 404', async () => {
  const url = '/api/reprotocolo/modelos';
  const ok = { ente: 'Estado da Paraíba', tipo: 'inicial', drive_arquivo_id: DRIVE, titulo: 'Inicial FGTS' };
  assert.equal((await chamar('PUT', url, TOKENS.master, { ...ok, ente: '' })).status, 400);
  assert.equal((await chamar('PUT', url, TOKENS.master, { ...ok, tipo: 'peticao' })).status, 400);
  assert.equal((await chamar('PUT', url, TOKENS.master, { ...ok, tese_id: 'x' })).status, 400);
  assert.equal((await chamar('PUT', url, TOKENS.master, { ...ok, drive_arquivo_id: 'curto' })).status, 400);
  assert.equal((await chamar('PUT', url, TOKENS.master, { ...ok, tese_id: TESE })).status, 200);
  assert.deepEqual(ch.modelo.at(-1), { conexao: 'tx', ente: 'Estado da Paraíba', teseId: TESE, tipo: 'inicial', titulo: 'Inicial FGTS', driveId: DRIVE, usuarioId: 'm1' });
  assert.equal(auditoria.at(-1).acao, 'cadastrar_modelo_reprotocolo');
  erroModelo = Object.assign(new Error('fk'), { code: '23503' });
  assert.equal((await chamar('PUT', url, TOKENS.master, { ...ok, tese_id: TESE })).status, 404);
});

test('importar: só sessão do AM; simulação é o padrão; valida corpo e limites', async () => {
  const url = '/api/reprotocolo/importar';
  const linha = { cliente_id: '44444444-4444-4444-8444-444444444444', status: 'nao_encontrada' };
  assert.equal((await chamar('POST', url, TOKENS.conector, { pastas: [linha] })).status, 403);
  assert.equal((await chamar('POST', url, TOKENS.junior, { pastas: [linha] })).status, 403);
  assert.equal((await chamar('POST', url, TOKENS.master, {})).status, 400);
  assert.equal((await chamar('POST', url, TOKENS.master, { pastas: 'x' })).status, 400);
  assert.equal((await chamar('POST', url, TOKENS.master, { pastas: Array(1001).fill(linha) })).status, 400);
  assert.equal((await chamar('POST', url, TOKENS.master, { pastas: [linha], dry_run: 'nao' })).status, 400);
  assert.equal(ch.importar.length, 0);
  const sim = await chamar('POST', url, TOKENS.master, { pastas: [linha] });
  assert.equal(sim.status, 200);
  assert.equal(sim.corpo.dry_run, true);
  assert.equal(auditoria.at(-1).acao, 'simular_importacao_reprotocolo');
  const real = await chamar('POST', url, TOKENS.master, { pastas: [linha], dry_run: false });
  assert.equal(real.corpo.dry_run, false);
  assert.equal(ch.importar.at(-1).usuarioId, 'm1');
  assert.equal(auditoria.at(-1).acao, 'importar_reprotocolo');
});
