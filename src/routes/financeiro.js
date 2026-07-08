import { Router } from 'express';
import { db }      from '../db/index.js';
import { apenasMaster } from '../middleware/auth.js';
import { registrarAuditoria } from '../middleware/auditoria.js';

export const financeiroRouter = Router();

// GET /api/financeiro — resumo + lançamentos do mês (o único "lançamento" hoje é honorário;
// despesas/reembolso/repasse ainda não têm tabela própria — ver nota no POST abaixo)
financeiroRouter.get('/', async (req, res) => {
  const { mes } = req.query; // 'YYYY-MM'
  const params = [];
  const condicoes = ['1=1'];

  if (mes && /^\d{4}-\d{2}$/.test(mes)) {
    params.push(`${mes}-01`);
    condicoes.push(`date_trunc('month', COALESCE(h.data_recebimento, h.criado_em)) = date_trunc('month', $${params.length}::date)`);
  }

  const rows = await db.query(
    `SELECT h.*, p.numero AS processo_numero, p.tribunal,
            c.nome AS cliente_nome, u.nome AS master_nome
     FROM honorarios h
     JOIN processos p  ON p.id = h.processo_id
     LEFT JOIN clientes c ON c.id = p.cliente_id
     LEFT JOIN usuarios u ON u.id = h.master_responsavel_id
     WHERE ${condicoes.join(' AND ')}
     ORDER BY COALESCE(h.data_recebimento, h.criado_em) DESC`,
    params
  );

  const lancamentos = rows.map(h => ({
    id: h.id,
    data: h.data_recebimento || h.criado_em,
    tipo: 'honorario',
    descricao: `${h.tipo === 'rpv' ? 'RPV' : 'Precatório'} — ${h.processo_numero}${h.cliente_nome ? ` — ${h.cliente_nome}` : ''}`,
    status: h.status === 'recebido' ? 'pago' : h.status === 'cancelado' ? 'cancelado' : 'pendente',
    valor: h.status === 'recebido' ? h.valor_recebido : h.valor_honorario,
  }));

  const totaisRaw = await db.queryOne(
    `SELECT
       COALESCE(SUM(valor_recebido) FILTER (WHERE status = 'recebido'), 0)  AS recebido,
       COALESCE(SUM(valor_honorario) FILTER (WHERE status = 'a_receber'), 0) AS a_receber
     FROM honorarios h
     WHERE ${condicoes.join(' AND ')}`,
    params
  );

  // Previsão: processos com valor homologado já lançado mas ainda sem pagamento confirmado
  // (RPV/Precatório em andamento) e sem honorário ainda criado — não soma com "a_receber" acima.
  const previsao = await db.queryOne(
    `SELECT COALESCE(SUM(p.valor_homologado * cp.honorarios_pct / 100), 0) AS previsto, COUNT(*) AS processos
     FROM processos p
     JOIN cliente_produtos cp ON cp.cliente_id = p.cliente_id AND cp.produto_id = p.produto_id
     WHERE p.valor_homologado IS NOT NULL
       AND (
         (p.tipo_requisicao = 'rpv'        AND p.status_rpv        IS DISTINCT FROM 'paga') OR
         (p.tipo_requisicao = 'precatorio' AND p.status_precatorio IS DISTINCT FROM 'pagamento_disponibilizado')
       )
       AND NOT EXISTS (SELECT 1 FROM honorarios h WHERE h.processo_id = p.id AND h.tipo = p.tipo_requisicao)`
  ).catch(() => ({ previsto: 0, processos: 0 }));

  const receitas = Number(totaisRaw.recebido);
  // Ainda não existe tabela de despesas — módulo cobre só honorários (receita) por enquanto.
  const despesas = 0;

  const resumo = {
    receitas,
    despesas,
    resultado: receitas - despesas,
    a_receber: Number(totaisRaw.a_receber),
    previsao: Number(previsao.previsto),
    previsao_processos: Number(previsao.processos),
  };

  res.json({ ok: true, lancamentos, resumo });
});

