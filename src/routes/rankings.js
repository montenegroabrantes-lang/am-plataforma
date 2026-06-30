import { Router } from 'express';
import { db }      from '../db/index.js';

export const rankingsRouter = Router();

// GET /api/rankings
rankingsRouter.get('/', async (req, res) => {
  const params  = [];
  const filtroP = '';

  const [
    rankingDemandas,
    rankingPolosPassivos,
    rankingVaras,
    rankingAssuntos,
    tempoPorEtapa,
    distribuicaoAno,
    processosParados,
    valorPorEtapa,
  ] = await Promise.all([

    // Ranking de demandas (por classe/ação)
    db.query(`
      SELECT
        COALESCE(acao, 'Não informado')          AS demanda,
        COUNT(*)                                  AS total,
        COUNT(*) FILTER (WHERE urgente = true)    AS urgentes,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) AS percentual
      FROM processos p
      WHERE status = 'ativo' ${filtroP}
      GROUP BY acao
      ORDER BY total DESC
      LIMIT 15`, params),

    // Ranking de polos passivos (réus mais frequentes)
    db.query(`
      SELECT
        TRIM(UNNEST(STRING_TO_ARRAY(polo_passivo, ','))) AS polo,
        COUNT(*)                                          AS total
      FROM processos p
      WHERE status = 'ativo'
        AND polo_passivo IS NOT NULL
        AND polo_passivo <> ''
        ${filtroP}
      GROUP BY 1
      ORDER BY total DESC
      LIMIT 15`, params),

    // Ranking de varas com tempo médio parado
    db.query(`
      SELECT
        COALESCE(vara, 'Não informada')           AS vara,
        COUNT(*)                                   AS total,
        ROUND(AVG(
          EXTRACT(DAY FROM NOW() - atualizado_em)
        ))::int                                    AS media_dias_parado,
        COUNT(*) FILTER (WHERE urgente = true)     AS urgentes
      FROM processos p
      WHERE status = 'ativo' ${filtroP}
      GROUP BY vara
      ORDER BY total DESC
      LIMIT 15`, params),

    // Ranking de assuntos processuais (campo novo do DataJud)
    db.query(`
      SELECT
        COALESCE(assunto_principal, 'Não informado') AS assunto,
        COUNT(*)                                      AS total,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) AS percentual
      FROM processos p
      WHERE status = 'ativo' ${filtroP}
      GROUP BY assunto_principal
      ORDER BY total DESC
      LIMIT 12`, params),

    // Tempo médio por etapa processual
    db.query(`
      SELECT
        COALESCE(etapa_atual, 'Sem classificação') AS etapa,
        COUNT(*)                                    AS total,
        ROUND(AVG(
          EXTRACT(DAY FROM NOW() - COALESCE(data_inicio_situacao, criado_em))
        ))::int                                     AS media_dias_na_etapa
      FROM processos p
      WHERE status = 'ativo' ${filtroP}
      GROUP BY etapa_atual
      ORDER BY total DESC`, params),

    // Distribuição por ano de ajuizamento
    db.query(`
      SELECT
        EXTRACT(YEAR FROM data_distribuicao)::int AS ano,
        COUNT(*)                                   AS total
      FROM processos p
      WHERE status = 'ativo'
        AND data_distribuicao IS NOT NULL
        ${filtroP}
      GROUP BY 1
      ORDER BY 1 DESC
      LIMIT 10`, params),

    // Processos mais parados (sem movimentação)
    db.query(`
      SELECT
        p.id, p.numero, p.tribunal, p.vara,
        COALESCE(c.nome, '—')                              AS cliente_nome,
        EXTRACT(DAY FROM NOW() - p.atualizado_em)::int     AS dias_parado,
        p.situacao_atual, p.urgente
      FROM processos p
      LEFT JOIN clientes c ON c.id = p.cliente_id
      WHERE p.status = 'ativo' ${filtroP}
      ORDER BY p.atualizado_em ASC
      LIMIT 10`, params),

    // Valor em carteira por tipo de requisição
    db.query(`
      SELECT
        COALESCE(tipo_requisicao, 'a_definir')             AS tipo,
        COUNT(*)                                            AS total,
        COALESCE(SUM(valor_homologado), 0)                 AS valor_total,
        COALESCE(SUM(valor_causa), 0)                      AS valor_causa_total
      FROM processos p
      WHERE status = 'ativo' ${filtroP}
      GROUP BY tipo_requisicao
      ORDER BY valor_total DESC`, params),

  ]);

  res.json({
    ok: true,
    ranking_demandas:      rankingDemandas,
    ranking_polos_passivos: rankingPolosPassivos,
    ranking_varas:         rankingVaras,
    ranking_assuntos:      rankingAssuntos,
    tempo_por_etapa:       tempoPorEtapa,
    distribuicao_ano:      distribuicaoAno,
    processos_parados:     processosParados,
    valor_por_tipo:        valorPorEtapa,
  });
});
