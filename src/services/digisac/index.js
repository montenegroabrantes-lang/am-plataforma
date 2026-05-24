import axios from 'axios';
import { db } from '../../db/index.js';
import { decrypt } from '../../utils/crypto.js';

function client() {
  const token = process.env.DIGISAC_TOKEN;
  if (!token || token === 'configurar_no_railway') return null;

  return axios.create({
    baseURL: `${process.env.DIGISAC_API_URL}/v1`,
    headers: { Authorization: `Bearer ${token}` },
    timeout: 15_000,
  });
}

// Busca atendimentos recentes (últimas 24h por padrão)
export async function buscarAtendimentos(horas = 24) {
  const api = client();
  if (!api) return [];

  const desde = new Date(Date.now() - horas * 3600 * 1000).toISOString();

  try {
    const resp = await api.get('/tickets', {
      params: { updatedAfter: desde, limit: 100 },
    });
    return resp.data?.data || resp.data || [];
  } catch (err) {
    console.error('[Digisac] Erro ao buscar atendimentos:', err.message);
    return [];
  }
}

// Busca mensagens de um atendimento específico (para painel lateral)
export async function buscarMensagens(ticketId, limite = 20) {
  const api = client();
  if (!api) return [];

  try {
    const resp = await api.get(`/tickets/${ticketId}/messages`, {
      params: { limit: limite },
    });
    return resp.data?.data || resp.data || [];
  } catch (err) {
    console.error('[Digisac] Erro ao buscar mensagens:', err.message);
    return [];
  }
}

// Salva eventos Digisac no banco (cache local)
export async function sincronizarEventosSAC() {
  const atendimentos = await buscarAtendimentos(48);

  let salvos = 0;
  for (const ticket of atendimentos) {
    const tipo = classificarTipo(ticket);

    // Tenta associar a um lead ou cliente pelo WhatsApp
    const contato = ticket.contact?.phone?.replace(/\D/g, '');
    const lead    = contato ? await db.queryOne(
      `SELECT id FROM leads WHERE REPLACE(whatsapp, '+','') LIKE '%' || $1`, [contato.slice(-9)]
    ) : null;

    try {
      await db.execute(
        `INSERT INTO eventos_sac (tipo, lead_id, payload, criado_em)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [tipo, lead?.id || null, JSON.stringify(ticket), new Date(ticket.updatedAt || ticket.createdAt)]
      );
      salvos++;
    } catch { /* ignora duplicata */ }
  }

  return salvos;
}

function classificarTipo(ticket) {
  const status = ticket.status?.toLowerCase() || '';
  const tags   = (ticket.tags || []).map(t => t.toLowerCase());

  if (tags.includes('proposta') || tags.includes('proposta_enviada')) return 'proposta_enviada';
  if (tags.includes('doc') || tags.includes('documento'))             return 'doc_recebido';
  if (tags.includes('qualificado') || tags.includes('lead'))          return 'lead_qualificado';
  if (status === 'resolved' || status === 'closed')                   return 'atendimento';
  return 'atendimento';
}
