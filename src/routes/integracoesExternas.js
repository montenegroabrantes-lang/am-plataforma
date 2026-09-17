import { Router } from 'express';
import axios from 'axios';
import { autenticarChaveExterna } from './chavesApi.js';
import { registrarAuditoria } from '../middleware/auditoria.js';

export const integracoesExternasRouter = Router();

function camila() {
  const baseURL = process.env.CAMILA_API_URL || process.env.CAMILA_ADMIN_URL;
  const apiKey = process.env.CAMILA_API_KEY;
  return baseURL && apiKey ? axios.create({ baseURL, headers: { 'x-api-key': apiKey }, timeout: 10_000 }) : null;
}

function exigePermissao(permissao) {
  return (req, res, next) => req.integracao?.permissoes?.includes(permissao)
    ? next()
    : res.status(403).json({ ok: false, erro: `Esta chave não possui a permissão “${permissao}”.` });
}

integracoesExternasRouter.use(autenticarChaveExterna);

// Solicita uma mensagem a um contato que já exista na Camila/Digisac.
// O AM não inventa número de telefone nem chama o Digisac diretamente: usa o mesmo endpoint
// de mensagem da Camila já usado pelo painel de Master.
integracoesExternasRouter.post('/v1/camila/leads/:contactId/mensagem', exigePermissao('camila'), async (req, res) => {
  const contactId = String(req.params.contactId || '').trim();
  const mensagem = String(req.body?.mensagem || '').trim();
  if (!/^[a-zA-Z0-9-]{8,100}$/.test(contactId)) return res.status(400).json({ ok: false, erro: 'contactId inválido.' });
  if (mensagem.length < 1 || mensagem.length > 2_000) return res.status(400).json({ ok: false, erro: 'A mensagem deve ter entre 1 e 2.000 caracteres.' });
  const api = camila();
  if (!api) return res.status(503).json({ ok: false, erro: 'Integração com a Camila não configurada.' });
  try {
    const { data } = await api.post(`/api/funil-leads/${encodeURIComponent(contactId)}/mensagem`, {
      mensagem,
      origem: 'integracao_externa',
      chave_integracao_id: req.integracao.id,
    });
    await registrarAuditoria({ acao: 'solicitar_mensagem_camila', entidade: 'chave_api_externa', entidadeId: req.integracao.id, valorDepois: { contact_id: contactId, tamanho_mensagem: mensagem.length }, ip: req._ip });
    res.json(data);
  } catch (err) {
    res.status(err.response?.status || 502).json(err.response?.data || { ok: false, erro: 'Não foi possível solicitar a mensagem à Camila.' });
  }
});

// Solicita uma retomada usando a automação já existente da Camila, sem conteúdo livre.
integracoesExternasRouter.post('/v1/camila/leads/:contactId/reabordar', exigePermissao('camila'), async (req, res) => {
  const contactId = String(req.params.contactId || '').trim();
  if (!/^[a-zA-Z0-9-]{8,100}$/.test(contactId)) return res.status(400).json({ ok: false, erro: 'contactId inválido.' });
  const api = camila();
  if (!api) return res.status(503).json({ ok: false, erro: 'Integração com a Camila não configurada.' });
  try {
    const { data } = await api.post(`/api/funil-leads/${encodeURIComponent(contactId)}/reabordar`, { origem: 'integracao_externa', chave_integracao_id: req.integracao.id });
    await registrarAuditoria({ acao: 'solicitar_reabordagem_camila', entidade: 'chave_api_externa', entidadeId: req.integracao.id, valorDepois: { contact_id: contactId }, ip: req._ip });
    res.json(data);
  } catch (err) {
    res.status(err.response?.status || 502).json(err.response?.data || { ok: false, erro: 'Não foi possível solicitar a reabordagem à Camila.' });
  }
});
