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
const { criarHojeRouter } = await import('./hoje.js');

const ID = '11111111-1111-4111-8111-111111111111';
const agora = new Date('2026-11-26T15:00:00Z');
let tarefa, juntadas, gravacoes, auditorias, apagados, linhasAfetadas;
const banco = {
  async queryOne() { return tarefa; },
  async query(sql) { if (sql.includes('FROM movimentacoes')) return juntadas; if (sql.includes('FROM acervo_pecas')) return []; throw new Error('inesperado'); },
  async execute(sql, params) { gravacoes.push({ sql: sql.replace(/\s+/g, ' '), params }); return { rowCount: linhasAfetadas }; },
};
beforeEach(() => {
  tarefa = { id: ID, tipo: 'prazo', status: 'pendente', descricao: 'Prazo — Contrarrazões', prazo_data: '2026-12-04', processo_id: 'p1', atribuido_a: 'j1',
    calendar_event_id: 'evento-1', visibilidade: 'normal', inicio: '2026-11-23' };
  juntadas = [{ processo_id: 'p1', data: '2026-11-24', texto: 'Juntada de Petição de petição' }];
  gravacoes = []; auditorias = []; apagados = []; linhasAfetadas = 1;
});

const app = express();
app.use(express.json());
app.use('/api/hoje', autenticar, criarHojeRouter({ banco, agora: () => agora, auditar: async a => { auditorias.push(a); }, apagarEvento: async id => { apagados.push(id); } }));
app.use((err, _req, res, _next) => res.status(500).json({ ok: false, erro: err.message }));
const servidor = app.listen(0);
const base = `http://127.0.0.1:${servidor.address().port}`;
after(() => servidor.close());
const cumprir = async (usuario, id = ID) => {
  const token = jwt.sign({ email: 'u@exemplo.com', nome: 'Fulana', ...usuario }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const r = await fetch(`${base}/api/hoje/prazos/${id}/cumprir`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  return { status: r.status, corpo: await r.json() };
};

test('Master confirma: conclui, anota quem e por quê, audita e tira o evento da agenda', async () => {
  const { status, corpo } = await cumprir({ id: 'm1', perfil: 'master' });
  assert.equal(status, 200);
  assert.equal(corpo.tarefa_id, ID);
  assert.equal(gravacoes.length, 1);
  assert.match(gravacoes[0].sql, /UPDATE tarefas SET status = 'concluida'.*WHERE id = \$1 AND status = 'pendente'/);
  assert.equal(gravacoes[0].params[1], 'Cumprido: petição juntada em 24/11/2026; confirmado por Fulana na tela Hoje.');
  assert.deepEqual(apagados, ['evento-1']);
  assert.deepEqual([auditorias[0].acao, auditorias[0].usuarioId, auditorias[0].valorDepois.origem], ['cumprir_prazo', 'm1', 'hoje']);
});

test('Júnior só confirma a própria tarefa', async () => {
  assert.equal((await cumprir({ id: 'j1', perfil: 'junior' })).status, 200);
  gravacoes = [];
  assert.equal((await cumprir({ id: 'j2', perfil: 'junior' })).status, 404);
  assert.equal(gravacoes.length, 0);
});

test('Master sem acesso a processo restrito não confirma', async () => {
  tarefa.visibilidade = 'restrito';
  assert.equal((await cumprir({ id: 'm1', perfil: 'master' })).status, 404);
  assert.equal((await cumprir({ id: 'm1', perfil: 'master', pode_marcar_restrito: true })).status, 200);
});

test('sem petição juntada depois da publicação não há baixa por aqui', async () => {
  juntadas = [];
  const { status, corpo } = await cumprir({ id: 'm1', perfil: 'master' });
  assert.equal(status, 409);
  assert.match(corpo.erro, /tela Tarefas/);
  assert.equal(gravacoes.length, 0);
  assert.equal(apagados.length, 0);
});

test('recusa id inválido, tarefa inexistente, outro tipo, prazo já fechado e disputa de gravação', async () => {
  assert.equal((await cumprir({ id: 'm1', perfil: 'master' }, 'abc')).status, 400);
  tarefa.tipo = 'protocolar';
  assert.equal((await cumprir({ id: 'm1', perfil: 'master' })).status, 409);
  tarefa.tipo = 'prazo'; tarefa.status = 'cancelada';
  assert.equal((await cumprir({ id: 'm1', perfil: 'master' })).status, 409);
  tarefa.status = 'pendente'; linhasAfetadas = 0;
  assert.equal((await cumprir({ id: 'm1', perfil: 'master' })).status, 409);
  assert.equal(auditorias.length, 0);
  tarefa = null;
  assert.equal((await cumprir({ id: 'm1', perfil: 'master' })).status, 404);
});
