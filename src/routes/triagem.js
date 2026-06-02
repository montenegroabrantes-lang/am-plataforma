import { Router } from 'express';
import { db }      from '../db/index.js';

export const triagemRouter = Router();

const ETAPA_CASE = `
  CASE
    WHEN p.situacao_atual IN ('rpv_paga','pagamento_realizado')
      OR p.status_rpv = 'paga'
      OR p.status_alvara = 'pagamento_realizado'         THEN 'Pagamento'
    WHEN p.situacao_atual IN ('arquivado','autos_baixados') THEN 'Arquivado'
    WHEN p.tipo_requisicao = 'alvara'
      OR p.situacao_atual IN ('aguardando_alvara','alvara_expedido') THEN 'Alvará'
    WHEN p.tipo_requisicao = 'precatorio'
      OR p.situacao_atual IN ('em_precatorio','minuta_precatorio_juntada',
        'precatorio_assinado','precatorio_remetido','precatorio_incluido_fila') THEN 'Precatório'
    WHEN p.tipo_requisicao = 'rpv'
      OR p.situacao_atual IN ('aguardando_rpv','em_rpv','rpv_expedida') THEN 'RPV'
    WHEN p.situacao_atual IN ('cumprimento_sentenca','calculos_apresentados',
      'fazenda_intimada_impugnar','impugnacao_fazenda_apresentada',
      'calculos_homologados') THEN 'Cumprimento de Sentença'
    WHEN p.situacao_atual IN ('em_recurso','em_segundo_grau','aguardando_baixa') THEN 'Recurso'
    WHEN p.situacao_atual IN ('concluso_sentenca','sentenca_proferida','sentenca_publicada') THEN 'Sentença'
    WHEN p.situacao_atual IN ('contestacao_apresentada','impugnacao_contestacao',
      'manifestacao_provas') THEN 'Contestação'
    WHEN p.situacao_atual IN ('em_conhecimento','aguardando_contestacao') THEN 'Inicial'
    ELSE 'Sem classificação'
  END
`;

