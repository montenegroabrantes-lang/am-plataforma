import { Router } from 'express';
import { db }      from '../db/index.js';
import { apenasMaster } from '../middleware/auth.js';

export const publicacoesRouter = Router();

// GET /api/publicacoes — lista publicações com filtros
publicacoesRouter.get('/', async (req, res) => {
  const { lido, processo_id, tribunal, page = 1, limite = 50 } = req.query;
  const offset = (Number(page) - 1) * Number(limite);

  const params    = [];
  const condicoes = ['cancelada = false'];

  if (lido === 'true')  condicoes.push('lido = true');
  if (lido === 'false') condicoes.push('lido = false');
  if (processo_id) { params.push(processo_id); condicoes.push(`processo_id = $${params.length}`); }
  if (tribunal)    { params.push(tribunal);    condicoes.push(`tribunal = $${params.length}`); }

  const where = condicoes.join(' AND ');

  const [{ total }] = await db.query(
    `SELECT COUNT(*) AS total FROM publicacoes WHERE ${where}`, params
  );

  params.push(Number(limite), offset);

  const rows = await db.query(
    `SELECT p.*, pr.numero AS processo_numero
     FROM publicacoes p
     LEFT JOIN processos pr ON pr.id = p.processo_id
     WHERE ${where}
     ORDER BY p.data_disponibilizacao DESC, p.id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({ ok: true, publicacoes: rows, total: Number(total) });
});

// GET /api/publicacoes/nao-lidas — contador para badge
publicacoesRouter.get('/nao-lidas', async (req, res) => {
  const [{ total }] = await db.query(
    `SELECT COUNT(*) AS total FROM publicacoes WHERE lido = false AND cancelada = false`
  );
  res.json({ ok: true, total: Number(total) });
});

// PATCH /api/publicacoes/:id/lida — marca como lida
publicacoesRouter.patch('/:id/lida', async (req, res) => {
  await db.execute(
    `UPDATE publicacoes SET lido = true, lido_em = NOW(), lido_por = $1 WHERE id = $2`,
    [req.user.id, req.params.id]
  );
  res.json({ ok: true });
});

// PATCH /api/publicacoes/marcar-todas-lidas — marca todas como lidas
publicacoesRouter.patch('/marcar-todas-lidas', apenasMaster, async (req, res) => {
  const { data } = req.body;
  let where = 'lido = false';
  const params = [req.user.id];
  if (data) { params.push(data); where += ` AND data_disponibilizacao = $${params.length}`; }
  await db.execute(
    `UPDATE publicacoes SET lido = true, lido_em = NOW(), lido_por = $1 WHERE ${where}`,
    params
  );
  res.json({ ok: true });
});

// POST /api/publicacoes/sincronizar — dispara sync manual imediato (Master)
publicacoesRouter.post('/sincronizar', apenasMaster, async (req, res) => {
  try {
    const { db: dbInst }             = await import('../db/index.js');
    const { sincronizarPublicacoes } = await import('../services/tribunal/comunica.js');

    const oabs = await dbInst.query(
      `SELECT chave, valor FROM configuracoes WHERE categoria = 'publicacoes'`
    ).catch(() => []);

    const pares = oabs
      .filter(r => r.chave.startsWith('oab_'))
      .map(r => { const [numero, uf] = r.valor.split(':'); return { numero, uf: uf || 'PB' }; });

    if (pares.length === 0) {
      return res.status(400).json({ ok: false, erro: 'Nenhuma OAB cadastrada em Configurações.' });
    }

    let totalInseridas = 0, totalVinculadas = 0;
    for (const { numero, uf } of pares) {
      const r = await sincronizarPublicacoes(dbInst, numero, uf, 7);
      totalInseridas  += r.inseridas;
      totalVinculadas += r.vinculadas;
    }

    res.json({ ok: true, inseridas: totalInseridas, vinculadas: totalVinculadas });
  } catch (err) {
    res.status(500).json({ ok: false, erro: err.message });
  }
});
