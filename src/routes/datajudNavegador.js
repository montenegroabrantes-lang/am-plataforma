import { Router } from 'express';
import { gerarTarefa, receberResultado } from '../services/tribunal/datajudNavegador.js';

// Usado pela extensão "AM — DataJud" com a sessão de quem está no AM (ver services/tribunal/datajudNavegador.js).
export const datajudNavegadorRouter = Router();

datajudNavegadorRouter.get('/tarefa', async (_req, res) => {
  res.json({ ok: true, ...(await gerarTarefa()) });
});

datajudNavegadorRouter.post('/resultado', async (req, res) => {
  const { token, respostas } = req.body || {};
  const r = await receberResultado({ token, respostas });
  res.status(r.aceito ? 202 : 409).json({ ok: r.aceito, ...r });
});
