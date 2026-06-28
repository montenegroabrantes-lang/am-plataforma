import { Router } from 'express';
import { db }      from '../db/index.js';
import { apenasMaster } from '../middleware/auth.js';

export const classificacoesRouter = Router();

// GET /api/classif — retorna todos os campos com suas opções
classificacoesRouter.get('/', async (req, res) => {
  const campos = await db.query(`SELECT id, nome FROM classif_campos ORDER BY criado_em`);
  const opcoes = await db.query(`SELECT id, campo_id, nome FROM classif_opcoes ORDER BY nome`);
  const resultado = campos.map(c => ({
    ...c,
    opcoes: opcoes.filter(o => o.campo_id === c.id).map(o => ({ id: o.id, nome: o.nome })),
  }));
  res.json({ ok: true, campos: resultado });
});

// POST /api/classif/campos — cria novo campo (Master)
classificacoesRouter.post('/campos', apenasMaster, async (req, res) => {
  const { nome } = req.body;
  if (!nome?.trim()) return res.status(400).json({ ok: false, erro: 'nome é obrigatório.' });
  const [novo] = await db.query(
    `INSERT INTO classif_campos (nome) VALUES ($1) ON CONFLICT (nome) DO NOTHING RETURNING id, nome`,
    [nome.trim()]
  );
  if (!novo) return res.status(409).json({ ok: false, erro: 'Campo já existe.' });
  res.status(201).json({ ok: true, campo: { ...novo, opcoes: [] } });
});

// DELETE /api/classif/campos/:id — remove campo e seus dados (Master)
classificacoesRouter.delete('/campos/:id', apenasMaster, async (req, res) => {
  await db.execute(`DELETE FROM classif_campos WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

// POST /api/classif/campos/:id/opcoes — adiciona opção ao campo
classificacoesRouter.post('/campos/:id/opcoes', async (req, res) => {
  const { nome } = req.body;
  if (!nome?.trim()) return res.status(400).json({ ok: false, erro: 'nome é obrigatório.' });
  await db.execute(
    `INSERT INTO classif_opcoes (campo_id, nome) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [req.params.id, nome.trim()]
  );
  res.status(201).json({ ok: true });
});

// PATCH /api/classif/processo/:processoId — salva valor de um campo para um processo
classificacoesRouter.patch('/processo/:processoId', async (req, res) => {
  const { campo_id, valor } = req.body;
  if (!campo_id) return res.status(400).json({ ok: false, erro: 'campo_id é obrigatório.' });
  await db.execute(
    `INSERT INTO processo_classif (processo_id, campo_id, valor)
     VALUES ($1, $2, $3)
     ON CONFLICT (processo_id, campo_id) DO UPDATE SET valor = EXCLUDED.valor`,
    [req.params.processoId, campo_id, valor || null]
  );
  res.json({ ok: true });
});

// GET /api/classif/processo/:processoId — retorna valores do processo
classificacoesRouter.get('/processo/:processoId', async (req, res) => {
  const rows = await db.query(
    `SELECT campo_id, valor FROM processo_classif WHERE processo_id = $1`,
    [req.params.processoId]
  );
  res.json({ ok: true, valores: rows });
});
