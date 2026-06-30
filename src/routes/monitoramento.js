import { Router } from 'express';
import { db }      from '../db/index.js';

export const monitoramentoRouter = Router();

// GET /api/monitoramento
monitoramentoRouter.get('/', async (req, res) => {
  const params  = [];
  const filtroP = '';

  const [
    kpis,
    porTribunal,
    serieHistorica,
    ultimoSync,
    syncPorTribunal,
    ultimoProcesso,
    semAtualizacao,
  ] = await Promise.all([

    // KPIs gerais
    db.queryOne(`
      SELECT
        COUNT(*)                                                         AS total_processos,
        COUNT(*) FILTER (WHERE p.status = 'ativo')                       AS processos_ativos,
        COUNT(DISTINCT p.tribunal)                                       AS tribunais_ativos,
        COUNT(*) FILTER (WHERE p.sync_status = 'erro_sync')              AS processos_erro,
        COUNT(*) FILTER (WHERE p.sync_status = 'aguardando_primeira_captura') AS aguardando_sync,
        (SELECT COUNT(*) FROM movimentacoes m2
           JOIN processos p2 ON p2.id = m2.processo_id
           WHERE 1=1 ${filtroP.replace('p.', 'p2.')})                    AS total_movimentacoes,
        (SELECT COUNT(*) FROM movimentacoes m3
           JOIN processos p3 ON p3.id = m3.processo_id
           WHERE m3.criado_em >= NOW() - INTERVAL '24 hours' ${filtroP.replace('p.', 'p3.')}) AS movs_24h
      FROM processos p WHERE 1=1 ${filtroP}`, params),

    // Processos por tribunal (barra horizontal)
    db.query(`
      SELECT
        p.tribunal,
        COUNT(*)                                              AS total,
        COUNT(*) FILTER (WHERE p.status = 'ativo')           AS ativos,
        COUNT(*) FILTER (WHERE p.sync_status = 'erro_sync')  AS erros,
        MAX(p.atualizado_em)                                  AS ultima_atualizacao
      FROM processos p
      WHERE 1=1 ${filtroP}
      GROUP BY p.tribunal
      ORDER BY total DESC`, params),

    // Série histórica — movimentações por semana (últimos 60 dias)
    db.query(`
      SELECT
        DATE_TRUNC('week', m.criado_em)::date AS semana,
        COUNT(*)                               AS total
      FROM movimentacoes m
      JOIN processos p ON p.id = m.processo_id
      WHERE m.criado_em >= NOW() - INTERVAL '60 days'
      ${filtroP}
      GROUP BY 1
      ORDER BY 1 ASC`, params),

    // Última execução de sync
    db.queryOne(`
      SELECT * FROM sync_execucoes
      ORDER BY iniciado_em DESC LIMIT 1`),

    // Status de sync por tribunal
    db.query(`
      SELECT
        p.tribunal,
        COUNT(*)                                                         AS total_processos,
        COUNT(*) FILTER (WHERE p.sync_status = 'ok')                     AS sincronizados,
        COUNT(*) FILTER (WHERE p.sync_status = 'erro_sync')              AS com_erro,
        COUNT(*) FILTER (WHERE p.sync_status = 'aguardando_primeira_captura') AS aguardando,
        MAX(p.atualizado_em)                                             AS ultima_atualizacao,
        EXTRACT(DAY FROM NOW() - MAX(p.atualizado_em))::int              AS dias_sem_atualizacao
      FROM processos p
      WHERE 1=1 ${filtroP}
      GROUP BY p.tribunal
      ORDER BY dias_sem_atualizacao DESC NULLS LAST`, params),

    // Último processo sincronizado com sucesso
    db.queryOne(`
      SELECT p.id, p.numero, p.tribunal, p.vara, p.atualizado_em,
             c.nome AS cliente_nome, p.sync_fonte
      FROM processos p
      LEFT JOIN clientes c ON c.id = p.cliente_id
      WHERE p.sync_status = 'ok' ${filtroP}
      ORDER BY p.atualizado_em DESC
      LIMIT 1`, params),

    // Processos sem atualização há mais de 7 dias (por tribunal)
    db.query(`
      SELECT
        p.tribunal,
        COUNT(*) FILTER (WHERE p.atualizado_em < NOW() - INTERVAL '7 days')  AS sem_7d,
        COUNT(*) FILTER (WHERE p.atualizado_em < NOW() - INTERVAL '14 days') AS sem_14d,
        COUNT(*) FILTER (WHERE p.atualizado_em < NOW() - INTERVAL '30 days') AS sem_30d
      FROM processos p
      WHERE p.status = 'ativo' ${filtroP}
      GROUP BY p.tribunal
      ORDER BY sem_7d DESC`, params),

  ]);

  res.json({
    ok: true,
    kpis:               kpis || {},
    por_tribunal:       porTribunal,
    serie_historica:    serieHistorica,
    ultima_execucao:    ultimoSync || null,
    sync_por_tribunal:  syncPorTribunal,
    ultimo_processo:    ultimoProcesso || null,
    sem_atualizacao:    semAtualizacao,
  });
});
