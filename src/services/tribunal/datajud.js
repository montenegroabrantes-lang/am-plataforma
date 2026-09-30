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

// Ponto único de saída HTTP e de espera: os testes trocam os dois por dublês (nenhuma rede, nenhum
// atraso real). Em produção, `post` é a chamada à API pública e `esperar` é um setTimeout.
export const transporte = {
  post(indice, body) { return http().post(`/${indice}/_search`, body); },
  esperar(ms)        { return new Promise(r => setTimeout(r, ms)); },
};

// ─────────────────────────────────────────────
//  CONSULTAR PROCESSO INDIVIDUAL
// ─────────────────────────────────────────────
export async function consultarProcesso(tribunal, numero) {
  const indice = INDICE[tribunal];
  if (!indice) throw new Error(`DataJud: tribunal ${tribunal} não mapeado`);

  const numeroPuro = numero.replace(/\D/g, '');

  // Retry com backoff: DataJud pode retornar 429 (servidor sobrecarregado)
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const resp = await transporte.post(indice, {
      query: { match: { numeroProcesso: numeroPuro } },
      size: 1,
    });

    // DataJud frequentemente retorna 429 mas ainda inclui os dados no body — aproveitar
    const hit = resp.data?.hits?.hits?.[0]?._source;
    if (hit) return parsear(hit);

    if (resp.status === 429) {
      if (tentativa < 3) {
        const espera = tentativa * 5_000;
        console.warn(`[DataJud] 429 sem dados para ${numero} — aguardando ${espera / 1000}s (tentativa ${tentativa}/3)`);
        await transporte.esperar(espera);
        continue;
      }
      throw new Error(`DataJud sobrecarregado (429) após 3 tentativas — tente novamente em alguns minutos.`);
    }

    if (resp.status >= 400) throw new Error(`DataJud HTTP ${resp.status} para ${numero}`);
    return null;
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
//  CONSULTAR POR NÚMEROS (R-06) — só os NOSSOS processos, em lotes
//
//  Substitui a varredura do tribunal inteiro por data (consultarAtualizados), que tinha 4 defeitos
//  medidos no código: teto de 50 páginas (o resto nunca era lido), 429 na 1ª página virava "nada mudou",
//  429 no meio repetia a mesma página para sempre, e a janela avançava mesmo com falha. Aqui pergunta-se
//  ao DataJud pelos números que interessam (terms em numeroProcesso; ~800 processos = 9 requisições) e
//  cada processo compara a data de atualização recebida com a que já gravou (processos.datajud_atualizado_em).
//
//  Regra de falha: 429, 408, 5xx, timeout e erro de rede NUNCA viram "nada mudou". Tentam de novo com espera
//  crescente e, esgotadas as tentativas, LANÇAM ErroDataJud (com o status HTTP) — quem chama conta a falha
//  e não avança marca nenhuma. O único caso "parcial" é a resposta de erro que ainda traz processos no corpo
//  (o DataJud faz isso com 429): os que vieram são aproveitados e os que faltam contam como falha.
// ─────────────────────────────────────────────
// Números por requisição (plano R-06: 100). DATAJUD_TAMANHO_LOTE permite baixar (ou subir) sem novo deploy se a
// API começar a estourar o timeout com respostas grandes; fora de 10 a 200, vale o padrão.
export function lerTamanhoLote(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n >= 10 && n <= 200 ? n : 100;
}
export const TAMANHO_LOTE = lerTamanhoLote(process.env.DATAJUD_TAMANHO_LOTE);
const TENTATIVAS  = 4;                       // 1 + 3 novas tentativas
const ESPERAS_MS  = [5_000, 15_000, 45_000]; // espera crescente entre as tentativas
const ESPERA_MAX_MS = 120_000;               // teto ao respeitar o Retry-After do servidor
const TAMANHO_PAGINA = 1000;                 // size da consulta; com ≤100 números nunca deveria encher

export class ErroDataJud extends Error {
  constructor(mensagem, { status = null, tentativas = 1 } = {}) {
    super(mensagem);
    this.name       = 'ErroDataJud';
    this.status     = status;      // último status HTTP recebido (null = sem resposta: timeout/rede)
    this.tentativas = tentativas;
  }
}

export function dividirEmLotes(lista, tamanho = TAMANHO_LOTE) {
  const lotes = [];
  for (let i = 0; i < lista.length; i += tamanho) lotes.push(lista.slice(i, i + tamanho));
  return lotes;
}

// dataHoraUltimaAtualizacao do DataJud → Date (ou null). Aceita ISO 8601 (com ou sem fuso; sem fuso vale UTC,
// para a comparação não depender do fuso do servidor) e o formato compacto AAAAMMDDhhmmss que alguns
// tribunais usam em outros campos de data. O que não der para ler devolve null: quem chama trata como "mudou".
export function instanteDataJud(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const s = String(valor).trim();
  const compacto = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{1,3})?$/);
  let d;
  if (compacto) {
    const [, a, m, dia, h, mi, se, ms] = compacto;
    d = new Date(Date.UTC(+a, +m - 1, +dia, +h, +mi, +se, ms ? +ms.padEnd(3, '0') : 0));
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) {
    d = new Date(`${s}Z`);
  } else {
    d = new Date(s);
  }
  return Number.isNaN(d.getTime()) ? null : d;
}

