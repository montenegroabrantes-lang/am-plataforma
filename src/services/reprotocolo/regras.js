// Regras das filas de re-protocolo — CÓPIA FIEL das condições já usadas pela tela de Tarefas
// (src/routes/tarefas.js: GET /api/tarefas filas `reprotocolo`/`ciclos`, GET /resumo e o
// LEFT JOIN LATERAL de polo passivo) e pelo cron (src/services/ciclosRecorrentes.js).
//
// Não são regras novas: o levantamento precisa contar exatamente o que a tela conta. Por isso
// tarefas.js não foi alterado (arquivo crítico, sem testes de rota) e a equivalência é
// garantida por teste: regras.test.js lê tarefas.js/ciclosRecorrentes.js e falha se qualquer
// um destes fragmentos deixar de existir lá. Mudou a regra da tela? Atualize os dois lados.

// ── Filas (tarefas.js → filas.reprotocolo / filas.ciclos / resumo.reprotocolo / resumo.ciclos) ──
export const TAREFA_ABERTA = `t.status NOT IN ('concluida','cancelada')`;
// "Re-protocolo": ciclo já aceito (manual, em lote ou automático), pronto pra protocolar.
export const FILA_REPROTOCOLO = `t.tipo='protocolar' AND t.processo_id IS NULL AND t.ciclo_inicio IS NOT NULL AND t.subtipo <> 'ciclo'`;
// "Novos ciclos": ainda aguardando aceite do Master…
export const FILA_CICLOS = `t.tipo='protocolar' AND t.subtipo='ciclo'`;
// …e fora dela enquanto adiado.
export const CICLO_NAO_ADIADO = `(t.ciclo_adiado_ate IS NULL OR t.ciclo_adiado_ate <= CURRENT_DATE)`;

// ── Resolução de cliente/tese/polo (tarefas.js → GET /api/tarefas) ──
export const CLIENTE_ID = `COALESCE(cl.id,tc.id,oc.id,pc.id)`;
export const CLIENTE_NOME = `COALESCE(cl.nome,tc.nome,oc.nome,pc.nome,ob.nome)`;
export const CLIENTE_CPF = `COALESCE(cl.cpf,tc.cpf,oc.cpf,pc.cpf)`;
export const PRODUTO_ID = `COALESCE(pr.id,opr.id,ppr.id)`;
export const PRODUTO_NOME = `COALESCE(pr.nome,opr.nome,ppr.nome)`;

// Mesmos LEFT JOINs da listagem de tarefas (os que não mudam cliente/tese/polo foram omitidos;
// todos são por chave primária, então omiti-los não muda a contagem de linhas).
export const JOINS_TAREFA = `
     LEFT JOIN processos p ON p.id=t.processo_id
     LEFT JOIN produtos ppr ON ppr.id=p.produto_id
     LEFT JOIN clientes pc ON pc.id=p.cliente_id
     LEFT JOIN usuarios u ON u.id=t.atribuido_a
     LEFT JOIN cliente_produtos cp ON cp.id=t.cliente_produto_id
     LEFT JOIN clientes cl ON cl.id=cp.cliente_id
     LEFT JOIN produtos pr ON pr.id=cp.produto_id
     LEFT JOIN clientes tc ON tc.id=t.cliente_id
     LEFT JOIN onboardings_contrato ob ON ob.id=t.onboarding_id
     LEFT JOIN clientes oc ON oc.id=ob.cliente_id
     LEFT JOIN onboarding_produtos op ON op.id=t.onboarding_produto_id
     LEFT JOIN produtos opr ON opr.id=op.produto_id`;

