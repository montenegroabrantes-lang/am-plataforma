/**
 * Verifica elegibilidade de clientes para produtos/teses jurídicas.
 *
 * Regra importante: elegibilidade é apenas sugestão. Vínculo contratual e tarefa de
 * protocolo só podem nascer de confirmação humana, com honorários e responsável.
 */
import { db } from '../db/index.js';

function normalizar(str) {
  return String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function corresponde(valor, lista) {
  if (!lista || lista.length === 0) return true; // sem restrição = aceita todos
  const v = normalizar(valor);
  return lista.some(item => normalizar(item) === v);
}

/**
 * Verifica um cliente contra todos os produtos elegíveis.
 * @param {string} clienteId
 * @returns {{ sugestoes: Array, vinculados: number, tarefas: number }}
 */
export async function verificarElegibilidadeCliente(clienteId) {
  const cliente = await db.queryOne(
    'SELECT id, nome, cargo, orgao, vinculo_inicio FROM clientes WHERE id = $1',
    [clienteId]
  );
  if (!cliente) return { sugestoes: [], vinculados: 0, tarefas: 0 };

  const produtos = await db.query(
    'SELECT id, nome, cargos_elegiveis, orgaos_elegiveis, intervalo_meses FROM produtos WHERE ativo = true'
  );

  const sugestoes = [];

  for (const prod of produtos) {
    // Produto sem nenhum critério é catálogo manual, não sugestão universal.
    if ((!prod.cargos_elegiveis || prod.cargos_elegiveis.length === 0) &&
        (!prod.orgaos_elegiveis || prod.orgaos_elegiveis.length === 0)) continue;
    if (!corresponde(cliente.cargo, prod.cargos_elegiveis)) continue;
    if (!corresponde(cliente.orgao, prod.orgaos_elegiveis)) continue;

    // Verificar se já existe processo cadastrado desse produto para o cliente
    const processoExistente = await db.queryOne(
      `SELECT p.id FROM processos p
       WHERE p.cliente_id = $1 AND p.produto_id = $2
       AND p.status NOT IN ('arquivado') LIMIT 1`,
      [clienteId, prod.id]
    );
    if (processoExistente) continue;
    sugestoes.push(prod);
  }

  return { sugestoes, vinculados: 0, tarefas: 0 };
}

/**
 * Verifica todos os clientes elegíveis para um produto específico.
 * Chamado após criar/editar um produto com critérios de elegibilidade.
 * @param {string} produtoId
 * Retorna apenas a quantidade de clientes compatíveis para apoiar configuração.
 */
export async function verificarElegibilidadeProduto(produtoId) {
  const prod = await db.queryOne(
    'SELECT id, nome, cargos_elegiveis, orgaos_elegiveis, intervalo_meses FROM produtos WHERE id = $1 AND ativo = true',
    [produtoId]
  );
  if (!prod) return { vinculados: 0, tarefas: 0 };

  // Se o produto não tem critérios definidos, não varre automaticamente
  if ((!prod.cargos_elegiveis || prod.cargos_elegiveis.length === 0) &&
      (!prod.orgaos_elegiveis || prod.orgaos_elegiveis.length === 0)) {
    return { vinculados: 0, tarefas: 0 };
  }

  const clientes = await db.query(
    'SELECT id, nome, cargo, orgao, vinculo_inicio FROM clientes WHERE ativo IS NOT FALSE AND vinculo_ativo = true'
  );

  let elegiveis = 0;

  for (const cliente of clientes) {
    if (!corresponde(cliente.cargo, prod.cargos_elegiveis)) continue;
    if (!corresponde(cliente.orgao, prod.orgaos_elegiveis)) continue;

    const processoExistente = await db.queryOne(
      `SELECT id FROM processos WHERE cliente_id = $1 AND produto_id = $2
       AND status NOT IN ('arquivado') LIMIT 1`,
      [cliente.id, prod.id]
    );
    if (processoExistente) continue;

    elegiveis++;
  }

  return { elegiveis, vinculados: 0, tarefas: 0 };
}
