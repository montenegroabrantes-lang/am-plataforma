import test from 'node:test';
import assert from 'node:assert/strict';
import { trocarClienteDoProcesso, ErroTroca } from './trocarClienteProcesso.js';

const NADJA = 'd743682a-9f7d-4919-bfc0-3b4b02c0e92b';
const MARIA = 'd70c027c-4b4d-4e1a-a83f-3116b3a1397e';
const PROC = '64425226-7797-48c9-92a3-fb3c32c7a8b7';

function banco({ processo, destino = { id: MARIA, nome: 'MARIA DO SOCORRO' }, tarefasPresas = 0, temTese = false }) {
  const exec = [];
  const tx = {
    async queryOne(sql) {
      if (sql.includes('FROM processos p')) return processo;
      if (sql.includes('FROM clientes WHERE id')) return destino;
      if (sql.includes('FROM tarefas WHERE processo_id')) return { n: String(tarefasPresas) };
      if (sql.includes('FROM cliente_produtos')) return temTese ? { ok: 1 } : null;
      throw new Error('inesperado: ' + sql.slice(0, 50));
    },
    async execute(sql, params) { exec.push({ sql, params }); },
  };
  return { exec, db: { transaction: fn => fn(tx) } };
}
const PROCESSO = { id: PROC, numero: '0819569-63.2026.8.15.2001', cliente_id: NADJA, produto_id: 'p1', cliente_nome: 'NADJA' };

test('troca: atualiza processo, tarefas e cobranças e audita antes/depois; avisa tese sem vínculo no destino', async () => {
  const { db, exec } = banco({ processo: PROCESSO });
  const auditorias = [];
  const r = await trocarClienteDoProcesso({ processoId: PROC, clienteId: MARIA, usuarioId: 'u1' }, { db, auditar: async (a, tx) => auditorias.push({ a, tx }) });
  assert.deepEqual(r.cliente, { id: MARIA, nome: 'MARIA DO SOCORRO' });
  assert.equal(r.tese_sem_vinculo, true);
  assert.match(exec[0].sql, /UPDATE processos SET cliente_id/);
  assert.ok(exec.some(e => /UPDATE tarefas SET cliente_id/.test(e.sql)));
  assert.ok(exec.some(e => /UPDATE cobrancas_cliente SET cliente_id/.test(e.sql)));
  assert.equal(auditorias[0].a.acao, 'trocar_cliente_processo');
  assert.equal(auditorias[0].a.valorAntes.cliente_id, NADJA);
  assert.equal(auditorias[0].a.valorDepois.cliente_id, MARIA);
  assert.ok(auditorias[0].tx, 'auditoria na mesma transação');
});

test('troca: destino com a tese do processo não gera aviso', async () => {
  const { db } = banco({ processo: PROCESSO, temTese: true });
  const r = await trocarClienteDoProcesso({ processoId: PROC, clienteId: MARIA, usuarioId: 'u1' }, { db, auditar: async () => {} });
  assert.equal(r.tese_sem_vinculo, false);
});

test('troca: recusa processo inexistente, cliente inativo, mesmo cliente e tarefas presas ao contrato', async () => {
  const chama = (cfg) => trocarClienteDoProcesso({ processoId: PROC, clienteId: MARIA, usuarioId: 'u1' }, { db: banco(cfg).db, auditar: async () => {} });
  await assert.rejects(() => chama({ processo: null }), e => e instanceof ErroTroca && e.status === 404);
  await assert.rejects(() => chama({ processo: PROCESSO, destino: null }), e => e.status === 404);
  await assert.rejects(() => chama({ processo: { ...PROCESSO, cliente_id: MARIA } }), e => e.status === 400);
  await assert.rejects(() => chama({ processo: PROCESSO, tarefasPresas: 2 }), e => e.status === 409 && /2 tarefa/.test(e.message));
});

test('troca: nada é gravado quando a regra recusa', async () => {
  const { db, exec } = banco({ processo: PROCESSO, tarefasPresas: 1 });
  await assert.rejects(() => trocarClienteDoProcesso({ processoId: PROC, clienteId: MARIA, usuarioId: 'u1' }, { db, auditar: async () => { throw new Error('não deveria auditar'); } }));
  assert.equal(exec.length, 0);
});
