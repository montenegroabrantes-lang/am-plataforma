/**
 * DataJud — API Pública do CNJ
 * Consulta dados de processos de todos os tribunais via Elasticsearch.
 * Chave pública disponível em: datajud-wiki.cnj.jus.br
 * Delay de até 72h em relação ao tribunal de origem.
 */
import axios from 'axios';

const BASE    = 'https://api-publica.datajud.cnj.jus.br';
const API_KEY = process.env.DATAJUD_API_KEY ||
                'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';

// Mapeamento tribunal → índice DataJud
const INDICE = {
  TJPB: 'api_publica_tjpb',
  TJRN: 'api_publica_tjrn',
  TJPE: 'api_publica_tjpe',
  TJAL: 'api_publica_tjal',
  TJBA: 'api_publica_tjba',
  TJCE: 'api_publica_tjce',
  TJMA: 'api_publica_tjma',
  TJPI: 'api_publica_tjpi',
  TJSE: 'api_publica_tjse',
  TRF1: 'api_publica_trf1',
  TRF3: 'api_publica_trf3',
  TRF4: 'api_publica_trf4',
  TRF5: 'api_publica_trf5',
  TRF6: 'api_publica_trf6',
};

function http() {
  return axios.create({
    baseURL: BASE,
    headers: {
      Authorization: `APIKey ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    timeout: 15_000,
  });
}

// ─────────────────────────────────────────────
//  CONSULTAR PROCESSO INDIVIDUAL
// ─────────────────────────────────────────────
export async function consultarProcesso(tribunal, numero) {
  const indice = INDICE[tribunal];
  if (!indice) throw new Error(`DataJud: tribunal ${tribunal} não mapeado`);

  const resp = await http().post(`/${indice}/_search`, {
    query: { match: { numeroProcesso: numero } },
    size: 1,
  });

  const hit = resp.data?.hits?.hits?.[0]?._source;
  if (!hit) return null;

  return parsear(hit);
}

// ─────────────────────────────────────────────
//  CONSULTAR EM LOTE (concorrência limitada a 10)
//  Retorna Map<numero, {dados, movimentacoes}>
//  Processos não encontrados ficam ausentes do Map.
// ─────────────────────────────────────────────
export async function consultarLote(tribunal, numeros) {
  const CONC = 10;
  const resultado = new Map();

  for (let i = 0; i < numeros.length; i += CONC) {
    const lote = numeros.slice(i, i + CONC);
    await Promise.all(lote.map(async (numero) => {
      try {
        const r = await consultarProcesso(tribunal, numero);
        if (r) resultado.set(numero, r);
      } catch (err) {
        console.warn(`[DataJud] ${numero}:`, err.message);
      }
    }));
  }

  return resultado;
}

// ─────────────────────────────────────────────
//  PARSER — _source DataJud → {dados, movimentacoes}
// ─────────────────────────────────────────────
function parsear(src) {
  const vara = src.orgaoJulgador?.nome || null;
  const acao = src.classe?.nome       || null;

  const partes = src.partes || [];

  const TIPOS_ATIVO   = ['Autor', 'Requerente', 'Reclamante', 'Impetrante', 'Embargante', 'Exequente', 'Apelante'];
  const TIPOS_PASSIVO = ['Réu', 'Requerido', 'Reclamado', 'Impetrado', 'Embargado', 'Executado', 'Apelado'];

  const polo_ativo   = partes.filter(p => TIPOS_ATIVO.includes(p.tipo)).map(p => p.nome).filter(Boolean).join(', ') || null;
  const polo_passivo = partes.filter(p => TIPOS_PASSIVO.includes(p.tipo)).map(p => p.nome).filter(Boolean).join(', ') || null;

  // OABs dos advogados habilitados (todos os polos)
  const habilitados = [];
  for (const parte of partes) {
    for (const adv of (parte.advogados || [])) {
      if (adv.oab) habilitados.push(adv.oab);
    }
  }

  // Movimentações
  const movimentacoes = (src.movimentos || []).map(m => {
    const data = m.dataHora ? m.dataHora.substring(0, 10) : null;

    let texto = m.nome || '';
    const comps = [
      ...(m.complementosTabelados      || []),
      ...(m.complementosExtrasTabelados || []),
    ].map(c => c.descricao ? `${c.descricao}: ${c.valor || ''}` : (c.valor || '')).filter(Boolean);
    if (comps.length) texto += ' — ' + comps.join(' | ');

    return { data, tipo: m.codigo ? String(m.codigo) : null, texto: texto.trim() };
  }).filter(m => m.texto && m.texto.length >= 5);

  return {
    dados: { vara, acao, polo_ativo, polo_passivo, habilitados },
    movimentacoes,
  };
}