function motivoSemResposta(err) {
  const codigo = err?.code || '';
  if (codigo === 'ECONNABORTED' || codigo === 'ETIMEDOUT' || /timeout/i.test(err?.message || '')) return 'timeout';
  return codigo || 'erro de rede';
}

function descreverFalha({ status, erroRede }) {
  return status ? `HTTP ${status}` : `sem resposta (${erroRede || 'erro de rede'})`;
}

function calcularEspera(tentativa, resp) {
  const base = ESPERAS_MS[Math.min(tentativa, ESPERAS_MS.length) - 1];
  const retryAfter = Number(resp?.headers?.['retry-after']);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(Math.max(base, retryAfter * 1000), ESPERA_MAX_MS);
  return base;
}

// Um POST com nova tentativa. Nunca lança: devolve { ok, status, data, tentativas, erroRede }.
// 2xx = ok. Retenta 429/408/5xx e falha de rede/timeout; os demais 4xx (400, 401, 403...) não adianta repetir.
async function postarComRetry(indice, body, rotulo) {
  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    let resp = null;
    let erroRede = null;
    try {
      resp = await transporte.post(indice, body);
    } catch (err) {
      erroRede = motivoSemResposta(err);
    }
    const status = resp?.status ?? null;
    if (status !== null && status >= 200 && status < 300) {
      return { ok: true, status, data: resp.data, tentativas: tentativa };
    }
    const retentavel = status === null || status === 429 || status === 408 || status >= 500;
    if (!retentavel || tentativa === TENTATIVAS) {
      return { ok: false, status, data: resp?.data ?? null, tentativas: tentativa, erroRede };
    }
    const espera = calcularEspera(tentativa, resp);
    console.warn(`[DataJud] ${rotulo}: ${descreverFalha({ status, erroRede })} — nova tentativa ${tentativa + 1}/${TENTATIVAS} em ${espera / 1000}s`);
    await transporte.esperar(espera);
  }
}

// Documentos (_source) → Map<numeroPuro, {dados, movimentacoes, atualizadoEm}>. Só entram os números pedidos.
// Se o mesmo número vier em mais de um documento (graus diferentes), vence o atualizado mais recentemente.
function montarEncontrados(hits, pedidos) {
  const encontrados = new Map();
  for (const hit of hits) {
    const src = hit?._source;
    const numero = src?.numeroProcesso;
    if (!numero || !pedidos.has(numero)) continue;
    const atual = parsear(src);
    const anterior = encontrados.get(numero);
    if (!anterior || (atual.atualizadoEm && (!anterior.atualizadoEm || atual.atualizadoEm > anterior.atualizadoEm))) {
      encontrados.set(numero, atual);
    }
  }
  return encontrados;
}

