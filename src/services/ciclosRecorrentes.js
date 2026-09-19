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
       WHERE cp.produto_id = $1 AND c.ativo IS NOT FALSE AND c.vinculo_ativo = true`,
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

      // Início do período acumulado: mês seguinte ao fim do último processo; sem processo,
      // o próprio início do vínculo. A elegibilidade chega quando passam intervalo_meses.
      // Tudo em UTC: DATE chega como 'YYYY-MM-DD' e new Date() o interpreta como meia-noite UTC;
      // usar setters locais aqui deslocaria o dia conforme o TZ do servidor e quebraria o dedup.
      let cicloInicio = null;
      if (ultimoProcesso?.periodo_fim) {
        cicloInicio = new Date(ultimoProcesso.periodo_fim);
        cicloInicio.setUTCDate(1);
        cicloInicio.setUTCMonth(cicloInicio.getUTCMonth() + 1);
      } else if (v.vinculo_inicio) {
        cicloInicio = new Date(v.vinculo_inicio);
        cicloInicio.setUTCDate(1);
      } else {
        continue; // sem referência de data
      }
      const dataReferencia = new Date(cicloInicio);
      dataReferencia.setUTCMonth(dataReferencia.getUTCMonth() + prod.intervalo_meses - 1);
      if (dataReferencia > hoje) continue;

      // Já existe processo cobrindo este ciclo?
      const processoAberto = await db.queryOne(
        `SELECT id FROM processos
         WHERE cliente_id = $1 AND produto_id = $2
         AND status NOT IN ('arquivado')
         AND (periodo_fim IS NULL OR periodo_fim >= $3)`,
        [v.cliente_id, prod.id, cicloInicio]
      );
      if (processoAberto) continue;

      // Já existe tarefa de protocolo aberta, ou um ciclo com este mesmo início que foi
      // descartado pela equipe? Nos dois casos não recriamos — descartar tem que valer.
      const cicloInicioIso = cicloInicio.toISOString().slice(0, 10);
      const tarefaExistente = await db.queryOne(
        `SELECT id FROM tarefas
         WHERE cliente_produto_id = $1 AND tipo = 'protocolar'
           AND (status NOT IN ('concluida','cancelada') OR ciclo_inicio = $2::date)
         LIMIT 1`,
        [v.cliente_produto_id, cicloInicioIso]
      );
      if (tarefaExistente) continue;

      await db.execute(
        `INSERT INTO tarefas (cliente_produto_id, tipo, subtipo, descricao, urgencia, status, ciclo_inicio)
         VALUES ($1, 'protocolar', 'ciclo', $2, 'MEDIO', 'pendente', $3::date)`,
        [v.cliente_produto_id, `Novo ciclo — ${prod.nome} — ${v.cliente_nome}`, cicloInicioIso]
      );
      const periodoTexto = `${cicloInicio.toLocaleDateString('pt-BR', { month: '2-digit', year: 'numeric', timeZone: 'UTC' })} até hoje`;

      console.log(`[Ciclos] Tarefa criada: ${prod.nome} — ${v.cliente_nome} | ${periodoTexto}`);
      totalTarefas++;
    }
  }

  return { tarefas: totalTarefas };
}
