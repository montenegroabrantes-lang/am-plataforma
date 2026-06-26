/**
 * DataJud — API Pública do CNJ
 * Consulta dados de processos de todos os tribunais via Elasticsearch.
 * Chave pública disponível em: datajud-wiki.cnj.jus.br
 * Delay de até 72h em relação ao tribunal de origem.
 */
import axios from 'axios';

const BASE    = 'https://api-publica.datajud.cnj.jus.br';
// Chave pública do CNJ — disponível em datajud-wiki.cnj.jus.br.
// Mesmo sendo pública, prefira definir DATAJUD_API_KEY no env para facilitar rotação.
const API_KEY = process.env.DATAJUD_API_KEY ||
                'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';

if (!process.env.DATAJUD_API_KEY) {
  console.warn('[DataJud] DATAJUD_API_KEY não definida — usando chave pública padrão do CNJ.');
}

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
    timeout: 35_000,
    validateStatus: () => true, // nunca lança exceção por status — tratamos manualmente
  });
}

// ─────────────────────────────────────────────
//  CONSULTAR PROCESSO INDIVIDUAL
// ─────────────────────────────────────────────
export async function consultarProcesso(tribunal, numero) {
  const indice = INDICE[tribunal];
  if (!indice) throw new Error(`DataJud: tribunal ${tribunal} não mapeado`);

  const numeroPuro = numero.replace(/\D/g, '');

  // Retry com backoff: DataJud pode retornar 429 (servidor sobrecarregado)
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const resp = await http().post(`/${indice}/_search`, {
      query: { match: { numeroProcesso: numeroPuro } },
      size: 1,
    });

    if (resp.status === 429) {
      if (tentativa < 3) {
        const espera = tentativa * 5_000;
        console.warn(`[DataJud] 429 para ${numero} — aguardando ${espera / 1000}s (tentativa ${tentativa}/3)`);
        await new Promise(r => setTimeout(r, espera));
        continue;
      }
      throw new Error(`DataJud sobrecarregado (429) após 3 tentativas — tente novamente em alguns minutos.`);
    }

    if (resp.status >= 400) throw new Error(`DataJud HTTP ${resp.status} para ${numero}`);

    const hit = resp.data?.hits?.hits?.[0]?._source;
    if (!hit) return null;
    return parsear(hit);
  }
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
//  CONSULTAR PROCESSOS ATUALIZADOS DESDE UMA DATA
//  Retorna Map<numeroPuro, {dados, movimentacoes}>
//  Limita a MAX_PAGINAS para evitar timeout em tribunais grandes (ex: TJPB 302Mi processos).
//  Ordena por dataHoraUltimaAtualizacao para que search_after seja consistente com o filtro.
// ─────────────────────────────────────────────
export async function consultarAtualizados(tribunal, desde, nossosPuro = null) {
  const indice = INDICE[tribunal];
  if (!indice) throw new Error(`DataJud: tribunal ${tribunal} não mapeado`);

  const resultado  = new Map();
  let searchAfter  = null;
  let pagina       = 0;
  const MAX_PAGINAS = 50; // 50 × 1000 = 50.000 processos máx por tribunal por execução

  do {
    const body = {
      size: 1000,
      query: { range: { dataHoraUltimaAtualizacao: { gte: desde } } },
      // Ordenar pelo mesmo campo do filtro — search_after precisa ser consistente
      sort: [{ dataHoraUltimaAtualizacao: { order: 'asc' } }, { numeroProcesso: { order: 'asc' } }],
      ...(searchAfter ? { search_after: searchAfter } : {}),
    };

    const resp = await http().post(`/${indice}/_search`, body);
    if (resp.status === 429) {
      console.warn(`[DataJud] ${tribunal} pág.${pagina + 1}: 429 sobrecarregado — aguardando 10s`);
      await new Promise(r => setTimeout(r, 10_000));
      continue;
    }
    if (resp.status >= 400) throw new Error(`DataJud HTTP ${resp.status} — ${tribunal}`);
    const hits = resp.data?.hits?.hits || [];
    pagina++;

    for (const hit of hits) {
      const src = hit._source;
      if (!src?.numeroProcesso) continue;
      // Se temos o mapa dos nossos processos, filtra imediatamente para economizar memória
      if (nossosPuro && !nossosPuro.has(src.numeroProcesso)) continue;
      resultado.set(src.numeroProcesso, parsear(src));
    }

    console.log(`[DataJud] ${tribunal} pág.${pagina}: ${hits.length} registros (${resultado.size} nossos)`);
    searchAfter = hits.length > 0 ? hits[hits.length - 1].sort : null;

    if (hits.length < 1000) break;
    if (pagina >= MAX_PAGINAS) {
      console.warn(`[DataJud] ${tribunal}: limite de ${MAX_PAGINAS} páginas atingido — próximo sync continua.`);
      break;
    }
  } while (searchAfter);

  return resultado;
}

