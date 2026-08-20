// Aba "Estimativas" — revisão humana das estimativas geradas pela Camila.
// A plataforma não guarda esses dados: atua como proxy autenticado da API da Camila.
// Envs necessárias no Railway: CAMILA_API_URL (ex.: https://camila.up.railway.app)
// e CAMILA_API_KEY (mesmo valor da env AM_API_KEY configurada na Camila).
import { Router } from 'express';
import axios from 'axios';
import { apenasMaster } from '../middleware/auth.js';

export const estimativasRouter = Router();

function camila() {
  const baseURL = process.env.CAMILA_API_URL || process.env.CAMILA_ADMIN_URL;
  const apiKey  = process.env.CAMILA_API_KEY;
  if (!baseURL || !apiKey) return null;
  return axios.create({
    baseURL,
    headers: { 'x-api-key': apiKey },
    timeout: 10_000,
  });
}

const semConfig = res => res.status(503).json({
  ok: false, erro: 'Integração com a Camila não configurada (CAMILA_API_URL / CAMILA_API_KEY).',
});

// GET /api/estimativas — lista (status=pendente|aprovada_entregue|recusada_entregue...)
estimativasRouter.get('/', async (req, res) => {
  const api = camila();
  if (!api) return semConfig(res);
  try {
    const { data } = await api.get('/api/estimativas', { params: req.query });
    res.json(data);
  } catch (err) {
    res.status(502).json({ ok: false, erro: `Camila indisponível: ${err.response?.status || err.message}` });
  }
});

// GET /api/estimativas/leads?etapa=&origem=&busca= — precisa vir ANTES de GET /:id, senão
// "/leads" seria capturado pelo parâmetro :id e a Camila receberia GET /api/estimativas/leads
// (rota errada) em vez de GET /api/leads.
estimativasRouter.get('/leads', async (req, res) => {
  const api = camila();
  if (!api) return semConfig(res);
  try {
    const { data } = await api.get('/api/leads', { params: req.query });
    res.json(data);
  } catch (err) {
    res.status(err.response?.status || 502).json(err.response?.data || { ok: false, erro: err.message });
  }
});

// GET /api/estimativas/:id — detalhe
estimativasRouter.get('/:id', async (req, res) => {
  const api = camila();
  if (!api) return semConfig(res);
  try {
    const { data } = await api.get(`/api/estimativas/${req.params.id}`);
    res.json(data);
  } catch (err) {
    res.status(err.response?.status || 502).json(err.response?.data || { ok: false, erro: err.message });
  }
});

// POST /api/estimativas/:id/aprovar — Master confirma valor final e vínculos escolhidos
estimativasRouter.post('/:id/aprovar', apenasMaster, async (req, res) => {
  const api = camila();
  if (!api) return semConfig(res);
  try {
    const { data } = await api.post(`/api/estimativas/${req.params.id}/aprovar`, {
      ...req.body,
      aprovado_por: req.user?.nome || req.user?.email || req.user?.id,
    });
    res.json(data);
  } catch (err) {
    res.status(err.response?.status || 502).json(err.response?.data || { ok: false, erro: err.message });
  }
});

// POST /api/estimativas/:id/recusar — Master devolve o atendimento à equipe humana
estimativasRouter.post('/:id/recusar', apenasMaster, async (req, res) => {
  const api = camila();
  if (!api) return semConfig(res);
  try {
    const { data } = await api.post(`/api/estimativas/${req.params.id}/recusar`, {
      ...req.body,
      aprovado_por: req.user?.nome || req.user?.email || req.user?.id,
    });
    res.json(data);
  } catch (err) {
    res.status(err.response?.status || 502).json(err.response?.data || { ok: false, erro: err.message });
  }
});

// ── Aba "Leads" — funil consolidado de quem passou pela Camila até o fechamento ──
// Mesmo padrão de proxy acima: a plataforma não guarda nada, só repassa pra Camila.
// (GET /leads está mais acima, antes de GET /:id — ver comentário lá.)

// POST /api/estimativas/leads/:contactId/desfecho — Master marca fechado ou perdido
estimativasRouter.post('/leads/:contactId/desfecho', apenasMaster, async (req, res) => {
  const api = camila();
  if (!api) return semConfig(res);
  try {
    const { data } = await api.post(`/api/leads/${req.params.contactId}/desfecho`, {
      ...req.body,
      registradoPor: req.user?.nome || req.user?.email || req.user?.id,
    });
    res.json(data);
  } catch (err) {
    res.status(err.response?.status || 502).json(err.response?.data || { ok: false, erro: err.message });
  }
});

// DELETE /api/estimativas/leads/:contactId/desfecho — desfazer um desfecho marcado por engano
estimativasRouter.delete('/leads/:contactId/desfecho', apenasMaster, async (req, res) => {
  const api = camila();
  if (!api) return semConfig(res);
  try {
    const { data } = await api.delete(`/api/leads/${req.params.contactId}/desfecho`);
    res.json(data);
  } catch (err) {
    res.status(err.response?.status || 502).json(err.response?.data || { ok: false, erro: err.message });
  }
});

// POST /api/estimativas/leads/:contactId/reabordar — Master dispara retomada imediata
estimativasRouter.post('/leads/:contactId/reabordar', apenasMaster, async (req, res) => {
  const api = camila();
  if (!api) return semConfig(res);
  try {
    const { data } = await api.post(`/api/leads/${req.params.contactId}/reabordar`, req.body);
    res.json(data);
  } catch (err) {
    res.status(err.response?.status || 502).json(err.response?.data || { ok: false, erro: err.message });
  }
});

// POST /api/estimativas/leads/:contactId/mensagem — Master manda mensagem livre pelo ticket
estimativasRouter.post('/leads/:contactId/mensagem', apenasMaster, async (req, res) => {
  const api = camila();
  if (!api) return semConfig(res);
  try {
    const { data } = await api.post(`/api/leads/${req.params.contactId}/mensagem`, req.body);
    res.json(data);
  } catch (err) {
    res.status(err.response?.status || 502).json(err.response?.data || { ok: false, erro: err.message });
  }
});
