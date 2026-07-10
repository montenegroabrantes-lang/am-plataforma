import { Router } from 'express';
import { db }      from '../db/index.js';
import { ETAPA_CASE } from '../utils/etapas.js';

export const triagemRouter = Router();

// GET /api/triagem
triagemRouter.get('/', async (req, res) => {
  const {
    busca, ano, tribunal, vara, produto_id,
    polo_passivo, etapa, tempo_parado_min, pagamento,
    funcao_cliente, movimentacao_pendente,
    pagina = 1, por_pagina = 50,
  } = req.query;

  // Filtro de visibilidade e master (igual ao processos.js)
  const { pode_marcar_restrito } = req.user;

  const filterParams = [];
  function fp(val) { filterParams.push(val); return `$${filterParams.length}`; }

  const filterWheres = [`p.status IN ('ativo','suspenso')`];

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
  if (funcao_cliente)         filterWheres.push(`c.cargo ILIKE ${fp('%' + funcao_cliente + '%')}`);
  if (movimentacao_pendente === 'true') filterWheres.push(`p.requer_revisao = true`);

  const WHERE = `WHERE ${filterWheres.join(' AND ')}`;

  // CTE base — reutilizada pelas 3 queries
  const CTE = `
    WITH base AS (
      SELECT
        p.id, p.numero, p.tribunal,
        EXTRACT(YEAR FROM p.data_distribuicao)::int AS ano,
        NULLIF(TRIM(p.vara), '')         AS vara,
        NULLIF(TRIM(p.polo_passivo), '') AS polo_passivo,
        c.id AS cliente_id,
        c.cpf AS cliente_cpf,
        COALESCE(c.nome, p.polo_ativo) AS cliente,
        NULLIF(TRIM(c.cargo), '') AS funcao,
        p.requer_revisao AS movimentacao_pendente,
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
           FROM base GROUP BY vara ORDER BY total DESC
         ) r) AS por_vara,
         (SELECT json_agg(r ORDER BY r.total DESC) FROM (
           SELECT COALESCE(produto,'Não informado') AS produto, COUNT(*)::int AS total
           FROM base GROUP BY produto
         ) r) AS por_produto,
         (SELECT json_agg(r ORDER BY r.total DESC) FROM (
           SELECT COALESCE(polo_passivo,'Não informado') AS polo_passivo, COUNT(*)::int AS total
           FROM base GROUP BY polo_passivo ORDER BY total DESC LIMIT 30
         ) r) AS por_polo_passivo,
         (SELECT json_agg(r ORDER BY r.total DESC) FROM (
           SELECT COALESCE(funcao,'Não informada') AS funcao, COUNT(*)::int AS total
           FROM base GROUP BY funcao ORDER BY total DESC LIMIT 30
         ) r) AS por_funcao,
         (SELECT COUNT(*)::int FROM base WHERE movimentacao_pendente = true) AS movimentacao_pendente,
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
      por_funcao:       stats.por_funcao        || [],
      por_tempo:        stats.por_tempo         || [],
      movimentacao_pendente: Number(stats.movimentacao_pendente || 0),
    },
  });
});