// Devolve { encontrados: Map, falharam: Set<numeroPuro>, hits, status, tentativas, metodo }.
//  - encontrados: processos que o DataJud devolveu;
//  - falharam: números que NÃO puderam ser consultados (só resposta parcial ou fallback individual);
//    número fora de `encontrados` e de `falharam` = o DataJud respondeu e não tem esse processo;
//  - hits: documentos devolvidos; status: último status HTTP (200 quando tudo respondeu bem).
// Lança ErroDataJud quando o lote inteiro falhou.
export async function consultarPorNumeros(tribunal, numerosPuros) {
  const indice = INDICE[tribunal];
  if (!indice) throw new ErroDataJud(`DataJud: tribunal ${tribunal} não mapeado`);

  const numeros = [...new Set(numerosPuros)];
  if (numeros.length === 0) {
    return { encontrados: new Map(), falharam: new Set(), hits: 0, status: null, tentativas: 0, metodo: 'terms' };
  }
  const pedidos = new Set(numeros);
  const rotulo  = `${tribunal} lote de ${numeros.length}`;

  const r = await postarComRetry(indice, { size: TAMANHO_PAGINA, query: { terms: { numeroProcesso: numeros } } }, rotulo);

  if (r.ok) {
    const hits  = r.data?.hits?.hits || [];
    const total = r.data?.hits?.total?.value;
    if (hits.length >= TAMANHO_PAGINA || (Number.isFinite(total) && total > hits.length)) {
      // Resposta cortada: tratar como "não achei" seria o mesmo erro do 429 mudo. É falha.
      throw new ErroDataJud(`DataJud devolveu resposta incompleta (${hits.length} de ${Number.isFinite(total) ? total : '?'}) — ${tribunal}`,
        { status: r.status, tentativas: r.tentativas });
    }
    console.log(`[DataJud] ${rotulo}: ${hits.length} documento(s)`);
    return { encontrados: montarEncontrados(hits, pedidos), falharam: new Set(), hits: hits.length, status: r.status, tentativas: r.tentativas, metodo: 'terms' };
  }

  // 400: a API recusou a consulta em lote (terms em numeroProcesso ainda NÃO foi provado na API pública).
  // Degrada para consulta por número (match, como o sync individual), em vez de deixar o sync cego de novo.
  if (r.status === 400) {
    console.warn(`[DataJud] ${rotulo}: HTTP 400 na consulta em lote — usando consulta por número`);
    return consultarUmAUm(tribunal, indice, numeros, pedidos);
  }

  // Erro com processos no corpo (429 costuma vir assim): aproveita os que vieram; os que faltam são FALHA.
  const hitsCorpo = r.data?.hits?.hits;
  if (Array.isArray(hitsCorpo) && hitsCorpo.length > 0) {
    const encontrados = montarEncontrados(hitsCorpo, pedidos);
    const falharam = new Set(numeros.filter(n => !encontrados.has(n)));
    console.warn(`[DataJud] ${rotulo}: ${descreverFalha(r)} com ${encontrados.size} processo(s) no corpo — resposta parcial`);
    return { encontrados, falharam, hits: hitsCorpo.length, status: r.status, tentativas: r.tentativas, metodo: 'terms' };
  }

  throw new ErroDataJud(`DataJud ${descreverFalha(r)} — ${tribunal}`, { status: r.status, tentativas: r.tentativas });
}

// Fallback do lote recusado: um número por vez (concorrência 5), cada um com a mesma regra de nova tentativa.
async function consultarUmAUm(tribunal, indice, numeros, pedidos) {
  const CONC = 5;
  const encontrados = new Map();
  const falharam = new Set();
  let hits = 0;
  let statusFalha = null;
  let tentativas = 0;

  for (let i = 0; i < numeros.length; i += CONC) {
    await Promise.all(numeros.slice(i, i + CONC).map(async (numero) => {
      const r = await postarComRetry(indice, { size: 3, query: { match: { numeroProcesso: numero } } }, `${tribunal} individual`);
      tentativas += r.tentativas;
      if (!r.ok) { falharam.add(numero); statusFalha = r.status ?? statusFalha; return; }
      const docs = r.data?.hits?.hits || [];
      hits += docs.length;
      const achado = montarEncontrados(docs, pedidos).get(numero);
      if (achado) encontrados.set(numero, achado);
    }));
  }

  if (encontrados.size === 0 && falharam.size === numeros.length) {
    throw new ErroDataJud(`DataJud ${descreverFalha({ status: statusFalha })} — ${tribunal} (consulta por número)`, { status: statusFalha, tentativas });
  }
  return { encontrados, falharam, hits, status: statusFalha ?? 200, tentativas, metodo: 'match' };
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
    // Marca do DataJud para "mudou desde a última captura?" (processos.datajud_atualizado_em)
    atualizadoEm: instanteDataJud(src.dataHoraUltimaAtualizacao),
  };
}
