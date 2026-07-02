import { Router } from 'express';
import { db }      from '../db/index.js';

export const dashboardRouter = Router();

// GET /api/dashboard — métricas da tela inicial
dashboardRouter.get('/', async (req, res) => {
  const filtroM = '';
  const filtroP = '';
  const filtroT = '';

  // 1 scan de processos substitui 6 queries separadas
  const [
    agregadosProcessos,
    situacaoCounts,
    localizacaoCounts,
    urgentesLista,
    syncErros,
    movsHoje,
    urgencias,
    tarefasPendentes,
    audiencias7d,
    syncExecucoes,
    syncMovsNovas,
    movsAlerta,
  ] = await Promise.all([

    // Todos os aggregates de processos em 1 única query
    db.queryOne(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'ativo')     AS total_ativo,
        COUNT(*) FILTER (WHERE status = 'encerrado')  AS total_inativo,
        COUNT(*) FILTER (WHERE status = 'suspenso')  AS total_suspenso,
        COUNT(*) FILTER (WHERE status = 'arquivado') AS total_arquivado,
        COUNT(*) FILTER (WHERE sync_status = 'ok')        AS sync_ok,
        COUNT(*) FILTER (WHERE sync_status = 'erro_sync') AS sync_erro,
        COUNT(*) FILTER (WHERE sync_status = 'pendente')  AS sync_pendente,
        MAX(atualizado_em)   FILTER (WHERE status IN ('ativo','suspenso'))                                    AS ultima_atualizacao,
        COUNT(*) FILTER (WHERE status IN ('ativo','suspenso') AND sync_fonte = 'datajud')                    AS via_datajud,
        COUNT(*) FILTER (WHERE status IN ('ativo','suspenso') AND sync_fonte IS NULL)                        AS sem_fonte,
        COUNT(*) FILTER (WHERE status IN ('ativo','suspenso') AND sync_falhas > 0)                           AS com_falhas,
        COUNT(*) FILTER (WHERE status IN ('ativo','suspenso') AND sync_status = 'erro_sync')                 AS com_erro,
        COUNT(*) FILTER (WHERE status IN ('ativo','suspenso') AND polo_ativo  IS NOT NULL AND polo_ativo  <> '') AS com_polo_ativo,
        COUNT(*) FILTER (WHERE status IN ('ativo','suspenso') AND polo_passivo IS NOT NULL AND polo_passivo <> '') AS com_polo_passivo,
        COUNT(*) FILTER (WHERE status IN ('ativo','suspenso'))                                               AS total_monitorados,
        COUNT(*) FILTER (WHERE status = 'ativo' AND status_rpv NOT IN ('nao_iniciado','paga') AND status_rpv IS NOT NULL)  AS rpv_andamento,
        COUNT(*) FILTER (WHERE status = 'ativo' AND status_rpv = 'expedida')                                 AS rpv_expedida,
        COUNT(*) FILTER (WHERE status = 'ativo' AND status_rpv = 'paga')                                     AS rpv_paga,
        COUNT(*) FILTER (WHERE status = 'ativo' AND status_precatorio NOT IN ('nao_iniciado','pagamento_disponibilizado') AND status_precatorio IS NOT NULL) AS prec_andamento,
        COUNT(*) FILTER (WHERE status = 'ativo' AND status_precatorio = 'pagamento_disponibilizado')         AS prec_pago,
        COUNT(*) FILTER (WHERE status = 'ativo' AND status_alvara NOT IN ('nao_iniciado','pagamento_realizado') AND status_alvara IS NOT NULL) AS alv_andamento,
        COUNT(*) FILTER (WHERE status = 'ativo' AND status_alvara = 'pagamento_realizado')                   AS alv_pago,
        COUNT(*) FILTER (WHERE status = 'ativo' AND tipo_requisicao = 'rpv')        AS total_rpv,
        COUNT(*) FILTER (WHERE status = 'ativo' AND tipo_requisicao = 'precatorio') AS total_precatorio,
        COUNT(*) FILTER (WHERE status = 'ativo' AND tipo_requisicao = 'alvara')     AS total_alvara,
        COALESCE(SUM(valor_homologado) FILTER (WHERE status = 'ativo'), 0)                                   AS total_homologado,
        COALESCE(SUM(valor_homologado) FILTER (WHERE status = 'ativo' AND tipo_requisicao = 'rpv'), 0)       AS rpv_homologado,
        COALESCE(SUM(valor_homologado) FILTER (WHERE status = 'ativo' AND tipo_requisicao = 'precatorio'), 0) AS prec_homologado,
        COALESCE(SUM(valor_homologado) FILTER (WHERE status = 'ativo' AND tipo_requisicao = 'alvara'), 0)    AS alv_homologado,
        COALESCE(SUM(valor_causa)      FILTER (WHERE status = 'ativo'), 0)                                   AS total_causa,
        COUNT(*)             FILTER (WHERE status = 'ativo' AND valor_homologado > 0)                        AS processos_com_valor
      FROM processos p`),

    db.query(`
      SELECT situacao_atual, COUNT(*) AS total
      FROM processos p
      WHERE status = 'ativo' AND situacao_atual IS NOT NULL ${filtroP}
      GROUP BY situacao_atual ORDER BY total DESC`),

    db.query(`
      SELECT localizacao_processual, COUNT(*) AS total
      FROM processos p
      WHERE status = 'ativo' AND localizacao_processual IS NOT NULL ${filtroP}
      GROUP BY localizacao_processual ORDER BY total DESC`),

    db.query(`
      SELECT p.id, p.numero, p.situacao_atual, p.etapa_atual, c.nome AS cliente_nome
      FROM processos p
      LEFT JOIN clientes c ON c.id = p.cliente_id
      WHERE p.urgente = true AND p.status = 'ativo' ${filtroP}
      ORDER BY p.classificado_em DESC LIMIT 20`),

    db.query(`
      SELECT p.id, p.numero, p.tribunal, p.sync_falhas, p.atualizado_em
      FROM processos p
      WHERE p.sync_status = 'erro_sync' ${filtroP}
      ORDER BY p.sync_falhas DESC, p.atualizado_em ASC
      LIMIT 10`),

    db.queryOne(`
      SELECT COUNT(*) AS total,
             COUNT(*) FILTER (WHERE m.diagnostico_urgencia IN ('CRITICO','ALTO')) AS urgentes
      FROM movimentacoes m
      JOIN processos p ON p.id = m.processo_id
      WHERE m.criado_em >= NOW() - INTERVAL '24 hours' ${filtroM}`),

    db.query(`
      SELECT m.diagnostico_urgencia AS urgencia, COUNT(DISTINCT m.processo_id) AS total
      FROM movimentacoes m
      JOIN processos p ON p.id = m.processo_id
      WHERE m.diagnostico_urgencia IS NOT NULL ${filtroM}
      AND m.criado_em >= NOW() - INTERVAL '7 days'
      GROUP BY m.diagnostico_urgencia
      ORDER BY CASE m.diagnostico_urgencia
        WHEN 'CRITICO' THEN 1 WHEN 'ALTO' THEN 2 WHEN 'MEDIO' THEN 3 ELSE 4 END`),

    db.query(`
      SELECT t.urgencia, COUNT(*) AS total
      FROM tarefas t
      WHERE t.status NOT IN ('concluida','nao_verificada') ${filtroT}
      GROUP BY t.urgencia
      ORDER BY CASE t.urgencia
        WHEN 'CRITICO' THEN 1 WHEN 'ALTO' THEN 2 WHEN 'MEDIO' THEN 3 ELSE 4 END`),

    db.query(`
      SELECT a.data_hora, a.tipo, p.numero, p.tribunal, c.nome AS cliente_nome
      FROM audiencias a
      JOIN processos p ON p.id = a.processo_id
      LEFT JOIN clientes c ON c.id = p.cliente_id
      WHERE a.data_hora BETWEEN NOW() AND NOW() + INTERVAL '7 days'
      ${filtroP}
      ORDER BY a.data_hora ASC
      LIMIT 5`),

    db.query(`SELECT * FROM sync_execucoes ORDER BY iniciado_em DESC LIMIT 5`),

    db.queryOne(`
      SELECT
        COUNT(*) FILTER (WHERE m.criado_em >= NOW() - INTERVAL '24 hours') AS total_24h,
        COUNT(*) FILTER (WHERE m.criado_em >= NOW() - INTERVAL '7 days')   AS total_7d
      FROM movimentacoes m
      JOIN processos p ON p.id = m.processo_id
      WHERE 1=1 ${filtroM}`),

    db.query(`
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
      LIMIT 8`),
  ]);

  const agg = agregadosProcessos || {};
  const idx = (rows, chave, valor) => {
    const obj = {};
    for (const r of rows) obj[r[chave]] = Number(r[valor]);
    return obj;
  };

  const ultimaExecucao = syncExecucoes[0] || null;

  res.json({
    ok: true,
    processos: {
      totais: {
        ativo:    Number(agg.total_ativo    || 0),
        inativo:  Number(agg.total_inativo  || 0),
        suspenso: Number(agg.total_suspenso || 0),
        arquivado:Number(agg.total_arquivado|| 0),
      },
      total_ativos: Number(agg.total_ativo || 0),
    },
    urgencias: idx(urgencias, 'urgencia', 'total'),
    movs_hoje: movsHoje || { total: 0, urgentes: 0 },
    tarefas_pendentes: idx(tarefasPendentes, 'urgencia', 'total'),
    audiencias_7d: audiencias7d,
    sync: {
      por_status: {
        ok:         Number(agg.sync_ok    || 0),
        erro_sync:  Number(agg.sync_erro  || 0),
        pendente:   Number(agg.sync_pendente || 0),
      },
      cobertura: {
        ultima_atualizacao:  agg.ultima_atualizacao,
        via_datajud:         Number(agg.via_datajud   || 0),
        sem_fonte:           Number(agg.sem_fonte      || 0),
        com_falhas:          Number(agg.com_falhas     || 0),
        com_erro:            Number(agg.com_erro       || 0),
        com_polo_ativo:      Number(agg.com_polo_ativo || 0),
        com_polo_passivo:    Number(agg.com_polo_passivo || 0),
        total_monitorados:   Number(agg.total_monitorados || 0),
      },
      ultima_execucao: ultimaExecucao,
      execucoes_7d:    syncExecucoes,
      movs_novas:      syncMovsNovas || { total_24h: 0, total_7d: 0 },
      processos_erro:  syncErros,
    },
    alertas:     movsAlerta,
    situacoes:   situacaoCounts,
    localizacoes: localizacaoCounts,
    urgentes:    urgentesLista,
    requisicoes: {
      rpv_andamento:  Number(agg.rpv_andamento  || 0),
      rpv_expedida:   Number(agg.rpv_expedida   || 0),
      rpv_paga:       Number(agg.rpv_paga       || 0),
      prec_andamento: Number(agg.prec_andamento || 0),
      prec_pago:      Number(agg.prec_pago      || 0),
      alv_andamento:  Number(agg.alv_andamento  || 0),
      alv_pago:       Number(agg.alv_pago       || 0),
      total_rpv:       Number(agg.total_rpv       || 0),
      total_precatorio:Number(agg.total_precatorio|| 0),
      total_alvara:    Number(agg.total_alvara    || 0),
    },
    carteira: {
      total_homologado:  Number(agg.total_homologado  || 0),
      rpv_homologado:    Number(agg.rpv_homologado    || 0),
      prec_homologado:   Number(agg.prec_homologado   || 0),
      alv_homologado:    Number(agg.alv_homologado    || 0),
      total_causa:       Number(agg.total_causa       || 0),
      processos_com_valor:Number(agg.processos_com_valor || 0),
    },
  });
});
