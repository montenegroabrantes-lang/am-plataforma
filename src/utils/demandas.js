import { db } from '../db/index.js';

// Resolve (ou cria) a demanda jurídica por trás de uma tarefa de protocolo: identidade =
// cliente + produto + vínculo + período, em vez de inferir isso por convenção espalhada em
// cliente_produto_id/cliente_vinculo_id/ciclo_inicio. Vínculo ainda não conhecido (NULL) nunca
// reaproveita uma demanda existente — sempre cria uma nova — porque não dá pra garantir que é
// a mesma demanda por trás do mesmo NULL (o mesmo erro corrigido na Fase 1.7 pro índice único
// de tarefas: NULL nunca é igual a NULL, então cada demanda ambígua fica isolada).
export async function resolverDemanda({ clienteId, produtoId, clienteVinculoId, periodoInicio }, pgClient = db) {
  const executor = pgClient.query ? pgClient : db;
  if (clienteVinculoId) {
    const resultado = await executor.query(
      `SELECT id FROM demandas WHERE cliente_id=$1 AND produto_id=$2 AND cliente_vinculo_id=$3
         AND periodo_inicio IS NOT DISTINCT FROM $4 AND status NOT IN ('concluida','cancelada') LIMIT 1`,
      [clienteId, produtoId, clienteVinculoId, periodoInicio || null]
    );
    const linhas = resultado.rows || resultado;
    if (Array.isArray(linhas) && linhas[0]) return linhas[0].id;
  }
  const criado = await executor.query(
    `INSERT INTO demandas (cliente_id, produto_id, cliente_vinculo_id, periodo_inicio, status)
     VALUES ($1,$2,$3,$4,'aberta') RETURNING id`,
    [clienteId, produtoId, clienteVinculoId || null, periodoInicio || null]
  );
  const linhasCriado = criado.rows || criado;
  return linhasCriado[0].id;
}
