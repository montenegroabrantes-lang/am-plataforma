import { Router } from 'express';
import { db }      from '../db/index.js';

export const dashboardRouter = Router();

// GET /api/dashboard — métricas da tela inicial
dashboardRouter.get('/', async (req, res) => {
  const { id, perfil, master_id, pode_marcar_restrito } = req.user;
  const masterId = pode_marcar_restrito ? null : (perfil === 'master' ? id : master_id);

  const params   = masterId ? [masterId] : [];
  const filtroP  = masterId ? 'AND p.master_responsavel_id = $1' : '';
  const filtroT  = masterId ? 'AND t.validado_por = $1'          : '';
  const filtroM  = masterId ? 'AND p.master_responsavel_id = $1' : '';

  const [
    totaisProcessos,
    urgencias,
    movsHoje,
    tarefasPendentes,
    audiencias7d,
    syncStatus,
    syncCobertura,
    syncExecucoes,
    syncMovsNovas,
    syncErros,
  ] = await Promise.all([

    db.query(`
      SELECT status, COUNT(*) AS total
      FROM processos p WHERE 1=1 ${filtroP}
      GROUP BY status`, params),

    db.query(`
      SELECT m.diagnostico_urgencia AS urgencia, COUNT(*) AS total
      FROM movimentacoes m
      JOIN processos p ON p.id = m.processo_id
      WHERE m.diagnostico_urgencia IS NOT NULL ${filtroM}
      AND m.criado_em >= NOW() - INTERVAL '7 days'
      GROUP BY m.diagnostico_urgencia
      ORDER BY CASE m.diagnostico_urgencia
        WHEN 'CRITICO' THEN 1 WHEN 'ALTO' THEN 2 WHEN 'MEDIO' THEN 3 ELSE 4 END`, params),

    db.query(`
      SELECT COUNT(*) AS total,
             COUNT(*) FILTER (WHERE m.diagnostico_urgencia IN ('CRITICO','ALTO')) AS urgentes
      FROM movimentacoes m
      JOIN processos p ON p.id = m.processo_id
      WHERE m.criado_em >= NOW() - INTERVAL '24 hours' ${filtroM}`, params),

    db.query(`
      SELECT t.urgencia, COUNT(*) AS total
      FROM tarefas t
      WHERE t.status NOT IN ('concluida','nao_verificada') ${filtroT}
      GROUP BY t.urgencia
      ORDER BY CASE t.urgencia
        WHEN 'CRITICO' THEN 1 WHEN 'ALTO' THEN 2 WHEN 'MEDIO' THEN 3 ELSE 4 END`, params),

    db.query(`
      SELECT a.data_hora, a.tipo, p.numero, p.tribunal, c.nome AS cliente_nome
      FROM audiencias a
      JOIN processos p ON p.id = a.processo_id
      LEFT JOIN clientes c ON c.id = p.cliente_id
      WHERE a.data_hora BETWEEN NOW() AND NOW() + INTERVAL '7 days'
      ${filtroP}
      ORDER BY a.data_hora ASC
      LIMIT 5`, params),

    db.query(`
      SELECT sync_status, COUNT(*) AS total
      FROM processos p WHERE 1=1 ${filtroP}
      GROUP BY sync_status`, params),

    db.queryOne(`
      SELECT
        MAX(atualizado_em)                                              AS ultima_atualizacao,
        COUNT(*) FILTER (WHERE sync_fonte = 'datajud')                 AS via_datajud,
        COUNT(*) FILTER (WHERE sync_fonte = 'mni')                     AS via_mni,
        COUNT(*) FILTER (WHERE sync_fonte = 'puppeteer')               AS via_puppeteer,
        COUNT(*) FILTER (WHERE sync_fonte = 'eproc')                   AS via_eproc,
        COUNT(*) FILTER (WHERE sync_fonte IS NULL)                     AS sem_fonte,
        COUNT(*) FILTER (WHERE sync_falhas > 0)                        AS com_falhas,
        COUNT(*) FILTER (WHERE sync_status = 'erro_sync')              AS com_erro,
        COUNT(*) FILTER (WHERE polo_ativo  IS NOT NULL AND polo_ativo  <> '') AS com_polo_ativo,
        COUNT(*) FILTER (WHERE polo_passivo IS NOT NULL AND polo_passivo <> '') AS com_polo_passivo,
        COUNT(*)                                                        AS total_monitorados
      FROM processos p WHERE status IN ('ativo','suspenso') ${filtroP}`, params),

    // sync_execucoes não tem filtro por master — sempre retorna tudo
    db.query(`SELECT * FROM sync_execucoes ORDER BY iniciado_em DESC LIMIT 5`),

    db.queryOne(`
      SELECT
        COUNT(*) FILTER (WHERE m.criado_em >= NOW() - INTERVAL '24 hours') AS total_24h,
        COUNT(*) FILTER (WHERE m.criado_em >= NOW() - INTERVAL '7 days')   AS total_7d
      FROM movimentacoes m
      JOIN processos p ON p.id = m.processo_id
      WHERE 1=1 ${filtroM}`, params),

    db.query(`
      SELECT p.id, p.numero, p.tribunal, p.sync_falhas, p.atualizado_em
      FROM processos p
      WHERE p.sync_status = 'erro_sync' ${filtroP}
      ORDER BY p.sync_falhas DESC, p.atualizado_em ASC
      LIMIT 10`, params),
  ]);

  // Métricas processuais operacionais
  const [situacaoCounts, localizacaoCounts, urgentesLista, requisicaoCounts] = await Promise.all([

    db.query(`
      SELECT situacao_atual, COUNT(*) AS total
      FROM processos p
      WHERE status = 'ativo' AND situacao_atual IS NOT NULL ${filtroP}
      GROUP BY situacao_atual ORDER BY total DESC`, params),

    db.query(`
      SELECT localizacao_processual, COUNT(*) AS total
      FROM processos p
      WHERE status = 'ativo' AND localizacao_processual IS NOT NULL ${filtroP}
      GROUP BY localizacao_processual ORDER BY total DESC`, params),

    db.query(`
      SELECT p.id, p.numero, p.situacao_atual, p.etapa_atual, c.nome AS cliente_nome
      FROM processos p
      LEFT JOIN clientes c ON c.id = p.cliente_id
      WHERE p.urgente = true AND p.status = 'ativo' ${filtroP}
      ORDER BY p.classificado_em DESC LIMIT 20`, params),

    db.queryOne(`
      SELECT
        COUNT(*) FILTER (WHERE status_rpv NOT IN ('nao_iniciado','paga') AND status_rpv IS NOT NULL) AS rpv_andamento,
        COUNT(*) FILTER (WHERE status_rpv = 'expedida')                                              AS rpv_expedida,
        COUNT(*) FILTER (WHERE status_rpv = 'paga')                                                  AS rpv_paga,
        COUNT(*) FILTER (WHERE status_precatorio NOT IN ('nao_iniciado','pagamento_disponibilizado') AND status_precatorio IS NOT NULL) AS prec_andamento,
        COUNT(*) FILTER (WHERE status_precatorio = 'pagamento_disponibilizado')                      AS prec_pago,
        COUNT(*) FILTER (WHERE status_alvara NOT IN ('nao_iniciado','pagamento_realizado') AND status_alvara IS NOT NULL) AS alv_andamento,
        COUNT(*) FILTER (WHERE status_alvara = 'pagamento_realizado')                                AS alv_pago,
        COUNT(*) FILTER (WHERE tipo_requisicao = 'rpv')                                              AS total_rpv,
        COUNT(*) FILTER (WHERE tipo_requisicao = 'precatorio')                                       AS total_precatorio,
        COUNT(*) FILTER (WHERE tipo_requisicao = 'alvara')                                           AS total_alvara
      FROM processos p WHERE status = 'ativo' ${filtroP}`, params),
  ]);

  // Carteira financeira total
  const carteira = await db.queryOne(`
    SELECT
      COALESCE(SUM(valor_homologado), 0)                                                   AS total_homologado,
      COALESCE(SUM(valor_homologado) FILTER (WHERE tipo_requisicao = 'rpv'), 0)            AS rpv_homologado,
      COALESCE(SUM(valor_homologado) FILTER (WHERE tipo_requisicao = 'precatorio'), 0)     AS prec_homologado,
      COALESCE(SUM(valor_homologado) FILTER (WHERE tipo_requisicao = 'alvara'), 0)         AS alv_homologado,
      COALESCE(SUM(valor_causa), 0)                                                        AS total_causa,
      COUNT(*) FILTER (WHERE valor_homologado > 0)                                         AS processos_com_valor
    FROM processos p WHERE status = 'ativo' ${filtroP}`, params);

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
    LIMIT 8`, params);

  const idx = (rows, chave, valor) => {
    const obj = {};
    for (const r of rows) obj[r[chave]] = Number(r[valor]);
    return obj;
  };

  const ultimaExecucao = syncExecucoes[0] || null;

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
      por_status:       idx(syncStatus, 'sync_status', 'total'),
      cobertura:        syncCobertura || {},
      ultima_execucao:  ultimaExecucao,
      execucoes_7d:     syncExecucoes,
      movs_novas:       syncMovsNovas || { total_24h: 0, total_7d: 0 },
      processos_erro:   syncErros,
    },
    alertas: movsAlerta,
    situacoes:   situacaoCounts,
    localizacoes: localizacaoCounts,
    urgentes:    urgentesLista,
    requisicoes: requisicaoCounts || {},
    carteira:    carteira || {},
  });
});
