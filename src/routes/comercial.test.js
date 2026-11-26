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
const { criarComercialRouter } = await import('./comercial.js');

const O1 = '33333333-3333-4333-8333-333333333333';
const agora = new Date('2026-11-25T12:00:00Z');
const ha = dias => new Date(agora - dias * 86_400_000).toISOString();
let fechamentos, camilaModo, sqls;
const banco = {
  async query(sql, params) {
    sqls.push(sql);
    if (sql.includes('SELECT camila_contact_id')) return [{ camila_contact_id: '77' }];
    if (sql.includes('FROM tarefas')) { assert.deepEqual(params, [[O1]]); return [{ onboarding_id: O1, tipo: 'protocolar', status: 'pendente' }]; }
    if (sql.includes('FROM onboardings_contrato o')) return fechamentos;
    throw new Error(`inesperado: ${sql.slice(0, 60)}`);
  },
};
const clienteCamila = () => (camilaModo === 'sem' ? null : {
  async get(caminho) {
    assert.equal(caminho, '/api/funil-leads');
    if (camilaModo === 'erro') throw new Error('fora do ar');
    return { data: { ok: true, leads: [
      { contact_id: 5, nome: 'Lead Proposta', etapa: 'proposta_enviada', proposta_enviada_em: ha(8) },
      { contact_id: 77, nome: 'Já ativado', etapa: 'assinado' },
      { contact_id: 9, nome: 'Novo', etapa: 'simulou' },
    ] } };
  },
});

const app = express();
app.use(express.json());
app.use('/api/comercial', autenticar, criarComercialRouter({ banco, clienteCamila, agora: () => agora }));
app.use((err, _req, res, _next) => res.status(500).json({ ok: false, erro: err.message }));
const servidor = app.listen(0);
const base = `http://127.0.0.1:${servidor.address().port}`;
after(() => servidor.close());
const assinar = p => jwt.sign(p, process.env.JWT_SECRET, { expiresIn: '1h' });
const chamar = async (perfil = 'master') => {
  const r = await fetch(`${base}/api/comercial/quadro`, { headers: { Authorization: `Bearer ${assinar({ id: 'u', perfil, email: 'u@exemplo.com' })}` } });
  return { status: r.status, corpo: await r.json() };
};

beforeEach(() => {
  sqls = []; camilaModo = 'ok';
  fechamentos = [{ id: O1, status: 'protocolo_pendente', nome: 'Cliente Um', fechado_em: ha(30), responsavel_protocolo_nome: 'Bia' }];
});

test('acesso: só Master', async () => {
  assert.equal((await chamar('junior')).status, 403);
  assert.equal((await chamar()).status, 200);
});

test('quadro: junta leads da Camila e fechamentos; lead já ativado e lead sem proposta ficam fora', async () => {
  const { corpo } = await chamar();
  const por = Object.fromEntries(corpo.colunas.map(c => [c.id, c]));
  assert.deepEqual(por.proposta.cartoes.map(c => c.nome), ['Lead Proposta']);
  assert.equal(por.ativar.total, 0);
  assert.equal(por.protocolo.cartoes[0].detalhe, '0 de 1 ações protocoladas');
  assert.deepEqual([corpo.total, corpo.atrasados, corpo.leads_status, corpo.limites_provisorios], [2, 2, 'ok', true]);
});

test('Camila fora do ar ou sem configuração: o quadro do sistema continua e avisa', async () => {
  camilaModo = 'erro';
  let { corpo } = await chamar();
  assert.deepEqual([corpo.leads_status, corpo.total], ['indisponivel', 1]);
  camilaModo = 'sem';
  ({ corpo } = await chamar());
  assert.deepEqual([corpo.leads_status, corpo.total], ['nao_configurado', 1]);
});

test('sem fechamentos não consulta tarefas; nenhuma consulta escreve', async () => {
  fechamentos = [];
  await chamar();
  assert.equal(sqls.some(s => s.includes('FROM tarefas')), false);
  for (const s of sqls) assert.doesNotMatch(s, /\b(INSERT|UPDATE|DELETE)\b/);
});
