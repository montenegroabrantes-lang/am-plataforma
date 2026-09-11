import axios from 'axios';

const PB_API = 'https://api.dadosabertos.codata.pb.gov.br/api/v1/remuneracao/servidor';
const PB_FONTE = 'https://dados.pb.gov.br/dataset/remuneracao-servidores';
const PE_API = 'https://api.pentaho.transparencia.pe.gov.br/pentaho/plugin/cda/api/doQuery';
const PE_ARQUIVO = '/public/OpenReports/Portal_Producao/Painel_Remuneracao/Painel_Remuneracao.cda';
const PE_FONTE = 'https://transparencia.pe.gov.br/recursos-humanos/remuneracoes/';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 200;
const MESES_MAXIMOS = 60;

const cache = new Map();
const emAndamento = new Map();

export class ReferenciaEstadualError extends Error {
  constructor(message, status = 422, codigo = 'referencia_estadual_invalida') {
    super(message);
    this.name = 'ReferenciaEstadualError';
    this.status = status;
    this.codigo = codigo;
  }
}

export function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function detectarUfEstadual(orgao) {
  const texto = normalizarTexto(orgao);
  if (/\bPERN(?:AM|AN|EN)BUCO\b/.test(texto)) return 'PE';
  if (/\bPARAIBA\b/.test(texto)) return 'PB';
  return null;
}

function parseCompetencia(valor) {
  const texto = String(valor || '').trim();
  let ano;
  let mes;
  let achado = texto.match(/^(\d{4})-(\d{1,2})$/);
  if (achado) [, ano, mes] = achado;
  else {
    achado = texto.match(/^(\d{1,2})\/(\d{4})$/);
    if (achado) [, mes, ano] = achado;
  }
  ano = Number(ano);
  mes = Number(mes);
  if (!Number.isInteger(ano) || !Number.isInteger(mes) || mes < 1 || mes > 12) return null;
  return { ano, mes, indice: ano * 12 + mes - 1 };
}

function competenciaPorIndice(indice) {
  return { ano: Math.floor(indice / 12), mes: (indice % 12) + 1, indice };
}

function competenciaTexto(competencia) {
  return `${String(competencia.mes).padStart(2, '0')}/${competencia.ano}`;
}

export function competenciasUltimosCincoAnos(inicio, fim, agora = new Date()) {
  const atual = { ano: agora.getFullYear(), mes: agora.getMonth() + 1 };
  atual.indice = atual.ano * 12 + atual.mes - 1;
  const limiteInicial = atual.indice - (MESES_MAXIMOS - 1);
  const informadoInicio = parseCompetencia(inicio);
  const informadoFim = parseCompetencia(fim);
  const inicioIndice = Math.max(informadoInicio?.indice ?? limiteInicial, limiteInicial);
  const fimIndice = Math.min(informadoFim?.indice ?? atual.indice, atual.indice);

  if (inicioIndice > fimIndice) {
    throw new ReferenciaEstadualError('O período informado não contém competências válidas nos últimos cinco anos.');
  }

  return Array.from({ length: fimIndice - inicioIndice + 1 }, (_, i) =>
    competenciaPorIndice(inicioIndice + i));
}

function numero(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  let texto = String(valor ?? '').trim().replace(/R\$/gi, '').replace(/\s/g, '');
  if (!texto) return 0;
  if (texto.includes(',')) texto = texto.replace(/\./g, '').replace(',', '.');
  const convertido = Number(texto);
  return Number.isFinite(convertido) ? convertido : 0;
}

function arredondar(valor) {
  return Math.round((Number(valor) + Number.EPSILON) * 100) / 100;
}

function objetosPentaho(data) {
  const colunas = Array.isArray(data?.metadata)
    ? data.metadata.map(item => item?.colName || item?.colLabel || item?.name)
    : [];
  if (!colunas.length || !Array.isArray(data?.resultset)) return [];
  return data.resultset.map(linha => Object.fromEntries(colunas.map((coluna, i) => [coluna, linha?.[i]])));
}

function registroPb(item, competencia) {
  return {
    uf: 'PB',
    competencia: competenciaTexto(competencia),
    indice: competencia.indice,
    nome: item.nomeServidor,
    matricula: String(item.matricula || '').trim(),
    cargo: item.nomeCargo || item.tipoCargo || '',
    orgao: item.orgaoLotacao || item.nomeUnidadeTrabalho || item.administracao || '',
    regime: item.regimeContratual || item.situacaoServidor || '',
    admissao: item.dataAdmissao || '',
    remuneracao: numero(item.valorBruto),
    totalVantagens: arredondar(numero(item.vantagemFixa) + numero(item.vantagemVariavel)),
  };
}

