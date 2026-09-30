import { Router } from 'express';
import { buscarClienteParaCamila } from '../services/clienteCamila.js';
import { mesmaChave } from '../utils/seguranca.js';

export const integracaoCamilaRouter = Router();

export function autenticarIntegracaoCamila(req, res, next) {
  const esperada = process.env.CAMILA_CLIENT_LOOKUP_API_KEY || process.env.CAMILA_API_KEY;
  if (!mesmaChave(req.get('x-api-key'), esperada)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado.' });
  }
  next();
}

integracaoCamilaRouter.get('/cliente', async (req, res) => {
  const telefone = String(req.query.telefone || '').trim();
  const nome = String(req.query.nome || '').trim();
  if (!telefone && !nome) {
    return res.status(400).json({ ok: false, erro: 'Informe telefone ou nome.' });
  }

  const cliente = await buscarClienteParaCamila({ telefone, nome });
  res.json(cliente
    ? { ok: true, encontrado: true, cliente }
    : { ok: true, encontrado: false });
});
