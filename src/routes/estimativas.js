// Aba "Estimativas" — revisão humana das estimativas geradas pela Camila.
// A plataforma não guarda esses dados: atua como proxy autenticado da API da Camila.
// Envs necessárias no Railway: CAMILA_API_URL (ex.: https://camila.up.railway.app)
// e CAMILA_API_KEY (mesmo valor da env AM_API_KEY configurada na Camila).
import { Router } from 'express';
import axios from 'axios';
import { apenasMaster } from '../middleware/auth.js';
import { db } from '../db/index.js';

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

// Controles comerciais: leitura autenticada, alterações reservadas ao perfil master.
for(const [method,local,remote] of [
  ['get','/dashboard','/api/dashboard-leads'],
  ['get','/dashboard/detalhes','/api/dashboard-leads/detalhes'],
  ['get','/leads/:contactId/continuidade','/api/funil-leads/:contactId/continuidade'],
  ['patch','/leads/:contactId/continuidade','/api/funil-leads/:contactId/continuidade'],
  ['patch','/leads/:contactId/documentos/:messageId','/api/funil-leads/:contactId/documentos/:messageId'],
  ['post','/leads/:contactId/liberar-reenvio','/api/funil-leads/:contactId/liberar-reenvio'],
  ['post','/leads/:contactId/confirmar-envio','/api/funil-leads/:contactId/confirmar-envio'],
  ['post','/leads/:contactId/fase-contrato','/api/funil-leads/:contactId/fase-contrato'],
  ['get','/sinteses-aprendizado','/api/sinteses-aprendizado'],
  ['post','/sinteses-aprendizado/:id/decidir','/api/sinteses-aprendizado/:id/decidir'],
  ['get','/continuidade-metricas','/api/continuidade-metricas'],
]) {
  const handler=async(req,res)=>{
    const api=camila();if(!api)return semConfig(res);
    const url=remote.replace(/:([a-zA-Z]+)/g,(_,key)=>encodeURIComponent(req.params[key]));
    try {
      const body={...req.body,registradoPor:req.user?.nome||req.user?.email||String(req.user?.id||''),atualizado_por:req.user?.nome||req.user?.email};
      const {data}=await api.request({method,url,...(method==='get'?{params:req.query}:{data:body})});res.json(data);
    }catch(e){res.status(e.response?.status||502).json({ok:false,erro:e.response?.data?.erro||'Não foi possível consultar a Camila.'});}
  };
  estimativasRouter[method](local,...(method==='get'?[]:[apenasMaster]),handler);
}

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

