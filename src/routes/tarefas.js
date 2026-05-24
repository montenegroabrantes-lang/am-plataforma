import { Router } from 'express';
import { db }      from '../db/index.js';
import { apenasMaster } from '../middleware/auth.js';

export const tarefasRouter = Router();

// GET /api/tarefas — lista tarefas do usuário (ou todas para Master)
tarefasRouter.get('/', async (req, res) => {
  const { status, urgencia, page = 1, limite = 50 } = req.query;
  const { id, perfil, master_id } = req.user;
  const offset = (Number(page) - 1) * Number(limite);

  const params = [];
  const condicoes = ['1=1'];

  // Junior vê só as suas; Master vê as suas e as dos juniors vinculados
  if (perfil === 'junior') {
    params.push(id);
    condicoes.push(`t.atribuido_a = $${params.length}`);
  } else {
    // Master vê as tarefas dos seus juniors + as sem atribuição do seu pool
    params.push(id);
    condicoes.push(`(t.validado_por = $${params.length} OR t.atribuido_a IN (
      SELECT id FROM usuarios WHERE master_id = $${params.length}
    ) OR t.atribuido_a = $${params.length})`);
  }

  if (status)   { params.push(status);   condicoes.push(`t.status = $${params.length}`); }
  if (urgencia) { params.push(urgencia); condicoes.push(`t.urgencia = $${params.length}`); }

  params.push(Number(limite), offset);

  const rows = await db.query(
    `SELECT t.*, p.numero AS processo_numero, p.tribunal,
            u.nome AS atribuido_nome, m.nome AS validador_nome
     FROM tarefas t
     LEFT JOIN processos p ON p.id = t.processo_id
     LEFT JOIN usuarios u  ON u.id = t.atribuido_a
     LEFT JOIN usuarios m  ON m.id = t.validado_por
     WHERE ${condicoes.join(' AND ')}
     ORDER BY
       CASE t.urgencia WHEN 'CRITICO' THEN 1 WHEN 'ALTO' THEN 2 WHEN 'MEDIO' THEN 3 ELSE 4 END,
       t.prazo_data ASC NULLS LAST
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({ ok: true, tarefas: rows });
});

// POST /api/tarefas — cria tarefa (Master atribui ao Junior)
tarefasRouter.post('/', apenasMaster, async (req, res) => {
  const { processo_id, tipo, descricao, instrucao, atribuido_a, urgencia, prazo_data } = req.body;

  if (!tipo || !descricao) {
    return res.status(400).json({ ok: false, erro: 'tipo e descricao são obrigatórios.' });
  }

  const [nova] = await db.query(
    `INSERT INTO tarefas (processo_id, tipo, descricao, instrucao, atribuido_a, validado_por, urgencia, prazo_data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      processo_id || null, tipo, descricao, instrucao || null,
      atribuido_a || null, req.user.id,
      urgencia || 'MEDIO', prazo_data || null,
    ]
  );

  res.status(201).json({ ok: true, tarefa: nova });
});

// PATCH /api/tarefas/:id/status — atualiza status da tarefa
tarefasRouter.patch('/:id/status', async (req, res) => {
  const { status, observacao_devolucao } = req.body;
  const validos = ['pendente','em_execucao','aguardando_validacao','concluida','devolvida'];

  if (!validos.includes(status)) {
    return res.status(400).json({ ok: false, erro: `Status inválido. Válidos: ${validos.join(', ')}` });
  }

  const tarefa = await db.queryOne('SELECT * FROM tarefas WHERE id = $1', [req.params.id]);
  if (!tarefa) return res.status(404).json({ ok: false, erro: 'Tarefa não encontrada.' });

  // Junior só pode mover para em_execucao ou aguardando_validacao
  if (req.user.perfil === 'junior' && ['concluida','devolvida'].includes(status)) {
    return res.status(403).json({ ok: false, erro: 'Apenas o Master pode concluir ou devolver tarefas.' });
  }

  const concluida_em = status === 'concluida' ? new Date() : null;

  await db.execute(
    `UPDATE tarefas SET status = $1, observacao_devolucao = $2, concluida_em = $3 WHERE id = $4`,
    [status, observacao_devolucao || null, concluida_em, req.params.id]
  );

  res.json({ ok: true });
});
