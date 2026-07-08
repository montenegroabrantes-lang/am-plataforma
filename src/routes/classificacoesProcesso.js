import { Router } from 'express';
import { db }      from '../db/index.js';

// Classificação processual "estática" — lista simples de rótulos livres (ex: "Previdenciário"),
// usada no campo `processos.classificacao`. Não confundir com /api/classif (campos custom
// de múltiplas categorias usados em outras telas).
export const classificacoesProcessoRouter = Router();

// GET /api/classificacoes — lista de opções (flat) para o select da aba Dados do processo
classificacoesProcessoRouter.get('/', async (req, res) => {
  const rows = await db.query(
    `SELECT nome FROM classificacoes_processuais ORDER BY nome`
  );
  res.json({ ok: true, opcoes: rows.map(r => r.nome) });
});

// POST /api/classificacoes — cria nova opção (Master ou não, mesma regra de acesso do processo)
classificacoesProcessoRouter.post('/', async (req, res) => {
  const { nome } = req.body;
  if (!nome?.trim()) return res.status(400).json({ ok: false, erro: 'nome é obrigatório.' });

  await db.query(
    `INSERT INTO classificacoes_processuais (nome) VALUES ($1)
     ON CONFLICT (nome) DO NOTHING`,
    [nome.trim()]
  ).catch(() => {});

  res.status(201).json({ ok: true, nome: nome.trim() });
});
