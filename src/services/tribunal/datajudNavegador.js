// Sync do DataJud pelas máquinas do escritório (11/11/2026).
//
// O DataJud recusa (429/timeout) as consultas que saem do Railway, mas responde a computadores no
// Brasil. A extensão "AM — DataJud" (pasta extensao-datajud/ deste repositório), instalada no Chrome das
// máquinas do escritório, pergunta ao AM se há consulta a fazer (GET /tarefa), consulta o DataJud
// pela internet daquela máquina e devolve as respostas brutas (POST /resultado). O AM então roda o
// MESMO sincronizarTodos(), lendo dessas respostas em vez da API (datajud.comTransporte).
//
// Regras:
// - uma tarefa a cada 12 h (conta qualquer execução com processo sincronizado, inclusive a do script
//   do Mac); uma máquina por vez (reserva no Redis por 15 min);
// - só os tribunais fora de DATAJUD_TRIBUNAIS_IGNORADOS (padrão: sem o TJPB, que chega pelo push);
// - o AM só aproveita, de cada resposta, os números que ele mesmo pediu naquela tarefa.
import crypto from 'node:crypto';
import { db } from '../../db/index.js';
import { redis } from '../../cache/redis.js';
import * as datajud from './datajud.js';
import { sincronizarTodos, tribunaisForaDoDatajud } from './sync.js';

const CHAVE_RESERVA = 'datajud:navegador:reserva';
const RESERVA_SEG = 15 * 60;
export const INTERVALO_HORAS = Number(process.env.DATAJUD_NAVEGADOR_INTERVALO_HORAS || 12);

async function ultimaExecucaoComSucesso(banco) {
  const r = await banco.queryOne(
    `SELECT MAX(concluido_em) AS em FROM sync_execucoes WHERE via_datajud > 0 AND concluido_em IS NOT NULL`);
  return r?.em ? new Date(r.em) : null;
}

export async function montarConsultas(banco = db) {
  const fora = tribunaisForaDoDatajud();
  const processos = await banco.query(
    `SELECT numero, tribunal FROM processos WHERE status IN ('ativo', 'suspenso') ORDER BY datajud_atualizado_em ASC NULLS FIRST`);
  const porIndice = new Map();
  for (const p of processos) {
    const tribunal = String(p.tribunal || '').toUpperCase();
    const indice = datajud.INDICE[tribunal];
    const puro = String(p.numero || '').replace(/\D/g, '');
    if (!indice || fora.includes(tribunal) || puro.length !== 20) continue;
    if (!porIndice.has(indice)) porIndice.set(indice, new Set());
    porIndice.get(indice).add(puro);
  }
  const consultas = [];
  for (const [indice, numeros] of porIndice) {
    for (const lote of datajud.dividirEmLotes([...numeros])) {
      consultas.push({ indice, corpo: { size: datajud.TAMANHO_PAGINA, query: { terms: { numeroProcesso: lote } } } });
    }
  }
  return consultas;
}

// Devolve { tarefa: null, motivo } ou { tarefa: { token, base, chave, consultas } }.
export async function gerarTarefa({ banco = db, cache = redis, agora = new Date() } = {}) {
  const ultima = await ultimaExecucaoComSucesso(banco);
  if (ultima && agora - ultima < INTERVALO_HORAS * 3600 * 1000) return { tarefa: null, motivo: 'recente' };
  const consultas = await montarConsultas(banco);
  if (!consultas.length) return { tarefa: null, motivo: 'sem_processos' };
  const token = crypto.randomUUID();
  const pedidos = {};
  for (const c of consultas) (pedidos[c.indice] ||= []).push(...c.corpo.query.terms.numeroProcesso);
  const reservou = await cache.set(CHAVE_RESERVA, JSON.stringify({ token, pedidos }), 'EX', RESERVA_SEG, 'NX');
  if (reservou !== 'OK') return { tarefa: null, motivo: 'em_andamento' };
  return { tarefa: { token, base: datajud.BASE, chave: datajud.API_KEY, consultas } };
}

// Transporte da execução: responde ao sync com o que a extensão trouxe, como se fosse a API.
export function criarTransporte(respostas, pedidos) {
  const porIndice = new Map();
  for (const r of Array.isArray(respostas) ? respostas : []) {
    const indice = String(r?.indice || '');
    const permitidos = new Set(pedidos[indice] || []);
    if (!permitidos.size) continue;
    const atual = porIndice.get(indice) || { ok: true, status: 200, hits: [] };
    const status = Number(r?.status) || null;
    if (!(status >= 200 && status < 300)) { atual.ok = false; atual.status = status; }
    const hits = r?.data?.hits?.hits;
    if (Array.isArray(hits)) {
      for (const h of hits) if (permitidos.has(h?._source?.numeroProcesso)) atual.hits.push(h);
    }
    if (r?.data?.timed_out === true || Number(r?.data?._shards?.failed) > 0) atual.ok = false;
    porIndice.set(indice, atual);
  }
  return {
    async post(indice, corpo) {
      const r = porIndice.get(indice);
      if (!r) return { status: 503, data: null };
      const pedidosAgora = new Set(corpo?.query?.terms?.numeroProcesso || [corpo?.query?.match?.numeroProcesso].filter(Boolean));
      const hits = r.hits.filter(h => pedidosAgora.has(h._source.numeroProcesso));
      if (!r.ok) return { status: r.status || 503, data: hits.length ? { hits: { hits } } : null };
      return { status: 200, data: { hits: { hits, total: { value: hits.length } } } };
    },
  };
}

export async function receberResultado({ token, respostas }, { cache = redis, sincronizar = sincronizarTodos } = {}) {
  const bruto = await cache.get(CHAVE_RESERVA);
  const reserva = bruto ? JSON.parse(bruto) : null;
  if (!reserva || !token || reserva.token !== token) return { aceito: false, motivo: 'tarefa_invalida' };
  await cache.del(CHAVE_RESERVA);
  const transporte = criarTransporte(respostas, reserva.pedidos);
  // Fora da requisição: a resposta à extensão não espera o sync gravar tudo.
  setImmediate(() => {
    datajud.comTransporte(transporte, () => sincronizar())
      .then(r => {
        const lista = Array.isArray(r) ? r : [];
        console.log(`[DataJud navegador] sync concluído: ${lista.filter(x => x.ok).length} ok, ${lista.filter(x => !x.ok).length} falha(s)${r?.ignorado ? ` (ignorado: ${r.motivo})` : ''}`);
      })
      .catch(err => console.warn('[DataJud navegador] sync falhou:', err.message));
  });
  return { aceito: true };
}
