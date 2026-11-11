import { Router } from 'express';
import { buscarClienteParaCamila } from '../services/clienteCamila.js';
import { mesmaChave } from '../utils/seguranca.js';
import { consultarProcessoParaCamila, identificarClienteParaCamila } from '../services/consultaProcessualCamila.js';

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

// Consulta processual automática (11/11/2026): texto pronto, sem IA e sem valores, do processo
// ativo mais antigo do cliente (ou do número que ele indicou). encaminhar=true → equipe jurídica.
integracaoCamilaRouter.get('/processo', async (req, res) => {
  const contactId = String(req.query.contactId || '').trim();
  const telefone = String(req.query.telefone || '').trim();
  const numero = String(req.query.numero || '').trim();
  if (!contactId && !telefone) return res.status(400).json({ ok: false, erro: 'Informe contactId ou telefone.' });
  res.json({ ok: true, ...(await consultarProcessoParaCamila({ contactId, telefone, numero })) });
});

// Identificação pelo nome completo + CPF quando o contato ainda não está na ficha. Se conferir,
// grava o contato do Digisac/WhatsApp na ficha (só campos vazios) e já devolve a consulta.
integracaoCamilaRouter.post('/identificar', async (req, res) => {
  const { cpf, nome, contactId, telefone, numero } = req.body || {};
  if (!cpf || !nome) return res.status(400).json({ ok: false, erro: 'Informe nome e CPF.' });
  res.json({ ok: true, ...(await identificarClienteParaCamila({ cpf, nome, contactId, telefone, numero })) });
});
