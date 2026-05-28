import { Router } from 'express';
import { db }      from '../db/index.js';
import { ai }      from '../services/ai/index.js';

export const movimentacoesRouter = Router();

function calcularPrioridade(diag) {
  const prazoFinal  = diag.pendencia?.prazoFinal;
  const statusPrazo = diag.pendencia?.statusPrazo;
  const tipo        = diag.pendencia?.tipo;

  if (statusPrazo === 'VENCIDO') return 'CRITICO';

  if (prazoFinal) {
    const agora  = Date.now();
    const prazo  = new Date(prazoFinal).getTime();
    const diffH  = (prazo - agora) / 3_600_000;
    if (diffH < 0)    return 'CRITICO';
    if (diffH <= 48)  return 'CRITICO';
    if (diffH <= 120) return 'ALTO';
  }

  const URGENTES = new Set(['PETICIONAR', 'CONFERIR_EXPEDIENTE', 'CUMPRIR_DETERMINACAO', 'PROVIDENCIAR_CITACAO']);
  if (URGENTES.has(tipo)) return diag.prioridade === 'CRITICO' ? 'CRITICO' : 'ALTO';

  return diag.prioridade || 'MEDIO';
}

// GET /api/movimentacoes/:processoId
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

// POST /api/movimentacoes/:id/diagnosticar
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

  // Retorna diagnóstico já existente sem recalcular
  if (mov.diagnostico_em) {
    return res.json({ ok: true, ja_diagnosticada: true, diagnostico: {
      ultimaMovimentacao: { data: mov.data_movimentacao, descricao: mov.diagnostico_significado },
      pendencia: {
        tipo:                 mov.pendencia_tipo,
        resumo:               mov.pendencia_resumo,
        prazoFinal:           mov.pendencia_prazo_final,
        statusPrazo:          mov.pendencia_status_prazo,
        precisaConferenciaPJe: mov.pendencia_conferencia_pje,
      },
      prioridade: mov.diagnostico_urgencia,
    }});
  }

  const historico = await db.query(
    `SELECT texto FROM movimentacoes WHERE processo_id = $1 ORDER BY data_movimentacao DESC LIMIT 5`,
    [mov.processo_id]
  );

  const diag = await ai.diagnosticar({
    numero:    mov.numero,
    tribunal:  mov.tribunal,
    produto:   mov.produto,
    data:      mov.data_movimentacao,
    texto:     mov.texto,
    historico: historico.map(h => h.texto).join('\n---\n'),
  });

  const prioridadeFinal = calcularPrioridade(diag);

  await db.execute(
    `UPDATE movimentacoes SET
       diagnostico_significado   = $1,
       diagnostico_proxima_acao  = $2,
       diagnostico_urgencia      = $3,
       diagnostico_prazo_dias    = NULL,
       pendencia_tipo            = $4,
       pendencia_resumo          = $5,
       pendencia_prazo_final     = $6,
       pendencia_status_prazo    = $7,
       pendencia_conferencia_pje = $8,
       diagnostico_em            = NOW()
     WHERE id = $9`,
    [
      diag.ultimaMovimentacao?.descricao,
      diag.pendencia?.resumo,
      prioridadeFinal,
      diag.pendencia?.tipo,
      diag.pendencia?.resumo,
      diag.pendencia?.prazoFinal  || null,
      diag.pendencia?.statusPrazo || null,
      diag.pendencia?.precisaConferenciaPJe ?? false,
      mov.id,
    ]
  );

  res.json({ ok: true, diagnostico: { ...diag, prioridade: prioridadeFinal } });
});
