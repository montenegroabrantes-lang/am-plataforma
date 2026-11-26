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

const agora = new Date('2026-11-25T15:00:00Z');
let consultas;
const banco = {
  async query(sql, params = []) {
    consultas.push({ sql: sql.replace(/\s+/g, ' '), params });
    if (sql.includes('FROM tarefas t')) return [{ id: 1, tipo: 'prazo', descricao: 'Réplica', prazo_data: '2026-11-24', processo_numero: '0800001-11.2026.8.15.2001' }];
    if (sql.includes('FROM despachos_itens')) return [{ id: 'a', observacao: 'Petição' }];
    if (sql.includes('FROM publicacoes pb')) return [{ id: 'p', tipo_documento: 'Sentença', data_disponibilizacao: '2026-11-25' }];
    if (sql.includes('FROM onboardings_contrato')) return [{ status: 'protocolo_pendente', total: 21, dias_medio: 47 }];
    if (sql.includes('FROM precatorios')) return [
      { etapa: 'incluido_orcamento', exercicio: 2027, habilitacao_ramon: 'habilitado', habilitacao_luciano: 'pendente', processo_origem_id: null },
      { etapa: 'autuado', exercicio: null, habilitacao_ramon: 'protocolada', habilitacao_luciano: 'habilitado', processo_origem_id: 'x' }];
    throw new Error(`inesperado: ${sql.slice(0, 60)}`);
  },
};

const app = express();
app.use('/api/hoje', autenticar, criarHojeRouter({ banco, agora: () => agora }));
app.use((err, _req, res, _next) => res.status(500).json({ ok: false, erro: err.message }));
const servidor = app.listen(0);
const base = `http://127.0.0.1:${servidor.address().port}`;
after(() => servidor.close());
const assinar = p => jwt.sign(p, process.env.JWT_SECRET, { expiresIn: '1h' });
const chamar = async (usuario, query = '') => {
  const r = await fetch(`${base}/api/hoje${query}`, { headers: { Authorization: `Bearer ${assinar({ email: 'u@exemplo.com', ...usuario })}` } });
  return { status: r.status, corpo: await r.json() };
};
beforeEach(() => { consultas = []; });

test('Master: fila do escritório com os quatro grupos e os painéis', async () => {
  const { corpo } = await chamar({ id: 'm1', perfil: 'master' });
  assert.deepEqual(corpo.resumo.map(c => [c.chave, c.total]), [['prazo', 1], ['assinar', 1], ['protocolar', 0], ['decisao', 1]]);
  assert.equal(corpo.fila[0].quando, 'venceu há 1 dia');
  assert.deepEqual([corpo.escopo, corpo.pode_ver_todas], ['todas', true]);
  assert.deepEqual(corpo.comercial, { cadastro: { total: 0, dias_medio: null }, protocolo: { status: 'protocolo_pendente', total: 21, dias_medio: 47 } });
  assert.deepEqual(corpo.precatorios, { total: 2, habilitacao: 1, habilitacao_conferir: 1, sem_decisao: 1, exercicio_vencido: 0, sem_origem: 1 });
  const tarefas = consultas.find(c => c.sql.includes('FROM tarefas t'));
  assert.doesNotMatch(tarefas.sql, /atribuido_a = \$1/);
  assert.match(tarefas.sql, /p\.visibilidade = 'normal'/);
});

test('Master com ?de=minhas e Master 01: filtro por dono e visibilidade', async () => {
  await chamar({ id: 'm1', perfil: 'master', pode_marcar_restrito: true }, '?de=minhas');
  const tarefas = consultas.find(c => c.sql.includes('FROM tarefas t'));
  assert.match(tarefas.sql, /atribuido_a = \$1/);
  assert.deepEqual(tarefas.params, ['m1']);
  assert.doesNotMatch(tarefas.sql, /visibilidade = 'normal'/);
});

test('Júnior: só as próprias tarefas; nada de assinaturas, decisões, Comercial ou Precatórios', async () => {
  const { corpo } = await chamar({ id: 'j1', perfil: 'junior' });
  assert.equal(consultas.length, 1);
  assert.deepEqual(consultas[0].params, ['j1']);
  assert.deepEqual(corpo.resumo.map(c => c.total), [1, 0, 0, 0]);
  assert.deepEqual([corpo.escopo, corpo.pode_ver_todas, corpo.comercial, corpo.precatorios], ['minhas', false, null, null]);
});

test('só leitura', async () => {
  await chamar({ id: 'm1', perfil: 'master' });
  for (const c of consultas) assert.doesNotMatch(c.sql, /\b(INSERT|UPDATE|DELETE)\b/);
});