// ─────────────────────────────────────────────
//  PARSER — _source DataJud → {dados, movimentacoes}
// ─────────────────────────────────────────────
function parsear(src) {
  const vara              = src.orgaoJulgador?.nome   || null;
  const acao              = src.classe?.nome           || null;
  const classe_codigo     = src.classe?.codigo         ? String(src.classe.codigo) : null;
  const grau              = src.grau                   || null;
  const valor_causa       = src.valorCausa             ? Number(src.valorCausa) : null;
  const comarca_ibge      = src.orgaoJulgador?.codigoMunicipioIBGE || null;
  const data_ajuizamento  = src.dataAjuizamento        ? src.dataAjuizamento.substring(0, 10) : null;

  // Assuntos processuais (Resolução 46 CNJ) — usado para ranking de matérias
  const assuntos = (src.assuntos || [])
    .map(a => a.nome).filter(Boolean).join('; ') || null;
  const assunto_principal = (src.assuntos || []).find(a => a.principal)?.nome
    || (src.assuntos || [])[0]?.nome
    || null;

  const partes = src.partes || [];

  const TIPOS_ATIVO   = ['Autor', 'Requerente', 'Reclamante', 'Impetrante', 'Embargante', 'Exequente', 'Apelante'];
  const TIPOS_PASSIVO = ['Réu', 'Requerido', 'Reclamado', 'Impetrado', 'Embargado', 'Executado', 'Apelado'];

  const polo_ativo = partes
    .filter(p =>
      p.polo === 'ATIVO' ||
      TIPOS_ATIVO.includes(p.tipo) ||
      TIPOS_ATIVO.includes(p.tipoParte?.nome)
    )
    .map(p => p.nome).filter(Boolean).join(', ') || null;

  const polo_passivo = partes
    .filter(p =>
      p.polo === 'PASSIVO' ||
      TIPOS_PASSIVO.includes(p.tipo) ||
      TIPOS_PASSIVO.includes(p.tipoParte?.nome)
    )
    .map(p => p.nome).filter(Boolean).join(', ') || null;

  // OABs dos advogados habilitados (todos os polos)
  const habilitados = [];
  for (const parte of partes) {
    for (const adv of (parte.advogados || [])) {
      if (adv.oab) habilitados.push(adv.oab);
    }
  }

  // Movimentações
  // CORREÇÃO: complementosTabelados tem 4 campos:
  //   nome     = texto legível ("Petição Inicial") ← usar este
  //   descricao = rótulo técnico ("tipo_de_peticao") ← NÃO usar como texto
  //   valor    = código numérico (57)
  //   codigo   = código da variável
  const movimentacoes = (src.movimentos || []).map(m => {
    const data = m.dataHora ? m.dataHora.substring(0, 10) : null;

    let texto = m.nome || '';
    const comps = [
      ...(m.complementosTabelados       || []),
      ...(m.complementosExtrasTabelados  || []),
    ].map(c => c.nome).filter(Boolean); // Usa APENAS c.nome — nunca c.descricao
    if (comps.length) texto += ' — ' + comps.join(', ');

    return { data, tipo: m.codigo ? String(m.codigo) : null, texto: texto.trim() };
  }).filter(m => m.texto && m.texto.length >= 5);

  return {
    dados: {
      vara, acao, classe_codigo, grau,
      polo_ativo, polo_passivo, habilitados,
      data_ajuizamento, valor_causa, comarca_ibge,
      assuntos, assunto_principal,
    },
    movimentacoes,
  };
}
