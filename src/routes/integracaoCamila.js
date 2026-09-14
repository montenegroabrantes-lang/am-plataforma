import { Router } from 'express';
import crypto from 'crypto';
import { buscarClienteParaCamila } from '../services/clienteCamila.js';

export const integracaoCamilaRouter = Router();

function mesmaChave(recebida, esperada) {
  if (!recebida || !esperada) return false;
  const a = Buffer.from(String(recebida));
  const b = Buffer.from(String(esperada));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

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
