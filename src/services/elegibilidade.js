/**
 * Verifica elegibilidade de clientes para produtos/teses jurídicas
 * e cria automaticamente vínculos + tarefas de protocolo.
 *
 * Chamado em dois contextos:
 *  1. Após cadastrar/editar um CLIENTE — verifica todos os produtos
 *  2. Após cadastrar/editar um PRODUTO com critérios — verifica todos os clientes
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
 * Cria vínculo cliente_produto e tarefa de protocolo se ainda não existirem.
 * @param {string} clienteId
 * @param {string} userId — quem disparou (para validado_por na tarefa)
 * @returns {{ vinculados: number, tarefas: number }}
 */
export async function verificarElegibilidadeCliente(clienteId, userId) {
  const cliente = await db.queryOne(
    'SELECT id, nome, cargo, orgao FROM clientes WHERE id = $1',
    [clienteId]
  );
  if (!cliente) return { vinculados: 0, tarefas: 0 };

  const produtos = await db.query(
    'SELECT id, nome, cargos_elegiveis, orgaos_elegiveis FROM produtos WHERE ativo = true'
  );

  let vinculados = 0;
  let tarefas = 0;

  for (const prod of produtos) {
    if (!corresponde(cliente.cargo, prod.cargos_elegiveis)) continue;
    if (!corresponde(cliente.orgao, prod.orgaos_elegiveis)) continue;

    // Verificar se já existe processo cadastrado desse produto para o cliente
    const processoExistente = await db.queryOne(
      `SELECT p.id FROM processos p
       WHERE p.cliente_id = $1 AND p.produto_id = $2
       AND p.status NOT IN ('arquivado') LIMIT 1`,
      [clienteId, prod.id]
    );
    if (processoExistente) continue; // já tem processo — não criar tarefa

    // Criar ou recuperar vínculo cliente_produto
    let vinculo = await db.queryOne(
      'SELECT id FROM cliente_produtos WHERE cliente_id = $1 AND produto_id = $2',
      [clienteId, prod.id]
    );

    if (!vinculo) {
      const [novo] = await db.query(
        `INSERT INTO cliente_produtos (cliente_id, produto_id, honorarios_pct)
         VALUES ($1, $2, 0) RETURNING id`,
        [clienteId, prod.id]
      );
      vinculo = novo;
      vinculados++;
    }

    // Criar tarefa se não houver pendente
    const tarefaExistente = await db.queryOne(
      `SELECT id FROM tarefas
       WHERE cliente_produto_id = $1 AND tipo = 'protocolar'
       AND status NOT IN ('concluida','cancelada')`,
      [vinculo.id]
    );
    if (tarefaExistente) continue;

    await db.execute(
      `INSERT INTO tarefas (cliente_produto_id, tipo, descricao, urgencia, validado_por, status)
       VALUES ($1, 'protocolar', $2, 'MEDIO', $3, 'pendente')`,
      [
        vinculo.id,
        `Protocolar processo — ${prod.nome} — ${cliente.nome}`,
        userId,
      ]
    );
    tarefas++;
  }

  return { vinculados, tarefas };
}

/**
 * Verifica todos os clientes elegíveis para um produto específico.
 * Chamado após criar/editar um produto com critérios de elegibilidade.
 * @param {string} produtoId
 * @param {string} userId
 * @returns {{ vinculados: number, tarefas: number }}
 */
export async function verificarElegibilidadeProduto(produtoId, userId) {
  const prod = await db.queryOne(
    'SELECT id, nome, cargos_elegiveis, orgaos_elegiveis FROM produtos WHERE id = $1 AND ativo = true',
    [produtoId]
  );
  if (!prod) return { vinculados: 0, tarefas: 0 };

  // Se o produto não tem critérios definidos, não varre automaticamente
  if ((!prod.cargos_elegiveis || prod.cargos_elegiveis.length === 0) &&
      (!prod.orgaos_elegiveis || prod.orgaos_elegiveis.length === 0)) {
    return { vinculados: 0, tarefas: 0 };
  }

  const clientes = await db.query(
    'SELECT id, nome, cargo, orgao FROM clientes WHERE ativo IS NOT FALSE AND vinculo_ativo = true'
  );

  let vinculados = 0;
  let tarefas = 0;

  for (const cliente of clientes) {
    if (!corresponde(cliente.cargo, prod.cargos_elegiveis)) continue;
    if (!corresponde(cliente.orgao, prod.orgaos_elegiveis)) continue;

    const processoExistente = await db.queryOne(
      `SELECT id FROM processos WHERE cliente_id = $1 AND produto_id = $2
       AND status NOT IN ('arquivado') LIMIT 1`,
      [cliente.id, prod.id]
    );
    if (processoExistente) continue;

    let vinculo = await db.queryOne(
      'SELECT id FROM cliente_produtos WHERE cliente_id = $1 AND produto_id = $2',
      [cliente.id, prod.id]
    );

    if (!vinculo) {
      const [novo] = await db.query(
        `INSERT INTO cliente_produtos (cliente_id, produto_id, honorarios_pct)
         VALUES ($1, $2, 0) RETURNING id`,
        [cliente.id, prod.id]
      );
      vinculo = novo;
      vinculados++;
    }

    const tarefaExistente = await db.queryOne(
      `SELECT id FROM tarefas
       WHERE cliente_produto_id = $1 AND tipo = 'protocolar'
       AND status NOT IN ('concluida','cancelada')`,
      [vinculo.id]
    );
    if (tarefaExistente) continue;

    await db.execute(
      `INSERT INTO tarefas (cliente_produto_id, tipo, descricao, urgencia, validado_por, status)
       VALUES ($1, 'protocolar', $2, 'MEDIO', $3, 'pendente')`,
      [
        vinculo.id,
        `Protocolar processo — ${prod.nome} — ${cliente.nome}`,
        userId,
      ]
    );
    tarefas++;
  }

  return { vinculados, tarefas };
}
