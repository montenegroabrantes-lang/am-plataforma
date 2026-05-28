import { Router } from 'express';
import { db }      from '../db/index.js';

export const dashboardRouter = Router();

// GET /api/dashboard — métricas da tela inicial
dashboardRouter.get('/', async (req, res) => {
  const { id, perfil, master_id, pode_marcar_restrito } = req.user;
  const masterId = pode_marcar_restrito ? null : (perfil === 'master' ? id : master_id);

  const filtroP  = masterId ? `AND p.master_responsavel_id = '${masterId}'` : '';
  const filtroT  = masterId ? `AND t.validado_por = '${masterId}'` : '';
  const filtroM  = masterId ? `AND p.master_responsavel_id = '${masterId}'` : '';

  const [
    totaisProcessos,
    urgencias,
    movsHoje,
    tarefasPendentes,
    audiencias7d,
    syncStatus,
    ultimoSync,
  ] = await Promise.all([

    // Total de processos por status
    db.query(`
      SELECT status, COUNT(*) AS total
      FROM processos p WHERE 1=1 ${filtroP}
      GROUP BY status`),

    // Movimentações por urgência (não resolvidas — sem prazo cumprido)
    db.query(`
      SELECT m.diagnostico_urgencia AS urgencia, COUNT(*) AS total
      FROM movimentacoes m
      JOIN processos p ON p.id = m.processo_id
      WHERE m.diagnostico_urgencia IS NOT NULL ${filtroM}
      AND m.criado_em >= NOW() - INTERVAL '7 days'
      GROUP BY m.diagnostico_urgencia
      ORDER BY CASE m.diagnostico_urgencia
        WHEN 'CRITICO' THEN 1 WHEN 'ALTO' THEN 2 WHEN 'MEDIO' THEN 3 ELSE 4 END`),

    // Movimentações novas nas últimas 24h
    db.query(`
      SELECT COUNT(*) AS total,
             COUNT(*) FILTER (WHERE m.diagnostico_urgencia IN ('CRITICO','ALTO')) AS urgentes
      FROM movimentacoes m
      JOIN processos p ON p.id = m.processo_id
      WHERE m.criado_em >= NOW() - INTERVAL '24 hours' ${filtroM}`),

    // Tarefas pendentes por urgência
    db.query(`
      SELECT t.urgencia, COUNT(*) AS total
      FROM tarefas t
      WHERE t.status NOT IN ('concluida','cancelada') ${filtroT}
      GROUP BY t.urgencia
      ORDER BY CASE t.urgencia
        WHEN 'CRITICO' THEN 1 WHEN 'ALTO' THEN 2 WHEN 'MEDIO' THEN 3 ELSE 4 END`),

    // Próximas audiências — 7 dias
    db.query(`
      SELECT a.data_hora, a.tipo, p.numero, p.tribunal, c.nome AS cliente_nome
      FROM audiencias a
      JOIN processos p ON p.id = a.processo_id
      LEFT JOIN clientes c ON c.id = p.cliente_id
      WHERE a.data_hora BETWEEN NOW() AND NOW() + INTERVAL '7 days'
      ${filtroP.replace('p.master_responsavel_id', 'p.master_responsavel_id')}
      ORDER BY a.data_hora ASC
      LIMIT 5`),

    // Processos por sync_status
    db.query(`
      SELECT sync_status, COUNT(*) AS total
      FROM processos p WHERE 1=1 ${filtroP}
      GROUP BY sync_status`),

    // Último sync bem-sucedido
    db.query(`
      SELECT MAX(m.criado_em) AS ultimo_sync
      FROM movimentacoes m
      JOIN processos p ON p.id = m.processo_id
      WHERE 1=1 ${filtroM}`),
  ]);

  // Movimentações críticas recentes (últimas 48h, urgência CRITICO ou ALTO)
  const movsAlerta = await db.query(`
    SELECT m.texto, m.diagnostico_urgencia, m.diagnostico_proxima_acao,
           m.criado_em, p.numero, p.id AS processo_id, c.nome AS cliente_nome
    FROM movimentacoes m
    JOIN processos p ON p.id = m.processo_id
    LEFT JOIN clientes c ON c.id = p.cliente_id
    WHERE m.diagnostico_urgencia IN ('CRITICO','ALTO')
    AND m.criado_em >= NOW() - INTERVAL '48 hours'
    ${filtroM}
    ORDER BY CASE m.diagnostico_urgencia WHEN 'CRITICO' THEN 1 ELSE 2 END,
             m.criado_em DESC
    LIMIT 8`);

  const idx = (rows, chave, valor) => {
    const obj = {};
    for (const r of rows) obj[r[chave]] = Number(r[valor]);
    return obj;
  };

  res.json({
    ok: true,
    processos: {
      totais: idx(totaisProcessos, 'status', 'total'),
      total_ativos: totaisProcessos.find(r => r.status === 'ativo')?.total || 0,
    },
    urgencias: idx(urgencias, 'urgencia', 'total'),
    movs_hoje: movsHoje[0] || { total: 0, urgentes: 0 },
    tarefas_pendentes: idx(tarefasPendentes, 'urgencia', 'total'),
    audiencias_7d: audiencias7d,
    sync: {
      por_status: idx(syncStatus, 'sync_status', 'total'),
      ultimo_sync: ultimoSync[0]?.ultimo_sync || null,
    },
    alertas: movsAlerta,
  });
});