// GET /api/triagem
triagemRouter.get('/', async (req, res) => {
  const {
    busca, ano, tribunal, vara, produto_id,
    polo_passivo, etapa, tempo_parado_min, pagamento,
    pagina = 1, por_pagina = 50,
  } = req.query;

  // Filtro de visibilidade e master (igual ao processos.js)
  const { pode_marcar_restrito, perfil, id: userId, master_id } = req.user;
  const masterId = pode_marcar_restrito ? null : (perfil === 'master' ? userId : master_id);

  const filterParams = [];
  function fp(val) { filterParams.push(val); return `$${filterParams.length}`; }

  const filterWheres = [`p.status IN ('ativo','suspenso')`];

  // Restrição por master (visibilidade de dados por sócio)
  if (masterId) {
    filterWheres.push(`(p.master_responsavel_id = ${fp(masterId)} OR p.compartilhado = true)`);
  }
  // Oculta processos restritos para quem não tem permissão
  if (!pode_marcar_restrito) {
    filterWheres.push(`(p.visibilidade = 'normal' OR p.visibilidade IS NULL)`);
  }

  if (busca) {
    filterWheres.push(`(p.numero ILIKE ${fp('%' + busca + '%')}
      OR COALESCE(c.nome, p.polo_ativo) ILIKE ${fp('%' + busca + '%')}
      OR p.polo_passivo ILIKE ${fp('%' + busca + '%')})`);
  }
  const anoNum          = Number(ano);
  const tempoParadoNum  = Number(tempo_parado_min);
  if (ano && !isNaN(anoNum))
    filterWheres.push(`EXTRACT(YEAR FROM p.data_distribuicao) = ${fp(anoNum)}`);
  if (tribunal)     filterWheres.push(`p.tribunal = ${fp(tribunal)}`);
  if (vara)         filterWheres.push(`p.vara ILIKE ${fp('%' + vara + '%')}`);
  if (produto_id)   filterWheres.push(`p.produto_id = ${fp(produto_id)}`);
  if (polo_passivo) filterWheres.push(`p.polo_passivo ILIKE ${fp('%' + polo_passivo + '%')}`);
  if (tempo_parado_min && !isNaN(tempoParadoNum)) {
    filterWheres.push(`EXTRACT(DAY FROM NOW() - ult.data_movimentacao) >= ${fp(tempoParadoNum)}`);
  }
  if (pagamento === 'true') {
    filterWheres.push(`(p.situacao_atual IN ('rpv_paga','pagamento_realizado')
      OR p.status_rpv = 'paga' OR p.status_alvara = 'pagamento_realizado')`);
  }

  const WHERE = `WHERE ${filterWheres.join(' AND ')}`;

  // CTE base — reutilizada pelas 3 queries
  const CTE = `
    WITH base AS (
      SELECT
        p.id, p.numero, p.tribunal,
        EXTRACT(YEAR FROM p.data_distribuicao)::int AS ano,
        p.vara, p.polo_passivo,
        COALESCE(c.nome, p.polo_ativo) AS cliente,
        pr.id   AS produto_id,
        pr.nome AS produto,
        EXTRACT(DAY FROM NOW() - ult.data_movimentacao)::int AS dias_parado,
        ult.texto             AS ultima_mov_texto,
        ult.data_movimentacao AS ultima_mov_data,
        ${ETAPA_CASE} AS etapa
      FROM processos p
      LEFT JOIN clientes  c  ON c.id  = p.cliente_id
      LEFT JOIN produtos  pr ON pr.id = p.produto_id
      LEFT JOIN LATERAL (
        SELECT texto, data_movimentacao
        FROM movimentacoes
        WHERE processo_id = p.id
        ORDER BY data_movimentacao DESC
        LIMIT 1
      ) ult ON true
      ${WHERE}
    )
  `;

  // Filtro de etapa aplicado depois do CTE (só na lista e no total)
  const etapaWhere = etapa && etapa !== 'Todos'
    ? `AND etapa = $${filterParams.length + 1}`
    : '';
  const etapaParam = etapa && etapa !== 'Todos' ? etapa : null;

  const offset   = (Number(pagina) - 1) * Number(por_pagina);
  // params da lista: [filterParams..., etapa?, limit, offset]
  const listaParams = [
    ...filterParams,
    ...(etapaParam ? [etapaParam] : []),
    Number(por_pagina),
    offset,
  ];
  const limitIdx  = listaParams.length - 1;
  const offsetIdx = listaParams.length;

  const [listaRows, statsRow, totalRow] = await Promise.all([
    // Lista paginada
    db.query(
      `${CTE}
       SELECT * FROM base
       WHERE 1=1 ${etapaWhere}
       ORDER BY dias_parado DESC NULLS LAST, ultima_mov_data ASC NULLS LAST
       LIMIT $${listaParams.length - 1} OFFSET $${listaParams.length}`,
      listaParams
    ),

    // Estatísticas (sem filtro de etapa — mostra distribuição completa)
    db.queryOne(
      `${CTE}
       SELECT
         (SELECT json_agg(r ORDER BY r.total DESC) FROM (
           SELECT etapa, COUNT(*)::int AS total FROM base GROUP BY etapa
         ) r) AS por_etapa,
         (SELECT json_agg(r ORDER BY r.total DESC) FROM (
           SELECT COALESCE(vara,'Não informada') AS vara, COUNT(*)::int AS total
           FROM base GROUP BY vara LIMIT 10
         ) r) AS por_vara,
         (SELECT json_agg(r ORDER BY r.total DESC) FROM (
           SELECT COALESCE(produto,'Não informado') AS produto, COUNT(*)::int AS total
           FROM base GROUP BY produto
         ) r) AS por_produto,
         (SELECT json_agg(r ORDER BY r.total DESC) FROM (
           SELECT COALESCE(polo_passivo,'Não informado') AS polo_passivo, COUNT(*)::int AS total
           FROM base GROUP BY polo_passivo LIMIT 10
         ) r) AS por_polo_passivo,
         (SELECT json_agg(r ORDER BY r.min_dias) FROM (
           SELECT
             CASE
               WHEN dias_parado < 30   THEN '< 30 dias'
               WHEN dias_parado < 60   THEN '30–60 dias'
               WHEN dias_parado < 90   THEN '60–90 dias'
               WHEN dias_parado < 180  THEN '90–180 dias'
               ELSE '+ 180 dias'
             END AS faixa,
             COUNT(*)::int AS total,
             MIN(dias_parado) AS min_dias
           FROM base GROUP BY faixa
         ) r) AS por_tempo`,
      filterParams
    ),

    // Total para paginação
    db.queryOne(
      `${CTE}
       SELECT COUNT(*)::int AS total FROM base
       WHERE 1=1 ${etapaWhere}`,
      etapaParam ? [...filterParams, etapaParam] : filterParams
    ),
  ]);

  const stats = statsRow || {};

  res.json({
    ok: true,
    processos: listaRows,
    total:     totalRow?.total || 0,
    pagina:    Number(pagina),
    por_pagina: Number(por_pagina),
    stats: {
      por_etapa:        stats.por_etapa        || [],
      por_vara:         stats.por_vara          || [],
      por_produto:      stats.por_produto       || [],
      por_polo_passivo: stats.por_polo_passivo  || [],
      por_tempo:        stats.por_tempo         || [],
    },
  });
});
