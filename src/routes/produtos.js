import { Router } from 'express';
import { db }      from '../db/index.js';
import { apenasMaster } from '../middleware/auth.js';
import { verificarElegibilidadeProduto } from '../services/elegibilidade.js';

export const produtosRouter = Router();

// GET /api/produtos — catálogo completo
produtosRouter.get('/', async (req, res) => {
  const { ativo = 'true' } = req.query;
  const rows = await db.query(
    `SELECT * FROM produtos WHERE ativo = $1 ORDER BY nome`,
    [ativo === 'true']
  );
  res.json({ ok: true, produtos: rows });
});

// POST /api/produtos — criar produto
produtosRouter.post('/', apenasMaster, async (req, res) => {
  const { nome, polo_passivo_padrao, codigo_assunto_pje,
          tribunais_padrao, cargos_elegiveis, orgaos_elegiveis } = req.body;

  if (!nome) return res.status(400).json({ ok: false, erro: 'nome é obrigatório.' });

  const [novo] = await db.query(
    `INSERT INTO produtos (nome, polo_passivo_padrao, codigo_assunto_pje,
                           tribunais_padrao, cargos_elegiveis, orgaos_elegiveis)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [
      nome.trim(),
      polo_passivo_padrao || null,
      codigo_assunto_pje  || null,
      tribunais_padrao    || null,
      cargos_elegiveis    || null,
      orgaos_elegiveis    || null,
    ]
  );
  // Varrer clientes elegíveis em background
  verificarElegibilidadeProduto(novo.id, req.user.id)
    .then(({ vinculados, tarefas }) => {
      if (tarefas > 0) console.log(`[Elegibilidade] Produto "${novo.nome}": ${vinculados} clientes vinculados, ${tarefas} tarefas criadas.`);
    })
    .catch(err => console.warn('[Elegibilidade] Erro no produto:', err.message));

  res.status(201).json({ ok: true, produto: novo });
});

// PATCH /api/produtos/:id — atualizar produto
produtosRouter.patch('/:id', apenasMaster, async (req, res) => {
  const campos = ['nome', 'polo_passivo_padrao', 'codigo_assunto_pje',
                  'tribunais_padrao', 'cargos_elegiveis', 'orgaos_elegiveis', 'ativo'];
  const updates = [];
  const params  = [];

  for (const campo of campos) {
    if (req.body[campo] !== undefined) {
      params.push(req.body[campo]);
      updates.push(`${campo} = $${params.length}`);
    }
  }

  if (!updates.length) return res.status(400).json({ ok: false, erro: 'Nenhum campo para atualizar.' });

  params.push(req.params.id);
  await db.execute(
    `UPDATE produtos SET ${updates.join(', ')} WHERE id = $${params.length}`,
    params
  );

  // Se atualizou critérios de elegibilidade, re-varrer clientes
  if (req.body.cargos_elegiveis !== undefined || req.body.orgaos_elegiveis !== undefined) {
    verificarElegibilidadeProduto(req.params.id, req.user.id)
      .then(({ vinculados, tarefas }) => {
        if (tarefas > 0) console.log(`[Elegibilidade] Produto ${req.params.id} atualizado: ${vinculados} novos vínculos, ${tarefas} tarefas criadas.`);
      })
      .catch(err => console.warn('[Elegibilidade] Erro no PATCH produto:', err.message));
  }

  res.json({ ok: true });
});

// DELETE /api/produtos/:id — desativa (soft delete)
produtosRouter.delete('/:id', apenasMaster, async (req, res) => {
  await db.execute(`UPDATE produtos SET ativo = false WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

// POST /api/produtos/clientes/:clienteId — vincular produto ao cliente
produtosRouter.post('/clientes/:clienteId', apenasMaster, async (req, res) => {
  const { produto_id, honorarios_pct } = req.body;
  if (!produto_id || honorarios_pct === undefined) {
    return res.status(400).json({ ok: false, erro: 'produto_id e honorarios_pct são obrigatórios.' });
  }

  try {
    const [novo] = await db.query(
      `INSERT INTO cliente_produtos (cliente_id, produto_id, honorarios_pct)
       VALUES ($1,$2,$3)
       RETURNING *`,
      [req.params.clienteId, produto_id, Number(honorarios_pct)]
    );
    res.status(201).json({ ok: true, vinculo: novo });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ ok: false, erro: 'Produto já vinculado a este cliente.' });
    throw e;
  }
});

// DELETE /api/produtos/clientes/:clienteId/:cpId — remover vínculo
produtosRouter.delete('/clientes/:clienteId/:cpId', apenasMaster, async (req, res) => {
  // Impede remoção se houver tarefa de protocolo ativa para esse vínculo
  const tarefaAtiva = await db.queryOne(
    `SELECT id FROM tarefas WHERE cliente_produto_id = $1 AND status NOT IN ('concluida','cancelada')`,
    [req.params.cpId]
  );
  if (tarefaAtiva) {
    return res.status(409).json({ ok: false, erro: 'Existe tarefa de protocolo ativa para esta tese. Conclua ou cancele antes de remover.' });
  }

  await db.execute(`DELETE FROM cliente_produtos WHERE id = $1`, [req.params.cpId]);
  res.json({ ok: true });
});