// Achado real de produção (26/08/2026): a calculadora do site não checa se quem preencheu
// já é cliente antes de criar um lead novo — Beatriz Azevedo (cliente desde 07/08/2026, 1
// processo ativo) simulou de novo e ficou 48h presa na fila de revisão como prospect frio.
// Cadastro de cliente quase nunca tem WhatsApp gravado, então cruzar por telefone não
// funciona — só dá pra comparar por nome. NUNCA bloqueia a submissão nem o lead (nome pode
// colidir por coincidência com pessoa não relacionada) — só sinaliza pro humano decidir.
function normalizarNome(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos
    .toUpperCase()
    .replace(/[^A-Z\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

// Todas as palavras do nome mais curto precisam aparecer no mais longo — "Beatriz Azevedo"
// ⊆ "BEATRIZ AZEVEDO ALVES" bate; um nome de 1 palavra só (genérico demais, ou os achados
// antigos "NOME_PENDENTE"/"valor") nunca compara, pra não gerar falso positivo em massa.
function encontrarClienteExistente(nomeLead, clientes) {
  const palavrasLead = normalizarNome(nomeLead);
  if (palavrasLead.length < 2) return null;
  for (const c of clientes) {
    const palavrasCliente = normalizarNome(c.nome);
    if (palavrasCliente.length < 2) continue;
    const [menor, maior] = palavrasLead.length <= palavrasCliente.length
      ? [palavrasLead, palavrasCliente] : [palavrasCliente, palavrasLead];
    if (menor.every(p => maior.includes(p))) return c;
  }
  return null;
}

// GET /api/estimativas/leads?etapa=&origem=&busca= — precisa vir ANTES de GET /:id, senão
// "/leads" seria capturado pelo parâmetro :id. Repassa para /api/funil-leads na Camila —
// não /api/leads: esse nome já existe lá (métricas de fase de conversa) e ficaria sombreado.
estimativasRouter.get('/leads', async (req, res) => {
  const api = camila();
  if (!api) return semConfig(res);
  try {
    const { data } = await api.get('/api/funil-leads', { params: req.query });
    if (data?.ok && Array.isArray(data.leads) && data.leads.length) {
      // Uma consulta só, comparação inteira em JS — mais barato que 1 query fuzzy por lead,
      // e a tabela de clientes é pequena o bastante (centenas de linhas) pra isso ser rápido.
      const clientes = await db.query(`SELECT nome, criado_em FROM clientes WHERE nome IS NOT NULL`).catch(() => []);
      for (const lead of data.leads) {
        const encontrado = lead.nome ? encontrarClienteExistente(lead.nome, clientes) : null;
        lead.ja_e_cliente = !!encontrado;
        lead.cliente_encontrado = encontrado ? { nome: encontrado.nome, criado_em: encontrado.criado_em } : null;
      }
    }
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

// PATCH /api/estimativas/:id/dados — Master corrige nome/cargo/órgão/período que o lead
// digitou no site. Não refaz a busca de candidato — só o texto exibido na revisão.
estimativasRouter.patch('/:id/dados', apenasMaster, async (req, res) => {
  const api = camila();
  if (!api) return semConfig(res);
  try {
    const { data } = await api.patch(`/api/estimativas/${req.params.id}/dados`, req.body);
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
    const { data } = await api.post(`/api/funil-leads/${req.params.contactId}/desfecho`, {
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
    const { data } = await api.delete(`/api/funil-leads/${req.params.contactId}/desfecho`);
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
    const { data } = await api.post(`/api/funil-leads/${req.params.contactId}/reabordar`, req.body);
    res.json(data);
  } catch (err) {
    res.status(err.response?.status || 502).json(err.response?.data || { ok: false, erro: err.message });
  }
});

// POST /api/estimativas/leads/:contactId/entrega-manual — Master envia a estimativa com o
// próprio texto e o ticket passa ao atendente humano em silêncio (a Camila para de conduzir).
// Alternativa manual à aprovação comum: aprovar manda a Camila entregar e seguir vendendo;
// isto entrega o valor e sai de cena. Só Master, porque dispara mensagem real ao cliente.
estimativasRouter.post('/leads/:contactId/entrega-manual', apenasMaster, async (req, res) => {
  const api = camila();
  if (!api) return semConfig(res);
  try {
    const { data } = await api.post(`/api/funil-leads/${req.params.contactId}/entrega-manual`, {
      ...req.body,
      registradoPor: req.user?.nome || req.user?.email || req.user?.id,
    });
    res.json(data);
  } catch (err) {
    res.status(err.response?.status || 502).json(err.response?.data || { ok: false, erro: err.message });
  }
});

// POST /api/estimativas/leads/:contactId/passar-atendente — Master transfere o ticket em
// silêncio, sem enviar mensagem nem revelar valor nenhum. Diferente de entrega-manual: aqui
// é só a metade da transferência, pra quando o operador quer assumir a conversa sem que a
// Camila (ou o painel) já tenha falado de estimativa.
estimativasRouter.post('/leads/:contactId/passar-atendente', apenasMaster, async (req, res) => {
  const api = camila();
  if (!api) return semConfig(res);
  try {
    const { data } = await api.post(`/api/funil-leads/${req.params.contactId}/passar-atendente`, {
      ...req.body,
      registradoPor: req.user?.nome || req.user?.email || req.user?.id,
    });
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
    const { data } = await api.post(`/api/funil-leads/${req.params.contactId}/mensagem`, req.body);
    res.json(data);
  } catch (err) {
    res.status(err.response?.status || 502).json(err.response?.data || { ok: false, erro: err.message });
  }
});
