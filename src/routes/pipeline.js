import { Router } from 'express';
import { db }      from '../db/index.js';
import { apenasMaster } from '../middleware/auth.js';

export const pipelineRouter = Router();

const ETAPAS_ORDEM = ['contato_feito','docs_solicitados','docs_recebidos','cadastro_pendente','convertido','perdido'];

// GET /api/pipeline — kanban completo (agrupado por etapa)
pipelineRouter.get('/', async (req, res) => {
  const params = [];
  const condicoes = ["l.etapa NOT IN ('convertido','perdido')"];

  const rows = await db.query(
    `SELECT l.*, pr.nome AS produto_nome, u.nome AS atribuido_nome
     FROM leads l
     LEFT JOIN produtos  pr ON pr.id = l.produto_id
     LEFT JOIN usuarios  u  ON u.id = l.atribuido_a
     WHERE ${condicoes.join(' AND ')}
     ORDER BY l.atualizado_em DESC`,
    params
  );

  // Agrupa por etapa para o kanban
  const kanban = {};
  for (const etapa of ETAPAS_ORDEM) kanban[etapa] = [];
  for (const lead of rows) kanban[lead.etapa]?.push(lead);

  res.json({ ok: true, kanban, total: rows.length });
});

// GET /api/pipeline/todos — inclui convertidos e perdidos (para relatório)
pipelineRouter.get('/todos', async (req, res) => {
  const { etapa, page = 1, limite = 50 } = req.query;
  const offset = (Number(page) - 1) * Number(limite);

  const params = [];
  const condicoes = ['1=1'];

  if (etapa) { params.push(etapa); condicoes.push(`l.etapa = $${params.length}`); }

  params.push(Number(limite), offset);

  const rows = await db.query(
    `SELECT l.*, pr.nome AS produto_nome, u.nome AS atribuido_nome
     FROM leads l
     LEFT JOIN produtos pr ON pr.id = l.produto_id
     LEFT JOIN usuarios u  ON u.id = l.atribuido_a
     WHERE ${condicoes.join(' AND ')}
     ORDER BY l.atualizado_em DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({ ok: true, leads: rows });
});

// POST /api/pipeline — cria lead
pipelineRouter.post('/', async (req, res) => {
  const { nome, whatsapp, cpf, produto_id, etapa, observacao, atribuido_a } = req.body;
  const masterId = req.user.perfil === 'master' ? req.user.id : req.user.master_id;

  const [novo] = await db.query(
    `INSERT INTO leads (nome, whatsapp, cpf, produto_id, etapa, observacao,
            master_responsavel_id, atribuido_a, origem)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'manual')
     RETURNING *`,
    [
      nome || null, whatsapp || null, cpf?.replace(/\D/g,'') || null,
      produto_id || null, etapa || 'contato_feito', observacao || null,
      masterId, atribuido_a || null,
    ]
  );

  res.status(201).json({ ok: true, lead: novo });
});

// PATCH /api/pipeline/:id/etapa — move o card no kanban
pipelineRouter.patch('/:id/etapa', async (req, res) => {
  const { etapa, observacao } = req.body;

  if (!ETAPAS_ORDEM.includes(etapa)) {
    return res.status(400).json({ ok: false, erro: `Etapa inválida. Válidas: ${ETAPAS_ORDEM.join(', ')}` });
  }

  const updates = ['etapa = $1', 'atualizado_em = NOW()'];
  const params  = [etapa];

  if (observacao !== undefined) { params.push(observacao); updates.push(`observacao = $${params.length}`); }

  params.push(req.params.id);
  await db.execute(`UPDATE leads SET ${updates.join(', ')} WHERE id = $${params.length}`, params);

  res.json({ ok: true });
});

// PATCH /api/pipeline/:id — atualiza dados do lead
pipelineRouter.patch('/:id', async (req, res) => {
  const campos = ['nome','whatsapp','cpf','produto_id','observacao','atribuido_a','cliente_id'];
  const updates = ['atualizado_em = NOW()'];
  const params  = [];

  for (const campo of campos) {
    if (req.body[campo] !== undefined) {
      params.push(req.body[campo]);
      updates.push(`${campo} = $${params.length}`);
    }
  }

  params.push(req.params.id);
  await db.execute(`UPDATE leads SET ${updates.join(', ')} WHERE id = $${params.length}`, params);
  res.json({ ok: true });
});