function registroPe(item, competencia) {
  return {
    uf: 'PE',
    competencia: competenciaTexto(competencia),
    indice: competencia.indice,
    nome: item.r_nome,
    matricula: String(item.r_matricula || '').trim(),
    cargo: item.r_cargo || item.r_funcao || '',
    orgao: item.r_instituicao || '',
    regime: item.r_categoria || item.r_situacao_pagamento || '',
    admissao: item.r_data_admissao || '',
    remuneracao: numero(item.r_remuneracao || item.r_vencimento_cargo),
    totalVantagens: numero(item.r_total_vantagens),
  };
}

async function consultarPb(competencia, nome, httpGet) {
  const { data } = await httpGet(PB_API, {
    params: {
      ano: competencia.ano,
      mes: competencia.mes,
      nomeServidor: nome,
      page: 1,
      per_page: 100,
    },
    timeout: 15_000,
    headers: { Accept: 'application/json', 'User-Agent': 'AM-Plataforma/1.0' },
  });
  const itens = Array.isArray(data?.dados) ? data.dados : [];
  return itens.map(item => registroPb(item, competencia));
}

async function consultarPe(competencia, nome, httpGet) {
  const { data } = await httpGet(PE_API, {
    params: {
      path: PE_ARQUIVO,
      dataAccessId: 'sql_jndi',
      parampara_ano: competencia.ano,
      parammes_: competencia.mes,
      paramsituacao: '%',
      parammatricula_: '',
      parampara_orgao_ano_mes: '%',
      parampesquisa_: nome,
      parampesquisa_cargo_: '%',
      paramoutros: 3,
      paramlimit_: 100,
      paramoffset_: 0,
    },
    timeout: 15_000,
    headers: { Accept: 'application/json', 'User-Agent': 'AM-Plataforma/1.0' },
  });
  return objetosPentaho(data).map(item => registroPe(item, competencia));
}

async function emLotes(itens, tamanho, executar) {
  const resultados = [];
  for (let i = 0; i < itens.length; i += tamanho) {
    const lote = itens.slice(i, i + tamanho);
    resultados.push(...await Promise.allSettled(lote.map(executar)));
  }
  return resultados;
}

function palavrasRelevantes(texto) {
  const ignorar = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'ESTADO', 'GOVERNO', 'SECRETARIA']);
  return normalizarTexto(texto).split(' ').filter(p => p.length > 2 && !ignorar.has(p));
}

function afinidade(textoOficial, textoInformado) {
  const informado = palavrasRelevantes(textoInformado);
  if (!informado.length) return 0;
  const oficial = new Set(palavrasRelevantes(textoOficial));
  return informado.filter(p => oficial.has(p)).length / informado.length;
}

export function consolidarRegistros(registros, { nome, cargo, orgao }) {
  const nomeExato = normalizarTexto(nome);
  const exatos = registros.filter(registro => normalizarTexto(registro.nome) === nomeExato);
  const grupos = new Map();

  for (const registro of exatos) {
    // Matriculas diferentes representam vínculos distintos. Quando a fonte não informa
    // matrícula, cargo + órgão impedem que vínculos incompatíveis sejam somados.
    const chave = registro.matricula || `${normalizarTexto(registro.cargo)}|${normalizarTexto(registro.orgao)}`;
    if (!grupos.has(chave)) grupos.set(chave, new Map());
    const meses = grupos.get(chave);
    const existente = meses.get(registro.competencia);
    // Algumas fontes repetem a mesma ficha na resposta. Mantemos o maior valor do mês,
    // em vez de somar duplicatas e inflar a referência.
    if (!existente || registro.remuneracao > existente.remuneracao) meses.set(registro.competencia, registro);
  }

  return [...grupos.values()].map(meses => {
    const linhas = [...meses.values()].sort((a, b) => a.indice - b.indice);
    const recente = linhas.at(-1);
    const totalRemuneracao = arredondar(linhas.reduce((soma, item) => soma + item.remuneracao, 0));
    const totalVantagens = arredondar(linhas.reduce((soma, item) => soma + item.totalVantagens, 0));
    const afinidadeCargo = afinidade(recente.cargo, cargo);
    const afinidadeOrgao = afinidade(recente.orgao, orgao);
    return {
      matricula: recente.matricula || null,
      nome: recente.nome,
      cargo: recente.cargo || null,
      orgao: recente.orgao || null,
      regime: recente.regime || null,
      admissao: recente.admissao || null,
      mesesInicio: linhas[0].competencia,
      mesesFim: recente.competencia,
      competencias_localizadas: linhas.length,
      total_remuneracao_oficial: totalRemuneracao,
      total_vantagens_oficial: totalVantagens,
      referencia_fgts_8pct: arredondar(totalRemuneracao * 0.08),
      compatibilidade: arredondar((afinidadeCargo * 0.65) + (afinidadeOrgao * 0.35)),
      competencias: linhas.map(item => ({
        competencia: item.competencia,
        remuneracao: item.remuneracao,
        total_vantagens: item.totalVantagens,
      })),
    };
  }).sort((a, b) => b.compatibilidade - a.compatibilidade || b.competencias_localizadas - a.competencias_localizadas);
}

