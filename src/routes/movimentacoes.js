import { Router } from 'express';
import { db }      from '../db/index.js';
import { ai }      from '../services/ai/index.js';

export const movimentacoesRouter = Router();

// GET /api/movimentacoes/:processoId — lista movimentações de um processo
movimentacoesRouter.get('/:processoId', async (req, res) => {
  const { processoId } = req.params;
  const { page = 1, limite = 50 } = req.query;
  const offset = (Number(page) - 1) * Number(limite);

  const rows = await db.query(
    `SELECT m.*, p.numero AS processo_numero, p.tribunal
     FROM movimentacoes m
     JOIN processos p ON p.id = m.processo_id
     WHERE m.processo_id = $1
     ORDER BY m.data_movimentacao DESC
     LIMIT $2 OFFSET $3`,
    [processoId, Number(limite), offset]
  );

  res.json({ ok: true, movimentacoes: rows });
});

// POST /api/movimentacoes/:id/diagnosticar — dispara diagnóstico IA para uma movimentação
movimentacoesRouter.post('/:id/diagnosticar', async (req, res) => {
  const mov = await db.queryOne(
    `SELECT m.*, p.numero, p.tribunal, pr.nome AS produto
     FROM movimentacoes m
     JOIN processos p  ON p.id = m.processo_id
     LEFT JOIN produtos pr ON pr.id = p.produto_id
     WHERE m.id = $1`,
    [req.params.id]
  );

  if (!mov) return res.status(404).json({ ok: false, erro: 'Movimentação não encontrada.' });
  if (mov.diagnostico_em) return res.json({ ok: true, ja_diagnosticada: true, diagnostico: {
    significado:   mov.diagnostico_significado,
    proximaAcao:   mov.diagnostico_proxima_acao,
    urgencia:      mov.diagnostico_urgencia,
    prazoDiasUteis: mov.diagnostico_prazo_dias,
  }});

  const historico = await db.query(
    `SELECT texto FROM movimentacoes WHERE processo_id = $1 ORDER BY data_movimentacao DESC LIMIT 5`,
    [mov.processo_id]
  );

  const resultado = await ai.diagnosticar({
    numero:    mov.numero,
    tribunal:  mov.tribunal,
    produto:   mov.produto,
    data:      mov.data_movimentacao,
    texto:     mov.texto,
    historico: historico.map(h => h.texto).join('\n---\n'),
  });

  await db.execute(
    `UPDATE movimentacoes SET
       diagnostico_significado  = $1,
       diagnostico_proxima_acao = $2,
       diagnostico_urgencia     = $3,
       diagnostico_prazo_dias   = $4,
       diagnostico_em           = NOW()
     WHERE id = $5`,
    [resultado.significado, resultado.proximaAcao, resultado.urgencia, resultado.prazoDiasUteis ?? null, mov.id]
  );

  res.json({ ok: true, diagnostico: resultado });
});
