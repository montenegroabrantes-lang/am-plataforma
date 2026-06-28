import { Router } from 'express';
import { db }      from '../db/index.js';
import { apenasMaster } from '../middleware/auth.js';

export const classificacoesRouter = Router();

const CATEGORIAS_VALIDAS = ['area_direito', 'fase_processual', 'instancia', 'rito'];

// GET /api/classificacoes — lista todas agrupadas por categoria
classificacoesRouter.get('/', async (req, res) => {
  const rows = await db.query(
    `SELECT id, categoria, nome FROM classificacoes_processuais ORDER BY categoria, nome`
  );
  const resultado = {};
  for (const cat of CATEGORIAS_VALIDAS) resultado[cat] = [];
  for (const r of rows) {
    if (resultado[r.categoria]) resultado[r.categoria].push({ id: r.id, nome: r.nome });
  }
  res.json({ ok: true, classificacoes: resultado });
});

// POST /api/classificacoes — adiciona opção (Master)
classificacoesRouter.post('/', apenasMaster, async (req, res) => {
  const { categoria, nome } = req.body;
  if (!categoria || !nome?.trim()) return res.status(400).json({ ok: false, erro: 'categoria e nome são obrigatórios.' });
  if (!CATEGORIAS_VALIDAS.includes(categoria)) return res.status(400).json({ ok: false, erro: 'Categoria inválida.' });

  const [nova] = await db.query(
    `INSERT INTO classificacoes_processuais (categoria, nome) VALUES ($1, $2)
     ON CONFLICT (categoria, nome) DO NOTHING RETURNING id, categoria, nome`,
    [categoria, nome.trim()]
  );
  if (!nova) return res.status(409).json({ ok: false, erro: 'Opção já existe.' });
  res.status(201).json({ ok: true, item: nova });
});

// DELETE /api/classificacoes/:id — remove opção (Master)
classificacoesRouter.delete('/:id', apenasMaster, async (req, res) => {
  await db.execute(`DELETE FROM classificacoes_processuais WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});
