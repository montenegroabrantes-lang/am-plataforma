import { Router } from 'express';
import { db } from '../db/index.js';
import { uuidValido, paginacaoSegura } from '../utils/validacao.js';
import { concluirCadastroOnboarding } from '../services/onboarding.js';

export const onboardingsRouter = Router();

onboardingsRouter.param('id', (req, res, next, id) => {
  if (!uuidValido(id)) return res.status(400).json({ ok: false, erro: 'ID inválido.' });
  next();
});

onboardingsRouter.get('/', async (req, res) => {
  const { status, page, limite } = req.query;
  const { pagina, limite: lim, offset } = paginacaoSegura(page, limite || 50);
  const params = [];
  const condicoes = [`o.status <> 'cancelado'`];
  if (status) { params.push(status); condicoes.push(`o.status=$${params.length}`); }
  if (req.user.perfil !== 'master') {
    params.push(req.user.id);
    condicoes.push(`(o.responsavel_cadastro_id=$${params.length} OR o.responsavel_protocolo_id=$${params.length})`);
  }
  const totalResult = await db.query(`SELECT COUNT(*)::int total FROM onboardings_contrato o WHERE ${condicoes.join(' AND ')}`, params);
  params.push(lim, offset);
  const rows = await db.query(
    `SELECT o.*, c.nome AS cliente_nome, uc.nome AS responsavel_cadastro_nome,
            up.nome AS responsavel_protocolo_nome,
            COUNT(op.id)::int AS produtos_total
       FROM onboardings_contrato o
       LEFT JOIN clientes c ON c.id=o.cliente_id
       LEFT JOIN usuarios uc ON uc.id=o.responsavel_cadastro_id
       LEFT JOIN usuarios up ON up.id=o.responsavel_protocolo_id
       LEFT JOIN onboarding_produtos op ON op.onboarding_id=o.id
      WHERE ${condicoes.join(' AND ')}
      GROUP BY o.id,c.nome,uc.nome,up.nome
      ORDER BY o.criado_em DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  res.json({ ok: true, onboardings: rows, total: totalResult[0].total, page: pagina, limite: lim });
});

onboardingsRouter.get('/:id', async (req, res) => {
  const onboarding = await db.queryOne(
    `SELECT o.*, c.nome AS cliente_nome, uc.nome AS responsavel_cadastro_nome,
            up.nome AS responsavel_protocolo_nome
       FROM onboardings_contrato o
       LEFT JOIN clientes c ON c.id=o.cliente_id
       LEFT JOIN usuarios uc ON uc.id=o.responsavel_cadastro_id
       LEFT JOIN usuarios up ON up.id=o.responsavel_protocolo_id
      WHERE o.id=$1`,
    [req.params.id]
  );
  if (!onboarding) return res.status(404).json({ ok: false, erro: 'Onboarding não encontrado.' });
  if (req.user.perfil !== 'master' && ![onboarding.responsavel_cadastro_id, onboarding.responsavel_protocolo_id].includes(req.user.id)) {
    return res.status(403).json({ ok: false, erro: 'Você não tem acesso a este onboarding.' });
  }
  const produtos = await db.query(
    `SELECT op.*, p.nome AS produto_nome FROM onboarding_produtos op
      JOIN produtos p ON p.id=op.produto_id WHERE op.onboarding_id=$1 ORDER BY p.nome`,
    [onboarding.id]
  );
  res.json({ ok: true, onboarding, produtos });
});

onboardingsRouter.post('/:id/concluir-cadastro', async (req, res) => {
  try {
    const resultado = await concluirCadastroOnboarding({
      onboardingId: req.params.id, dados: req.body, usuario: req.user, ip: req._ip,
    });
    res.json({ ok: true, ...resultado });
  } catch (erro) {
    res.status(erro.status || 500).json({ ok: false, erro: erro.message });
  }
});