// Agregação dos vínculos do cliente — mesmas expressões de qtd/polos da listagem de tarefas.
// (A lista JSON traz alguns campos a mais — início/fim — que a tela não usa.)
export const VINCULOS_QTD_ATIVOS = `COUNT(*) FILTER (WHERE cv.vinculo_ativo)::int AS qtd_vinculos_ativos`;
export const VINCULOS_POLOS = `ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(TRIM(cv.polo_passivo), '')) FILTER (WHERE cv.vinculo_ativo), NULL) AS polos_passivos_vinculo`;
export const VINCULOS_DO_CLIENTE = `WHERE cv.cliente_id = COALESCE(cl.id,tc.id,oc.id,pc.id)`;
export const JOIN_VINCULOS = `
     LEFT JOIN LATERAL (
       SELECT
         COALESCE(json_agg(jsonb_build_object('id',cv.id,'cargo',cv.cargo,'orgao',cv.orgao,'polo_passivo',cv.polo_passivo,
                                              'vinculo_inicio',cv.vinculo_inicio,'vinculo_fim',cv.vinculo_fim) ORDER BY cv.ordem, cv.id)
                  FILTER (WHERE cv.vinculo_ativo), '[]'::json) AS vinculos_ativos,
         ${VINCULOS_QTD_ATIVOS},
         COUNT(*)::int AS qtd_vinculos,
         ${VINCULOS_POLOS}
       FROM cliente_vinculos cv
       ${VINCULOS_DO_CLIENTE}
     ) vinc ON true`;

// Prioridade do polo passivo: processo já existente > vínculo ativo único > cadastro do cliente
// > padrão da tese. Com 2+ vínculos ativos a tela nunca escolhe pelo vínculo (fica p/ humano).
export const POLO_PASSIVO = `COALESCE(
              NULLIF(TRIM(p.polo_passivo), ''),
              CASE WHEN vinc.qtd_vinculos_ativos = 1 THEN vinc.polos_passivos_vinculo[1] END,
              NULLIF(TRIM(COALESCE(cl.polo_passivo,tc.polo_passivo,oc.polo_passivo,pc.polo_passivo)), ''),
              NULLIF(TRIM(COALESCE(pr.polos_passivos_padrao[1],opr.polos_passivos_padrao[1],ppr.polos_passivos_padrao[1])), '')
            )`;
// Os 4 degraus, separados, só para informar DE ONDE veio o polo (mesmas expressões acima).
export const POLO_DEGRAUS = `
  NULLIF(TRIM(p.polo_passivo), '') AS polo_processo,
  CASE WHEN vinc.qtd_vinculos_ativos = 1 THEN vinc.polos_passivos_vinculo[1] END AS polo_vinculo_unico,
  NULLIF(TRIM(COALESCE(cl.polo_passivo,tc.polo_passivo,oc.polo_passivo,pc.polo_passivo)), '') AS polo_cliente,
  NULLIF(TRIM(COALESCE(pr.polos_passivos_padrao[1],opr.polos_passivos_padrao[1],ppr.polos_passivos_padrao[1])), '') AS polo_padrao_tese,
  COALESCE(cardinality(COALESCE(pr.polos_passivos_padrao,opr.polos_passivos_padrao,ppr.polos_passivos_padrao)), 0)::int AS padrao_tese_opcoes`;

// ── Regras do cron (ciclosRecorrentes.js) ──
// "Último processo" que define o início do ciclo: mesmo cliente + tese, com periodo_fim, o mais
// recente. (Desempate por criado_em/id só para o resultado ser determinístico.)
export const ULTIMO_PROCESSO_FILTRO = `AND px.periodo_fim IS NOT NULL`;
export const ULTIMO_PROCESSO_ORDEM = `ORDER BY px.periodo_fim DESC, px.criado_em DESC, px.id LIMIT 1`;
// "Já existe processo cobrindo este ciclo?" — o cron não cria ciclo quando isto é verdade.
export const PROCESSO_COBRINDO = `pz.status NOT IN ('arquivado') AND (pz.periodo_fim IS NULL OR pz.periodo_fim >= t.ciclo_inicio)`;

// Janela usada pela referência oficial (remuneracaoEstadual.js): as últimas 60 competências,
// incluindo a do mês corrente. Competência anterior a isso = "mais de 5 anos".
export const MESES_JANELA_QUINQUENAL = 60;
