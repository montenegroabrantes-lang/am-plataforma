import { Router } from 'express';
import { db }      from '../db/index.js';

export const classificacoesRouter = Router();

// GET /api/classificacoes — lista todas as opções
classificacoesRouter.get('/', async (req, res) => {
  const rows = await db.query(`SELECT id, nome FROM classificacoes_processuais ORDER BY nome`);
  res.json({ ok: true, opcoes: rows.map(r => r.nome) });
});

// POST /api/classificacoes — adiciona opção nova
classificacoesRouter.post('/', async (req, res) => {
  const { nome } = req.body;
  if (!nome?.trim()) return res.status(400).json({ ok: false, erro: 'nome é obrigatório.' });

  await db.execute(
    `INSERT INTO classificacoes_processuais (nome) VALUES ($1) ON CONFLICT (nome) DO NOTHING`,
    [nome.trim()]
  );
  res.status(201).json({ ok: true });
});
