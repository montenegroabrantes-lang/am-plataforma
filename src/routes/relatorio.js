import { Router } from 'express';
import { db }      from '../db/index.js';

export const relatorioRouter = Router();

// GET /api/relatorio — relatório gerencial consolidado
relatorioRouter.get('/', async (req, res) => {
  const { id, perfil, master_id, pode_marcar_restrito } = req.user;
  const masterId = pode_marcar_restrito ? null : (perfil === 'master' ? id : master_id);
  const filtroMaster = masterId ? `AND master_responsavel_id = '${masterId}'` : '';
  const filtroProcesso = masterId ? `AND p.master_responsavel_id = '${masterId}'` : '';

  const [
    processos,
    financeiro,
    pipeline,
    tarefas,
    audiencias,
  ] = await Promise.all([

    // Processos por status
    db.query(`
      SELECT status, COUNT(*) AS total
      FROM processos WHERE 1=1 ${filtroProcesso.replace('AND p.','AND ')}
      GROUP BY status`),

    // Financeiro — receita a receber e recebida
    db.query(`
      SELECT
        COALESCE(SUM(valor_honorario) FILTER (WHERE status = 'a_receber'), 0)      AS a_receber,
        COALESCE(SUM(valor_honorario) FILTER (WHERE status = 'recebido'), 0)       AS recebido,
        COALESCE(SUM(valor_honorario) FILTER (WHERE status = 'recebido_parcial'), 0) AS recebido_parcial,
        COALESCE(SUM(valor_honorario), 0)                                           AS total_carteira
      FROM honorarios WHERE 1=1 ${filtroMaster}`),

    // Pipeline — leads por etapa
    db.query(`
      SELECT etapa, COUNT(*) AS total
      FROM leads WHERE 1=1 ${filtroMaster}
      GROUP BY etapa`),

    // Tarefas em aberto por urgência
    db.query(`
      SELECT urgencia, COUNT(*) AS total
      FROM tarefas
      WHERE status NOT IN ('concluida') ${filtroMaster.replace('master_responsavel_id','validado_por')}
      GROUP BY urgencia`),

    // Próximas audiências (30 dias)
    db.query(`
      SELECT a.data_hora, a.tipo, p.numero, p.tribunal, c.nome AS cliente_nome
      FROM audiencias a
      JOIN processos p ON p.id = a.processo_id ${masterId ? `AND p.master_responsavel_id = '${masterId}'` : ''}
      LEFT JOIN clientes c ON c.id = p.cliente_id
      WHERE a.data_hora BETWEEN NOW() AND NOW() + INTERVAL '30 days'
      ORDER BY a.data_hora ASC
      LIMIT 10`),
  ]);

  res.json({
    ok: true,
    processos:  indexarPorChave(processos, 'status', 'total'),
    financeiro: financeiro[0] || {},
    pipeline:   indexarPorChave(pipeline, 'etapa', 'total'),
    tarefas:    indexarPorChave(tarefas, 'urgencia', 'total'),
    proximas_audiencias: audiencias,
  });
});

// GET /api/relatorio/sac — aba SAC (dados Digisac + Camila)
relatorioRouter.get('/sac', async (req, res) => {
  const [atendimentos, conversao, processosAtivos] = await Promise.all([

    // Eventos SAC por tipo (últimos 30 dias)
    db.query(`
      SELECT tipo, COUNT(*) AS total
      FROM eventos_sac
      WHERE criado_em >= NOW() - INTERVAL '30 days'
      GROUP BY tipo`),

    // Taxa de conversão: leads → clientes
    db.query(`
      SELECT
        COUNT(*) FILTER (WHERE etapa = 'convertido')              AS convertidos,
        COUNT(*) FILTER (WHERE etapa NOT IN ('perdido'))          AS ativos,
        COUNT(*)                                                   AS total
      FROM leads
      WHERE criado_em >= NOW() - INTERVAL '30 days'`),

    // Processos ativos vindos da Camila (Google Sheets)
    db.query(`
      SELECT COUNT(*) AS total
      FROM eventos_sac
      WHERE tipo = 'lead_qualificado' AND processado = true`),
  ]);

  res.json({
    ok: true,
    atendimentos: indexarPorChave(atendimentos, 'tipo', 'total'),
    conversao: conversao[0] || {},
    processos_camila: processosAtivos[0]?.total || 0,
  });
});

// GET /api/relatorio/financeiro — detalhamento financeiro por período
relatorioRouter.get('/financeiro', async (req, res) => {
  const { de, ate } = req.query;
  const { id, perfil, master_id, pode_marcar_restrito } = req.user;
  const masterId = pode_marcar_restrito ? null : (perfil === 'master' ? id : master_id);

  const params = [];
  const condicoes = ['1=1'];

  if (masterId) { params.push(masterId); condicoes.push(`h.master_responsavel_id = $${params.length}`); }
  if (de)  { params.push(de);  condicoes.push(`h.criado_em >= $${params.length}`); }
  if (ate) { params.push(ate); condicoes.push(`h.criado_em <= $${params.length}`); }

  const rows = await db.query(
    `SELECT
       DATE_TRUNC('month', h.criado_em) AS mes,
       SUM(valor_honorario)              AS total_honorarios,
       SUM(valor_recebido)               AS total_recebido,
       COUNT(*)                          AS qtd_processos
     FROM honorarios h
     WHERE ${condicoes.join(' AND ')}
     GROUP BY mes ORDER BY mes DESC`,
    params
  );

  res.json({ ok: true, mensal: rows });
});

function indexarPorChave(rows, chave, valor) {
  const obj = {};
  for (const row of rows) obj[row[chave]] = Number(row[valor]);
  return obj;
}
