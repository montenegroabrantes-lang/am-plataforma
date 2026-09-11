// Aba "Estimativas" — revisão humana das estimativas geradas pela Camila.
// A plataforma não guarda esses dados: atua como proxy autenticado da API da Camila.
// Envs necessárias no Railway: CAMILA_API_URL (ex.: https://camila.up.railway.app)
// e CAMILA_API_KEY (mesmo valor da env AM_API_KEY configurada na Camila).
import { Router } from 'express';
import axios from 'axios';
import rateLimit from 'express-rate-limit';
import { apenasMaster } from '../middleware/auth.js';
import { db } from '../db/index.js';
import {
  criarOnboardingContrato,
  marcarSincronizacaoCamila,
  buscarOnboardingPorContato,
  cancelarOnboardingPendente,
} from '../services/onboarding.js';
import {
  buscarReferenciaEstadual,
  ReferenciaEstadualError,
} from '../services/remuneracaoEstadual.js';

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

const TIMEOUT_CALCULADORA_MANUAL_MS = 90_000;
const referenciaEstadualLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, erro: 'Limite de consultas oficiais atingido. Aguarde alguns minutos.' },
});

// Controles comerciais: leitura autenticada, alterações reservadas ao perfil master.
for(const [method,local,remote] of [
  ['get','/dashboard','/api/dashboard-leads'],
  ['get','/dashboard/detalhes','/api/dashboard-leads/detalhes'],
  ['get','/reabordagens/status','/api/reabordagens/status'],
  ['get','/aprendizado-automatico','/api/aprendizado-automatico'],
  ['post','/aprendizado-automatico/configuracao','/api/aprendizado-automatico/configuracao'],
  ['post','/aprendizado-automatico/:codigo/desativar','/api/aprendizado-automatico/:codigo/desativar'],
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

// POST /api/estimativas/manual — Master cadastra uma simulação interna para revisão.
// A busca de candidatos na Camila consulta fontes externas e pode levar mais que o timeout
// padrão do proxy. Este endpoint apenas cria a pendência; o envio continua dependendo da
// aprovação na tela de Estimativas.
estimativasRouter.post('/manual', apenasMaster, async (req, res) => {
  const api = camila();
  if (!api) return semConfig(res);

  const { nome, telefone, cargo, orgao, inicio, fim, autorizacao_contato } = req.body || {};
  const criadoPor = req.user?.nome || req.user?.email || req.user?.id;

  try {
    const resposta = await api.post('/api/estimativas/manual', {
      nome,
      telefone,
      cargo,
      orgao,
      inicio,
      fim,
      autorizacao_contato,
      criado_por: criadoPor,
    }, { timeout: TIMEOUT_CALCULADORA_MANUAL_MS });

    res.status(resposta.status).json(resposta.data);
  } catch (err) {
    if (err.response) {
      return res.status(err.response.status).json(
        err.response.data || { ok: false, erro: 'A Camila recusou a criação da estimativa.' }
      );
    }

    const expirou = err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT';
    res.status(expirou ? 504 : 502).json({
      ok: false,
      erro: expirou
        ? 'A busca de candidatos excedeu o tempo limite. Tente novamente.'
        : 'Não foi possível criar a estimativa na Camila.',
    });
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
      const clientes = await db.query(`SELECT id, nome, criado_em FROM clientes WHERE nome IS NOT NULL AND ativo=true`).catch(() => []);
      const contactIds = data.leads.map(l => String(l.contact_id || '')).filter(Boolean);
      const onboardings = contactIds.length
        ? await db.query(
            `SELECT id, camila_contact_id, cliente_id, status, prazo_cadastro, prazo_protocolo,
                    camila_sync_status, drive_sync_status
               FROM onboardings_contrato WHERE camila_contact_id = ANY($1::text[])`,
            [contactIds]
          ).catch(() => [])
        : [];
      const onboardingPorContato = new Map(onboardings.map(o => [o.camila_contact_id, o]));
      for (const lead of data.leads) {
        const encontrado = lead.nome ? encontrarClienteExistente(lead.nome, clientes) : null;
        lead.ja_e_cliente = !!encontrado;
        lead.cliente_encontrado = encontrado ? { id: encontrado.id, nome: encontrado.nome, criado_em: encontrado.criado_em } : null;
        lead.onboarding = onboardingPorContato.get(String(lead.contact_id)) || null;
      }
    }
    res.json(data);
  } catch (err) {
    res.status(err.response?.status || 502).json(err.response?.data || { ok: false, erro: err.message });
  }
});

// GET /api/estimativas/:id/referencia-estadual — consulta, sob demanda, a folha oficial
// da Paraíba ou de Pernambuco nos últimos cinco anos. O navegador não envia nome/órgão
// na URL: buscamos o detalhe atualizado na Camila, reduzindo exposição de dados e evitando
// divergência entre o card e a consulta. O resultado é somente uma referência; esta rota
// nunca aprova a estimativa nem grava o valor na Camila.
estimativasRouter.get('/:id/referencia-estadual', apenasMaster, referenciaEstadualLimiter, async (req, res) => {
  const api = camila();
  if (!api) return semConfig(res);

  try {
    const { data: detalhe } = await api.get(`/api/estimativas/${encodeURIComponent(req.params.id)}`);
    const estimativa = detalhe?.estimativa || detalhe;
    const dados = estimativa?.dados || estimativa?.dados_extraidos || {};
    const resultado = await buscarReferenciaEstadual({
      nome: dados.nome,
      cargo: dados.cargo,
      orgao: dados.orgao,
      inicio: dados.periodoInicio || dados.inicio,
      fim: dados.periodoFim || dados.fim,
      forcar: req.query.atualizar === '1',
    });
    res.json(resultado);
  } catch (err) {
    if (err instanceof ReferenciaEstadualError) {
      return res.status(err.status).json({ ok: false, codigo: err.codigo, erro: err.message });
    }
    if (err.response) {
      return res.status(err.response.status).json(
        err.response.data || { ok: false, erro: 'Não foi possível obter os dados da estimativa.' }
      );
    }
    res.status(502).json({ ok: false, erro: 'Não foi possível consultar a fonte oficial agora.' });
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

// POST /api/estimativas/:id/retomar-entrega — Master devolve à fila uma entrega interrompida.
estimativasRouter.post('/:id/retomar-entrega', apenasMaster, async (req, res) => {
  const api = camila();
  if (!api) return semConfig(res);

  try {
    const resposta = await api.post(`/api/estimativas/${encodeURIComponent(req.params.id)}/retomar-entrega`, {
      ...req.body,
      registradoPor: req.user?.nome || req.user?.email || req.user?.id,
    });
    res.status(resposta.status).json(resposta.data);
  } catch (err) {
    if (err.response) {
      return res.status(err.response.status).json(
        err.response.data || { ok: false, erro: 'A Camila recusou a retomada da entrega.' }
      );
    }
    res.status(502).json({ ok: false, erro: 'Não foi possível retomar a entrega na Camila.' });
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

// POST /api/estimativas/:id/restaurar-descarte — volta à revisão com a automação pausada
estimativasRouter.post('/:id/restaurar-descarte', apenasMaster, async (req, res) => {
  const api = camila();
  if (!api) return semConfig(res);
  try {
    const { data } = await api.post(`/api/estimativas/${req.params.id}/restaurar-descarte`, {
      registrado_por: req.user?.nome || req.user?.email || req.user?.id,
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

  const { onboarding, ...desfecho } = req.body || {};

  // Fechamento é o gatilho do trabalho jurídico. Primeiro registramos localmente de forma
  // idempotente; a Camila é sincronizada em seguida. Assim uma indisponibilidade externa
  // não faz o escritório perder o onboarding já confirmado.
  if (desfecho.desfecho === 'fechado') {
    let registro;
    try {
      registro = await criarOnboardingContrato({
        contactId: req.params.contactId,
        lead: {
          estimativa_id: onboarding?.estimativa_id,
          nome: onboarding?.nome,
          telefone: onboarding?.telefone,
          cargo: onboarding?.cargo,
          orgao: onboarding?.orgao,
          valor: desfecho.valorFechado,
        },
        onboarding,
        usuarioId: req.user.id,
        ip: req._ip,
      });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, erro: err.message, detalhes: err.detalhes });
    }

    try {
      const { data } = await api.post(`/api/funil-leads/${req.params.contactId}/desfecho`, {
        ...desfecho,
        registradoPor: req.user?.nome || req.user?.email || req.user?.id,
      });
      await marcarSincronizacaoCamila(registro.id, true);
      return res.json({ ...data, onboarding: { ...registro, camila_sync_status: 'sincronizado' } });
    } catch (err) {
      await marcarSincronizacaoCamila(registro.id, false, err.response?.data?.erro || err.message);
      return res.status(202).json({
        ok: true,
        aviso: 'Onboarding criado. A Camila está indisponível e a sincronização ficou pendente.',
        onboarding: { ...registro, camila_sync_status: 'erro' },
      });
    }
  }

  try {
    const { data } = await api.post(`/api/funil-leads/${req.params.contactId}/desfecho`, {
      ...desfecho,
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
    const onboarding = await buscarOnboardingPorContato(req.params.contactId);
    if (onboarding && (onboarding.status !== 'cadastro_pendente' || onboarding.cliente_id)) {
      return res.status(409).json({
        ok: false,
        erro: 'O onboarding já avançou. Revise as tarefas e os vínculos antes de desfazer o fechamento.',
      });
    }
    const { data } = await api.delete(`/api/funil-leads/${req.params.contactId}/desfecho`);
    if (onboarding) await cancelarOnboardingPendente(req.params.contactId, req.user.id, req._ip);
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
