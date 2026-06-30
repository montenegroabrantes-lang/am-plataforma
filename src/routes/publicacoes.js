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

// POST /api/publicacoes/importar — recebe publicações coletadas pelo script local (IP residencial)
publicacoesRouter.post('/importar', async (req, res) => {
  const chaveEnv = process.env.SYNC_KEY || 'am-sync-2026';
  if (req.headers['x-sync-key'] !== chaveEnv) {
    return res.status(401).json({ ok: false, erro: 'Chave inválida.' });
  }

  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.json({ ok: true, inseridas: 0, vinculadas: 0 });
  }

  let inseridas = 0, vinculadas = 0;
  for (const item of items) {
    if (!item.id) continue;

    let processoId = null;
    if (item.numero_processo) {
      const proc = await db.queryOne(
        `SELECT id FROM processos WHERE REGEXP_REPLACE(numero, '[^0-9]', '', 'g') = $1`,
        [item.numero_processo]
      ).catch(() => null);
      if (proc) { processoId = proc.id; vinculadas++; }
    }

    const cancelada = !item.ativo || !!item.data_cancelamento;
    const result = await db.query(
      `INSERT INTO publicacoes
         (id, processo_id, numero_processo_raw, numero_processo, data_disponibilizacao,
          tribunal, tipo_comunicacao, tipo_documento, orgao, texto, link, status, cancelada)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO UPDATE SET
         processo_id = COALESCE(EXCLUDED.processo_id, publicacoes.processo_id),
         cancelada   = EXCLUDED.cancelada, status = EXCLUDED.status
       RETURNING (xmax = 0) AS inserted`,
      [
        item.id, processoId,
        item.numero_processo || '', item.numeroprocessocommascara || null,
        item.data_disponibilizacao,
        item.siglaTribunal || null, item.tipoComunicacao || null,
        item.tipoDocumento || null, item.nomeOrgao || null,
        item.texto || null, item.link || null,
        item.status || null, cancelada,
      ]
    ).catch(() => []);

    if (result[0]?.inserted) inseridas++;
  }

  console.log(`[Comunica/Import] ${inseridas} novas, ${vinculadas} vinculadas (${items.length} recebidas).`);
  res.json({ ok: true, inseridas, vinculadas });
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