function obterCache(chave) {
  const item = cache.get(chave);
  if (!item || item.expiraEm <= Date.now()) {
    cache.delete(chave);
    return null;
  }
  return item.valor;
}

function salvarCache(chave, valor) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(chave, { valor, expiraEm: Date.now() + CACHE_TTL_MS });
}

async function executarBusca({ uf, nome, cargo, orgao, inicio, fim, agora, httpGet }) {
  const competencias = competenciasUltimosCincoAnos(inicio, fim, agora);
  const consultar = uf === 'PB' ? consultarPb : consultarPe;
  const respostas = await emLotes(competencias, 5, competencia => consultar(competencia, nome, httpGet));
  const bemSucedidas = respostas.filter(resultado => resultado.status === 'fulfilled');
  const falhas = respostas.length - bemSucedidas.length;

  if (!bemSucedidas.length) {
    throw new ReferenciaEstadualError(
      `O portal oficial de ${uf === 'PB' ? 'Paraíba' : 'Pernambuco'} não respondeu. Tente novamente mais tarde.`,
      502,
      'fonte_oficial_indisponivel'
    );
  }

  const registros = bemSucedidas.flatMap(resultado => resultado.value);
  const vinculos = consolidarRegistros(registros, { nome, cargo, orgao });
  return {
    ok: true,
    status: vinculos.length ? (falhas ? 'parcial' : 'encontrado') : (falhas ? 'nao_encontrado_parcial' : 'nao_encontrado'),
    uf,
    fonte_nome: uf === 'PB' ? 'Portal de Dados Abertos da Paraíba' : 'Portal da Transparência de Pernambuco',
    fonte_url: uf === 'PB' ? PB_FONTE : PE_FONTE,
    nome_consultado: nome,
    periodo_consultado: {
      inicio: competenciaTexto(competencias[0]),
      fim: competenciaTexto(competencias.at(-1)),
      competencias: competencias.length,
      respondidas: bemSucedidas.length,
      falhas,
    },
    vinculos,
    aviso: 'Referência oficial para conferência humana. Não constitui cálculo jurídico nem aprovação automática.',
  };
}

export async function buscarReferenciaEstadual({
  nome,
  cargo = '',
  orgao,
  inicio = '',
  fim = '',
  forcar = false,
  agora = new Date(),
  httpGet = axios.get,
}) {
  const nomeLimpo = String(nome || '').trim().replace(/\s+/g, ' ');
  if (normalizarTexto(nomeLimpo).split(' ').length < 2) {
    throw new ReferenciaEstadualError('Informe o nome completo para consultar a fonte oficial.');
  }

  const uf = detectarUfEstadual(orgao);
  if (!uf) {
    throw new ReferenciaEstadualError('A consulta oficial está disponível para vínculos estaduais da Paraíba e de Pernambuco.');
  }

  const chave = [uf, normalizarTexto(nomeLimpo), normalizarTexto(cargo), normalizarTexto(orgao), inicio, fim].join('|');
  if (!forcar) {
    const existente = obterCache(chave);
    if (existente) return { ...existente, cache: true };
    if (emAndamento.has(chave)) return emAndamento.get(chave);
  }

  const promessa = executarBusca({ uf, nome: nomeLimpo, cargo, orgao, inicio, fim, agora, httpGet });
  if (!forcar) emAndamento.set(chave, promessa);
  try {
    const resultado = await promessa;
    salvarCache(chave, resultado);
    return resultado;
  } finally {
    emAndamento.delete(chave);
  }
}
