import { Router } from 'express';
import { db }      from '../db/index.js';
import { apenasMaster } from '../middleware/auth.js';
import { registrarAuditoria } from '../middleware/auditoria.js';

export const financeiroRouter = Router();

// GET /api/financeiro — lista honorários
financeiroRouter.get('/', async (req, res) => {
  const { status, page = 1, limite = 30 } = req.query;
  const offset = (Number(page) - 1) * Number(limite);

  const params = [];
  const condicoes = ['1=1'];
  if (status) {
    params.push(status);
    condicoes.push(`h.status = $${params.length}`);
  }

  params.push(Number(limite), offset);

  const rows = await db.query(
    `SELECT h.*, p.numero AS processo_numero, p.tribunal,
            c.nome AS cliente_nome, u.nome AS master_nome
     FROM honorarios h
     JOIN processos p  ON p.id = h.processo_id
     LEFT JOIN clientes c ON c.id = p.cliente_id
     LEFT JOIN usuarios u ON u.id = h.master_responsavel_id
     WHERE ${condicoes.join(' AND ')}
     ORDER BY h.criado_em DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  // Totais
  const totais = await db.queryOne(
    `SELECT
       COALESCE(SUM(valor_honorario) FILTER (WHERE status = 'a_receber'), 0) AS a_receber,
       COALESCE(SUM(valor_recebido),  0)                                     AS recebido,
       COALESCE(SUM(valor_honorario), 0)                                     AS total
     FROM honorarios h
     WHERE ${condicoes.slice(0, -2).join(' AND ') || '1=1'}`,
    params.slice(0, -2)
  );

  res.json({ ok: true, honorarios: rows, totais });
});

// POST /api/financeiro — registra honorário
financeiroRouter.post('/', apenasMaster, async (req, res) => {
  const { processo_id, tipo, valor_bruto, percentual } = req.body;

  if (!processo_id || !valor_bruto || !percentual) {
    return res.status(400).json({ ok: false, erro: 'processo_id, valor_bruto e percentual são obrigatórios.' });
  }

  const valor_honorario = (Number(valor_bruto) * Number(percentual)) / 100;
  const masterId = req.user.id;

  const [novo] = await db.query(
    `INSERT INTO honorarios (processo_id, master_responsavel_id, tipo, valor_bruto, percentual, valor_honorario, registrado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [processo_id, masterId, tipo || null, valor_bruto, percentual, valor_honorario, req.user.id]
  );

  await registrarAuditoria({
    usuarioId: req.user.id, acao: 'criar', entidade: 'honorario',
    entidadeId: novo.id, valorDepois: novo, ip: req._ip,
  });

  res.status(201).json({ ok: true, honorario: novo });
});

// PATCH /api/financeiro/:id — atualiza status (recebimento)
financeiroRouter.patch('/:id', apenasMaster, async (req, res) => {
  const { status, valor_recebido, data_recebimento } = req.body;

  const antes = await db.queryOne('SELECT * FROM honorarios WHERE id = $1', [req.params.id]);
  if (!antes) return res.status(404).json({ ok: false, erro: 'Honorário não encontrado.' });

  await db.execute(
    `UPDATE honorarios SET
       status = COALESCE($1, status),
       valor_recebido = COALESCE($2, valor_recebido),
       data_recebimento = COALESCE($3, data_recebimento)
     WHERE id = $4`,
    [status || null, valor_recebido || null, data_recebimento || null, req.params.id]
  );

  await registrarAuditoria({
    usuarioId: req.user.id, acao: 'editar', entidade: 'honorario',
    entidadeId: req.params.id, valorAntes: antes,
    valorDepois: { status, valor_recebido, data_recebimento }, ip: req._ip,
  });

  res.json({ ok: true });
});
