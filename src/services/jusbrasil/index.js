/**
 * JusBrasil API — Monitoramento Processual
 * Base URL: https://op.digesto.com.br/api
 * Auth: Bearer token via JUSBRASIL_API_TOKEN
 * Docs: https://api.jusbrasil.com.br/docs
 */
import axios from 'axios';

const BASE  = 'https://op.digesto.com.br/api';
const TOKEN = process.env.JUSBRASIL_API_TOKEN;

if (!TOKEN) {
  console.warn('[JusBrasil] JUSBRASIL_API_TOKEN não definida — integração desativada.');
}

function http() {
  if (!TOKEN) throw new Error('JUSBRASIL_API_TOKEN não configurada.');
  return axios.create({
    baseURL: BASE,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    timeout: 30_000,
  });
}

// ─── MONITORAMENTO ────────────────────────────────────────────────────────────

export async function registrarProcesso(numero) {
  const resp = await http().post('/monitoramento/proc', {
    numero,
    is_monitored_tribunal: true,
    is_monitored_diario:   false,
  });
  return resp.data;
}

// Registra vários processos com throttle para não estourar rate limit
export async function registrarLote(numeros) {
  const resultados = [];
  for (const numero of numeros) {
    try {
      const r = await registrarProcesso(numero);
      resultados.push({ numero, ok: true, id: r.$uri });
      console.log(`[JusBrasil] Registrado: ${numero}`);
    } catch (err) {
      const status = err.response?.status;
      // 409 = já monitorado — não é erro real
      if (status === 409) {
        resultados.push({ numero, ok: true, ja_monitorado: true });
      } else {
        resultados.push({ numero, ok: false, erro: err.message });
        console.warn(`[JusBrasil] Falha ao registrar ${numero}:`, err.message);
      }
    }
    await new Promise(r => setTimeout(r, 150)); // ~6 req/s
  }
  return resultados;
}

// ─── WEBHOOK ──────────────────────────────────────────────────────────────────

export async function configurarWebhook(url) {
  const resp = await http().post('/admin/user_company/current_webhook_config', {
    url,
    is_global_active: true,
    api_version: 6,
  });
  return resp.data;
}

export async function buscarConfigWebhook() {
  const resp = await http().get('/admin/user_company/current_webhook_config');
  return resp.data;
}

// ─── PARSER DO PAYLOAD WEBHOOK ────────────────────────────────────────────────

/**
 * Normaliza o número CNJ recebido do JusBrasil para o formato do banco.
 * JusBrasil pode enviar com ou sem formatação.
 * Formato banco: 0283189-64.2012.8.19.0001
 */
export function normalizarNumero(numero) {
  const digits = String(numero || '').replace(/\D/g, '');
  if (digits.length === 20) {
    return `${digits.slice(0,7)}-${digits.slice(7,9)}.${digits.slice(9,13)}.${digits.slice(13,14)}.${digits.slice(14,16)}.${digits.slice(16,20)}`;
  }
  return numero; // devolve como veio
}

/**
 * Transforma o payload de movimentações do JusBrasil (evt_type=1)
 * no formato { data, tipo, texto } usado por salvarResultadoSync.
 * Estrutura: [data_str, texto_principal, complemento, null, id, tipos, instancia]
 */
export function parsearMovimentacoes(data) {
  if (!Array.isArray(data)) return [];
  return data
    .map(mov => {
      if (!Array.isArray(mov) || !mov[0]) return null;
      const texto = [mov[1], mov[2]].filter(Boolean).join(' — ').trim();
      return {
        data:  mov[0],               // YYYY-MM-DD
        tipo:  mov[4] ? String(mov[4]) : null,
        texto,
      };
    })
    .filter(Boolean);
}

/**
 * Extrai dados de capa do payload de capa (evt_type=7).
 * Retorna campos compatíveis com salvarResultadoSync.
 */
export function parsearCapa(data) {
  const novo = data?.new || data;
  if (!novo) return {};

  const partes   = novo.partes || [];
  const ATIVOS   = ['Autor','Requerente','Reclamante','Impetrante','Embargante','Exequente','Apelante'];
  const PASSIVOS = ['Réu','Requerido','Reclamado','Impetrado','Embargado','Executado','Apelado'];

  const polo_ativo   = partes.filter(p => p.polo === 'ATIVO'   || ATIVOS.includes(p.tipo))
                              .map(p => p.nome).filter(Boolean).join(', ') || null;
  const polo_passivo = partes.filter(p => p.polo === 'PASSIVO' || PASSIVOS.includes(p.tipo))
                              .map(p => p.nome).filter(Boolean).join(', ') || null;

  const advs = partes.flatMap(p => p.advogados || []);
  const habilitados = advs.map(a => a.oab).filter(Boolean);

  return {
    vara:              novo.orgaoJulgador?.nome || novo.vara || null,
    acao:              novo.classe?.nome        || novo.classe || null,
    polo_ativo,
    polo_passivo,
    habilitados,
    data_ajuizamento:  novo.dataAjuizamento     || null,
  };
}
