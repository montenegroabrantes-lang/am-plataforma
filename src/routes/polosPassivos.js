import { Router } from 'express';
import { db }      from '../db/index.js';

export const polosPassivosRouter = Router();

// GET /api/polos-passivos
polosPassivosRouter.get('/', async (_req, res) => {
  const rows = await db.query(`SELECT nome FROM polos_passivos ORDER BY nome ASC`);
  res.json({ ok: true, polos: rows.map(r => r.nome) });
});

// POST /api/polos-passivos
polosPassivosRouter.post('/', async (req, res) => {
  const { nome } = req.body;
  if (!nome?.trim()) return res.status(400).json({ ok: false, erro: 'Nome obrigatório.' });
  if (req.user.perfil !== 'master') return res.status(403).json({ ok: false, erro: 'Acesso negado.' });
  await db.execute(`INSERT INTO polos_passivos (nome) VALUES ($1) ON CONFLICT (nome) DO NOTHING`, [nome.trim()]);
  res.json({ ok: true });
});

// DELETE /api/polos-passivos
polosPassivosRouter.delete('/', async (req, res) => {
  const { nome } = req.body;
  if (!nome?.trim()) return res.status(400).json({ ok: false, erro: 'Nome obrigatório.' });
  if (req.user.perfil !== 'master') return res.status(403).json({ ok: false, erro: 'Acesso negado.' });
  await db.execute(`DELETE FROM polos_passivos WHERE nome = $1`, [nome.trim()]);
  res.json({ ok: true });
});
