// Uso único: remove as duplicatas inativas de "ADICIONAL NOTURNO" e "Equiparação salarial
// no magistério" (0 processos ligados a nenhuma delas; os 3 clientes do ADICIONAL NOTURNO
// inativo já têm vínculo com o produto ativo correto — verificado em 22/09/2026).
// Rodar com: node scripts/limpar-duplicatas-produtos-2026-09-22.js
import { db } from '../src/db/index.js';

const IDS = [
  '7f5f4fab-bf68-4414-9ed0-2cd48426b935', // ADICIONAL NOTURNO (inativo, 3 vínculos órfãos)
  'f4b5031c-21ba-4b90-8743-9f84e48693c4', // Equiparação salarial no magistério (inativo, vazio)
  'bf0fea0d-99b6-4bfa-9325-54b782b15280', // Equiparação salarial no magistério (inativo, vazio)
];

await db.transaction(async (tx) => {
  // As 3 tarefas 'protocolar' ligadas aos vínculos órfãos já estão canceladas (histórico
  // morto) -- anula a referência em vez de apagar a tarefa, preservando o registro.
  const upd = await tx.execute(
    `UPDATE tarefas SET cliente_produto_id = NULL
     WHERE cliente_produto_id IN (SELECT id FROM cliente_produtos WHERE produto_id = ANY($1))`,
    [IDS]
  );
  console.log('tarefas desvinculadas:', upd.rowCount);
  const del1 = await tx.execute(`DELETE FROM cliente_produtos WHERE produto_id = ANY($1)`, [IDS]);
  console.log('cliente_produtos removidos:', del1.rowCount);
  const del2 = await tx.execute(`DELETE FROM produtos WHERE id = ANY($1)`, [IDS]);
  console.log('produtos removidos:', del2.rowCount);
  await tx.execute(
    `INSERT INTO logs_auditoria (usuario_id, acao, entidade, valor_depois)
     VALUES ((SELECT id FROM usuarios WHERE email='integracao-claude@abrantesemontenegro.com.br'), 'excluir_lote', 'produto', $1)`,
    [JSON.stringify({ motivo: 'Duplicatas inativas sem processos ligados, a pedido do usuário em 22/09/2026', produtos: IDS })]
  ).catch(e => console.warn('auditoria falhou:', e.message));
});

console.log('OK — transação confirmada.');
process.exit(0);
