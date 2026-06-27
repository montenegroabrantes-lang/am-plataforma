/**
 * Verifica ciclos recorrentes de teses com intervalo definido (ex: FGTS Remanescente a cada 25 meses).
 * A contagem parte do periodo_fim do último processo arquivado/concluído daquele produto para aquele cliente.
 * Se não houver processo anterior, usa vinculo_inicio do cliente como referência.
 * Chamado diariamente pelo cron job.
 */
import { db } from '../db/index.js';

export async function verificarCiclosRecorrentes() {
  const produtos = await db.query(
    `SELECT id, nome, intervalo_meses, cargos_elegiveis, orgaos_elegiveis
     FROM produtos WHERE ativo = true AND intervalo_meses IS NOT NULL AND intervalo_meses > 0`
  );

  if (produtos.length === 0) return { tarefas: 0 };

  let totalTarefas = 0;
  const hoje = new Date();

  for (const prod of produtos) {
    // Buscar todos os clientes vinculados a este produto
    const vinculos = await db.query(
      `SELECT cp.id AS cliente_produto_id, cp.cliente_id,
              c.nome AS cliente_nome, c.cargo, c.orgao, c.vinculo_inicio
       FROM cliente_produtos cp
       JOIN clientes c ON c.id = cp.cliente_id
       WHERE cp.produto_id = $1 AND c.ativo IS NOT FALSE`,
      [prod.id]
    );

    for (const v of vinculos) {
      // Buscar o último processo deste produto para este cliente com periodo_fim definido
      const ultimoProcesso = await db.queryOne(
        `SELECT periodo_fim, status FROM processos
         WHERE cliente_id = $1 AND produto_id = $2
         AND periodo_fim IS NOT NULL
         ORDER BY periodo_fim DESC LIMIT 1`,
        [v.cliente_id, prod.id]
      );

      // Determinar data de referência para o próximo ciclo
      let dataReferencia = null;

      if (ultimoProcesso?.periodo_fim) {
        // Próximo ciclo = fim do último período + intervalo_meses
        dataReferencia = new Date(ultimoProcesso.periodo_fim);
        dataReferencia.setMonth(dataReferencia.getMonth() + prod.intervalo_meses);
      } else if (v.vinculo_inicio) {
        // Sem processo anterior: usar vinculo_inicio + intervalo como primeira elegibilidade
        dataReferencia = new Date(v.vinculo_inicio);
        dataReferencia.setMonth(dataReferencia.getMonth() + prod.intervalo_meses);
      } else {
        // Sem referência de data — pular
        continue;
      }

      // Verificar se a data de elegibilidade já chegou
      if (dataReferencia > hoje) continue;

      // Verificar se já existe processo ou tarefa aberta para o ciclo atual
      const processoAberto = await db.queryOne(
        `SELECT id FROM processos
         WHERE cliente_id = $1 AND produto_id = $2
         AND status NOT IN ('arquivado')
         AND (periodo_fim IS NULL OR periodo_fim >= $3)`,
        [v.cliente_id, prod.id, dataReferencia]
      );
      if (processoAberto) continue;

      const tarefaPendente = await db.queryOne(
        `SELECT id FROM tarefas
         WHERE cliente_produto_id = $1 AND tipo = 'protocolar'
         AND status NOT IN ('concluida','cancelada')`,
        [v.cliente_produto_id]
      );
      if (tarefaPendente) continue;

      // Criar tarefa de novo ciclo
      const mesAno = dataReferencia.toLocaleDateString('pt-BR', { month: '2-digit', year: 'numeric' });
      await db.execute(
        `INSERT INTO tarefas (cliente_produto_id, tipo, descricao, urgencia, status)
         VALUES ($1, 'protocolar', $2, 'MEDIO', 'pendente')`,
        [
          v.cliente_produto_id,
          `Protocolar processo — ${prod.nome} — ${v.cliente_nome} (novo ciclo a partir de ${mesAno})`,
        ]
      );

      console.log(`[Ciclos] Tarefa criada: ${prod.nome} — ${v.cliente_nome} (ciclo ${mesAno})`);
      totalTarefas++;
    }
  }

  return { tarefas: totalTarefas };
}