// POST /api/financeiro — registra lançamento. Hoje só "honorario" é suportado de fato
// (tabela honorarios); despesa/reembolso/repasse aguardam um módulo de lançamentos genérico.
financeiroRouter.post('/', apenasMaster, async (req, res) => {
  const { tipo, descricao, valor, data, processo_id, status } = req.body;

  if (tipo && tipo !== 'honorario') {
    return res.status(400).json({ ok: false, erro: `Lançamentos do tipo "${tipo}" ainda não são suportados — só honorário (RPV/Precatório) por enquanto.` });
  }
  if (!processo_id || !valor) {
    return res.status(400).json({ ok: false, erro: 'processo_id e valor são obrigatórios.' });
  }

  const processo = await db.queryOne(`SELECT tipo_requisicao FROM processos WHERE id = $1`, [processo_id]);
  if (!processo) return res.status(404).json({ ok: false, erro: 'Processo não encontrado.' });

  const tipoHonorario = processo.tipo_requisicao === 'precatorio' ? 'precatorio' : 'rpv';
  const masterId = req.user.perfil === 'master' ? req.user.id : req.user.master_id;
  const statusHonorario = status === 'pago' ? 'recebido' : 'a_receber';

  const [novo] = await db.query(
    `INSERT INTO honorarios (processo_id, master_responsavel_id, tipo, valor_bruto, percentual, valor_honorario, status, valor_recebido, data_recebimento, registrado_por)
     VALUES ($1,$2,$3,$4,100,$4,$5,$6,$7,$8)
     RETURNING *`,
    [processo_id, masterId, tipoHonorario, valor, statusHonorario,
     statusHonorario === 'recebido' ? valor : null,
     statusHonorario === 'recebido' ? (data || new Date()) : null,
     req.user.id]
  );

  await registrarAuditoria({
    usuarioId: req.user.id, acao: 'criar', entidade: 'honorario',
    entidadeId: novo.id, valorDepois: { ...novo, descricao_informada: descricao || null }, ip: req._ip,
  });

  res.status(201).json({ ok: true, honorario: novo });
});

// PATCH /api/financeiro/:id — atualiza status (recebimento)
financeiroRouter.patch('/:id', apenasMaster, async (req, res) => {
  const { status, valor_recebido, data_recebimento } = req.body;

  const antes = await db.queryOne('SELECT * FROM honorarios WHERE id = $1', [req.params.id]);
  if (!antes) return res.status(404).json({ ok: false, erro: 'Honorário não encontrado.' });

  const statusValidos = ['a_receber', 'recebido', 'cancelado'];
  if (status && !statusValidos.includes(status)) {
    return res.status(400).json({ ok: false, erro: `Status inválido. Use: ${statusValidos.join(', ')}` });
  }
  if (status === 'recebido') {
    const val = Number(valor_recebido ?? antes.valor_recebido);
    if (!val || val <= 0) return res.status(400).json({ ok: false, erro: 'Valor recebido deve ser maior que zero.' });
    if (val > Number(antes.valor_honorario) * 1.5) return res.status(400).json({ ok: false, erro: 'Valor recebido excede 150% do honorário — confirme o valor.' });
  }

  await db.execute(
    `UPDATE honorarios SET
       status = COALESCE($1, status),
       valor_recebido = COALESCE($2, valor_recebido),
       data_recebimento = COALESCE($3, data_recebimento)
     WHERE id = $4`,
    [status || null, valor_recebido || null, data_recebimento || null, req.params.id]
  );

  await registrarAuditoria({
    usuarioId: req.user.id, acao: 'editar', entidade: 'honorario',
    entidadeId: req.params.id, valorAntes: antes,
    valorDepois: { status, valor_recebido, data_recebimento }, ip: req._ip,
  });

  res.json({ ok: true });
});
