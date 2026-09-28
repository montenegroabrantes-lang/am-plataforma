// Levantamento de re-protocolo — SOMENTE LEITURA.
//
// Monta, para o Master (tela ou chat via MCP), o retrato das duas filas que a tela de Tarefas
// já tem: "Re-protocolo" (prontos para protocolar) e "Novos ciclos" (aguardando autorização),
// mais o que o AM sabe da documentação de cada cliente. Nunca escreve nada: não aceita ciclo,
// não mexe em tarefa, não cria pasta, não acessa PJe.
//
// Desenho: o SQL (regras copiadas de tarefas.js/cron — ver regras.js) só busca FATOS; tudo o
// que é derivado (meses, janela de 5 anos, flags, agrupamento) é calculado aqui em funções
// puras, testáveis sem banco. `conexao` é injetável: a rota usa o pool normal; a conferência
// somente leitura usa uma transação READ ONLY; os testes usam um banco simulado.
import { db } from '../../db/index.js';
import { normalizarTexto, detectarUfEstadual } from '../remuneracaoEstadual.js';
import {
  TAREFA_ABERTA, FILA_REPROTOCOLO, FILA_CICLOS, CICLO_NAO_ADIADO,
  CLIENTE_ID, CLIENTE_NOME, CLIENTE_CPF, PRODUTO_ID, PRODUTO_NOME,
  JOINS_TAREFA, JOIN_VINCULOS, POLO_PASSIVO, POLO_DEGRAUS,
  ULTIMO_PROCESSO_FILTRO, ULTIMO_PROCESSO_ORDEM, PROCESSO_COBRINDO, MESES_JANELA_QUINQUENAL,
} from './regras.js';

export const SECAO_PRONTOS = 'prontos';
export const SECAO_AGUARDANDO = 'aguardando_autorizacao';

// ───────────────────────────── SQL (só fatos) ─────────────────────────────

export function sqlItens({ porTarefa = false } = {}) {
  return `
SELECT
  t.id AS tarefa_id,
  CASE WHEN ${FILA_REPROTOCOLO} THEN '${SECAO_PRONTOS}' ELSE '${SECAO_AGUARDANDO}' END AS secao,
  t.subtipo, t.ciclo_inicio, t.ciclo_adiado_ate, t.prazo_data, t.validado_por,
  t.atribuido_a, u.nome AS responsavel_nome, u.ativo AS responsavel_ativo,
  ${CLIENTE_ID} AS cliente_id,
  ${CLIENTE_NOME} AS cliente_nome,
  ${CLIENTE_CPF} AS cliente_cpf,
  c.ativo AS cliente_ativo, c.vinculo_ativo AS cliente_vinculo_ativo, c.vinculo_fim AS cliente_vinculo_fim,
  c.cargo AS cliente_cargo, c.orgao AS cliente_orgao,
  (NULLIF(TRIM(c.drive_pasta_id), '') IS NOT NULL) AS tem_pasta_drive,
  ${PRODUTO_ID} AS produto_id,
  ${PRODUTO_NOME} AS produto_nome,
  COALESCE(pr.intervalo_meses,opr.intervalo_meses,ppr.intervalo_meses) AS intervalo_meses,
  COALESCE(pr.documentos_exigidos,opr.documentos_exigidos,ppr.documentos_exigidos) AS documentos_exigidos,
  ${POLO_PASSIVO} AS polo_passivo,
  ${POLO_DEGRAUS},
  vinc.qtd_vinculos_ativos, vinc.qtd_vinculos, vinc.vinculos_ativos,
  tv.id AS vinculo_tarefa_id, tv.cargo AS vinculo_tarefa_cargo, tv.orgao AS vinculo_tarefa_orgao,
  tv.polo_passivo AS vinculo_tarefa_polo, tv.vinculo_ativo AS vinculo_tarefa_ativo,
  pa.id AS anterior_id, pa.numero AS anterior_numero, pa.periodo_fim AS anterior_periodo_fim,
  pa.status AS anterior_status, pa.vara AS anterior_vara, pa.tribunal AS anterior_tribunal,
  pa.comarca AS anterior_comarca, pa.grau AS anterior_grau, pa.visibilidade AS anterior_visibilidade,
  cob.qtd AS cobrindo_qtd, cob.lista AS cobrindo_lista,
  mt.qtd AS processos_mesma_tese,
  COALESCE(pr.responsavel_reprotocolo_id,opr.responsavel_reprotocolo_id,ppr.responsavel_reprotocolo_id) AS resp_tese_config,
  ur.nome AS resp_tese_nome, ur.ativo AS resp_tese_ativo,
  pa.master_responsavel_id AS resp_proc_id, um.nome AS resp_proc_nome, um.ativo AS resp_proc_ativo
FROM tarefas t
${JOINS_TAREFA}
${JOIN_VINCULOS}
LEFT JOIN clientes c ON c.id = ${CLIENTE_ID}
-- vínculo gravado na tarefa, só se for do MESMO cliente (nunca mistura clientes)
LEFT JOIN cliente_vinculos tv ON tv.id = t.cliente_vinculo_id AND tv.cliente_id = c.id
LEFT JOIN LATERAL (
  SELECT px.id, px.numero, px.periodo_fim, px.status, px.vara, px.tribunal, px.comarca, px.grau,
         px.visibilidade, px.master_responsavel_id
    FROM processos px
   WHERE px.cliente_id = c.id AND px.produto_id = ${PRODUTO_ID} ${ULTIMO_PROCESSO_FILTRO}
   ${ULTIMO_PROCESSO_ORDEM}
) pa ON true
LEFT JOIN LATERAL (
  SELECT COUNT(*)::int AS qtd,
         COALESCE(json_agg(json_build_object('numero',pz.numero,'status',pz.status,'periodo_fim',pz.periodo_fim,
                                             'visibilidade',pz.visibilidade) ORDER BY pz.criado_em DESC, pz.id), '[]'::json) AS lista
    FROM processos pz
   WHERE pz.cliente_id = c.id AND pz.produto_id = ${PRODUTO_ID} AND ${PROCESSO_COBRINDO}
) cob ON true
LEFT JOIN LATERAL (
  SELECT COUNT(*)::int AS qtd FROM processos pm WHERE pm.cliente_id = c.id AND pm.produto_id = ${PRODUTO_ID}
) mt ON true
LEFT JOIN usuarios ur ON ur.id = COALESCE(pr.responsavel_reprotocolo_id,opr.responsavel_reprotocolo_id,ppr.responsavel_reprotocolo_id)
LEFT JOIN usuarios um ON um.id = pa.master_responsavel_id
WHERE ${TAREFA_ABERTA} AND ((${FILA_REPROTOCOLO}) OR (${FILA_CICLOS} AND ${CICLO_NAO_ADIADO}))
${porTarefa ? 'AND t.id = $1' : ''}
ORDER BY t.ciclo_inicio ASC NULLS LAST, t.id`;
}

// Ciclos adiados: fora da fila "Novos ciclos" até a data de retorno (mesma consulta da lista de
// adiados de GET /api/tarefas/ciclos/previsao, em forma de contagem).
export const SQL_ADIADOS = `
SELECT COUNT(*)::int AS adiados
  FROM tarefas t
  JOIN cliente_produtos cp ON cp.id = t.cliente_produto_id
  JOIN clientes c ON c.id = cp.cliente_id
  JOIN produtos pr ON pr.id = cp.produto_id
 WHERE t.tipo = 'protocolar' AND t.subtipo = 'ciclo' AND t.status NOT IN ('concluida','cancelada')
   AND t.ciclo_adiado_ate > CURRENT_DATE`;

// Documentos que o PRÓPRIO AM registrou (upload pela ficha do cliente). Datas = registro no AM.
export const SQL_DOCUMENTOS = `
SELECT d.cliente_id, d.categoria, COUNT(*)::int AS quantidade,
       MIN(d.criado_em)::date::text AS primeiro_registro, MAX(d.criado_em)::date::text AS ultimo_registro
  FROM documentos d
 WHERE d.cliente_id = ANY($1::uuid[]) AND d.deletado = false
 GROUP BY d.cliente_id, d.categoria
 ORDER BY d.cliente_id, d.categoria`;

export const SQL_HOJE = `SELECT CURRENT_DATE::text AS hoje`;

// ───────────────────────────── Datas / competências ─────────────────────────────

function dataIso(valor) {
  if (!valor) return null;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor.toISOString().slice(0, 10);
  const s = String(valor);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

// Índice absoluto do mês (ano*12 + mês-1) a partir de 'AAAA-MM', 'AAAA-MM-DD' ou Date.
export function indiceMes(valor) {
  if (!valor) return null;
  const s = valor instanceof Date ? dataIso(valor) : String(valor);
  const m = s?.match(/^(\d{4})-(\d{1,2})/);
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return null;
  return ano * 12 + mes - 1;
}

export function mesDoIndice(indice) {
  if (indice === null || indice === undefined) return null;
  return `${Math.floor(indice / 12)}-${String((indice % 12) + 1).padStart(2, '0')}`;
}

// Período acumulado: ciclo_inicio → mês atual, ou → vinculo_fim quando o vínculo está encerrado
// (mesma leitura do cron). Meses contados inclusive, como o CICLO_MESES de tarefas.js.
// "Mais de 5 anos" = competência anterior às últimas 60 (a mesma janela da referência oficial).
// Intervalo da tese (produtos.intervalo_meses): o cron só cria o ciclo quando
// ciclo_inicio + (intervalo - 1) meses <= hoje; aqui só se INFORMA se isso já aconteceu.
export function calcularPeriodo({ cicloInicio, vinculoAtivo, vinculoFim, hoje, intervaloMeses = null }) {
  const hojeIdx = indiceMes(hoje);
  const janelaIdx = hojeIdx - (MESES_JANELA_QUINQUENAL - 1);
  const inicioIdx = indiceMes(cicloInicio);

  let fimIdx = hojeIdx;
  let fimMotivo = 'hoje';
  if (vinculoAtivo === false) {
    const fimVinculo = indiceMes(vinculoFim);
    if (fimVinculo !== null) {
      fimIdx = Math.min(fimVinculo, hojeIdx);
      fimMotivo = 'vinculo_encerrado';
    } else {
      fimMotivo = 'vinculo_encerrado_sem_data'; // sem data: "até hoje" é só um teto
    }
  }

  const intervalo = Number(intervaloMeses) > 0 ? Number(intervaloMeses) : null;
  const venceIdx = inicioIdx !== null && intervalo ? inicioIdx + intervalo - 1 : null;
  const base = {
    inicio: mesDoIndice(inicioIdx),
    fim: mesDoIndice(fimIdx),
    fim_motivo: fimMotivo,
    primeiro_mes_dentro_5_anos: mesDoIndice(janelaIdx),
    intervalo_da_tese_meses: intervalo,
    completa_intervalo_em: mesDoIndice(venceIdx),
    intervalo_completo: venceIdx === null ? null : venceIdx <= hojeIdx,
  };
  if (inicioIdx === null) {
    return { ...base, situacao: 'sem_inicio', meses: null, meses_mais_5_anos: null, prescricao_correndo: false };
  }
  const meses = Math.max(0, fimIdx - inicioIdx + 1);
  let situacao = 'ok';
  if (meses === 0) situacao = inicioIdx > hojeIdx ? 'inicio_no_futuro' : 'encerrado_antes_do_inicio';
  const mesesMais5 = meses === 0 ? 0 : Math.max(0, Math.min(fimIdx, janelaIdx - 1) - inicioIdx + 1);
  // Correndo = o mês mais antigo ainda dentro da janela está no período: a cada mês sem
  // ajuizamento, mais uma competência passa de 5 anos.
  const prescricaoCorrendo = meses > 0 && inicioIdx <= janelaIdx && fimIdx >= janelaIdx;
  return { ...base, situacao, meses, meses_mais_5_anos: mesesMais5, prescricao_correndo: prescricaoCorrendo };
}

// ───────────────────────────── Máscara, ente, juízo ─────────────────────────────

// Só os 4 últimos dígitos, nunca mais que isso, mesmo com dado malformado.
export function mascararCpf(cpf) {
  const digitos = String(cpf ?? '').replace(/\D/g, '');
  if (digitos.length < 4) return null;
  const final = digitos.slice(-4);
  return `***.***.*${final.slice(0, 2)}-${final.slice(2)}`;
}

const PREPOSICOES = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E']);
const MARCA_MUNICIPAL = /\b(MUNICIPIO|MUNICIPAL|PREFEITURA|CAMARA)\b/;
const MARCA_ESTADO = /\b(ESTADO|GOVERNO)\b/;
const NOME_ESTADO = { PB: 'Estado da Paraíba', PE: 'Estado de Pernambuco' };

// Classifica o polo passivo resolvido só para AGRUPAR e decidir se há fonte oficial integrada.
// Não altera o polo: o texto original fica em `informado`. Variações de grafia do mesmo ente
// ("ESTADO PARAIBA", "Governo de Pernambuco", "Prefeitura de João Pessoa") caem no mesmo grupo.
export function classificarEnte(polo) {
  const informado = String(polo ?? '').trim();
  if (!informado) return { nome: null, chave: 'SEM POLO', fonte_oficial: null, generico: false };
  const texto = normalizarTexto(informado);
  const municipal = MARCA_MUNICIPAL.test(texto);
  const uf = detectarUfEstadual(informado);
  if (!municipal && uf && MARCA_ESTADO.test(texto)) {
    return { nome: NOME_ESTADO[uf], chave: `ESTADO ${uf}`, fonte_oficial: uf, generico: false };
  }
  const palavras = texto
    .replace(/\bPREFEITURA( MUNICIPAL)?\b/g, 'MUNICIPIO')
    .replace(/\bGOVERNO\b/g, 'ESTADO')
    .split(' ')
    .filter(p => p && !PREPOSICOES.has(p))
    .filter((p, i, lista) => p !== lista[i - 1]);
  const chave = palavras.join(' ');
  return { nome: informado, chave, fonte_oficial: null, generico: chave === 'MUNICIPIO OUTRO' };
}

const NUCLEO_CUMPRIMENTO = /CUMPRIMENTO DE SENTENCA/;
const GABINETE = /\bGABINETE\b/;

// A vara gravada no processo é a sua localização ATUAL (sincronizada do tribunal). Quando ela é
// um gabinete (turma recursal/2º grau) ou um núcleo de cumprimento de sentença, não é o juízo em
// que uma ação nova seria distribuída — só avisamos, sem tentar adivinhar o juízo de origem.
export function avisoDoJuizo(vara, grau) {
  const texto = normalizarTexto(vara);
  if (NUCLEO_CUMPRIMENTO.test(texto)) return 'núcleo de cumprimento de sentença (fase de execução) — não é o juízo de origem';
  if (GABINETE.test(texto) || String(grau || '') === '2') return 'gabinete de 2º grau/turma recursal — não é o juízo de origem';
  return null;
}

export function montarJuizo(anterior, podeVerRestrito) {
  if (!anterior) {
    return { origem: 'sem_processo_anterior', rotulo: 'Sem processo anterior', tribunal: null, vara: null, comarca: null, chave: 'SEM PROCESSO ANTERIOR' };
  }
  if (anterior.restrito && !podeVerRestrito) {
    return { origem: 'processo_restrito', rotulo: 'Processo anterior restrito', tribunal: null, vara: null, comarca: null, chave: 'PROCESSO RESTRITO' };
  }
  const tribunal = anterior.tribunal || null;
  const comarca = anterior.comarca || null;
  const vara = String(anterior.vara ?? '').trim() || null;
  if (!vara) {
    return {
      origem: 'vara_nao_registrada', rotulo: `${tribunal || 'Tribunal não informado'} — vara não registrada`,
      tribunal, vara: null, comarca, chave: `${normalizarTexto(tribunal)} | VARA NAO REGISTRADA`,
    };
  }
  return {
    origem: 'processo_anterior',
    rotulo: tribunal ? `${vara} (${tribunal})` : vara,
    tribunal, vara, comarca,
    aviso: avisoDoJuizo(vara, anterior.grau),
    chave: `${normalizarTexto(tribunal)} | ${normalizarTexto(vara)}`,
  };
}

// Ente estadual (PB/PE) com processo anterior no TJ de OUTRO estado: um dos dois dados está
// errado ou a situação é incomum — em qualquer caso, pede conferência antes de protocolar.
export function enteDivergeDoTribunal(ente, tribunal) {
  if (!ente?.fonte_oficial || !tribunal) return false;
  const tj = normalizarTexto(tribunal).match(/\bTJ(PB|PE)\b/);
  return Boolean(tj) && tj[1] !== ente.fonte_oficial;
}

// ───────────────────────────── Flags ─────────────────────────────

export const FLAGS = {
  sem_polo: 'Polo passivo não resolvido (nem processo, nem vínculo único, nem cadastro, nem padrão da tese).',
  polo_inferido_da_tese: 'Polo veio só do padrão da tese (1º item de um menu de opções), não do cadastro do cliente.',
  polo_generico: 'Polo é o genérico "Município — Outro": falta definir o município.',
  varios_vinculos_ativos: '2+ vínculos ativos: a tela nunca escolhe o polo pelo vínculo — revisão humana.',
  vinculo_encerrado: 'Vínculo encerrado no cadastro (clientes.vinculo_ativo=false): o período vai só até o desligamento.',
  vinculo_encerrado_sem_data_fim: 'Vínculo encerrado sem data de fim: "até hoje" é só um teto.',
  vinculo_divergente: 'Cadastro do cliente e tabela de vínculos discordam (ver vinculo.divergencias).',
  sem_processo_anterior: 'Nenhum processo anterior da mesma tese com período fim (o ciclo partiu do início do vínculo).',
  processo_cobrindo_periodo: 'Existe processo da mesma tese não arquivado sem período fim ou cobrindo o início do ciclo (regra do cron): possível duplicidade.',
  sem_pasta_drive: 'Cliente sem pasta do Drive vinculada no AM (clientes.drive_pasta_id).',
  sem_inicio_periodo: 'Tarefa sem início de ciclo (ciclo_inicio).',
  inicio_no_futuro: 'Início do ciclo é posterior ao mês atual: ainda não há período acumulado.',
  vinculo_encerrado_antes_do_inicio: 'Vínculo encerrou antes do início do ciclo: não sobra período (o cron não criaria esta tarefa hoje).',
  fim_do_vinculo_antes_do_ciclo: 'Cadastro diz vínculo ATIVO, mas registra data de fim anterior ao início do ciclo: se essa data estiver certa, não há período novo a cobrar.',
  intervalo_da_tese_incompleto: 'O período ainda não completou o intervalo da tese (produtos.intervalo_meses): pela regra do cron este ciclo ainda não venceria.',
  ente_diverge_do_tribunal_anterior: 'Ente estadual (PB/PE) diferente do estado do tribunal do processo anterior: conferir o polo passivo.',
  juizo_nao_e_de_origem: 'A vara registrada no processo anterior é gabinete (2º grau/turma recursal) ou núcleo de cumprimento — não indica o juízo de uma ação nova.',
  meses_acima_5_anos: 'Parte do período tem mais de 5 anos (anterior às últimas 60 competências): risco de prescrição quinquenal.',
  sem_cpf: 'Cliente sem CPF no cadastro.',
  cliente_inativo: 'Cadastro do cliente inativo.',
  sem_responsavel: 'Re-protocolo sem responsável.',
  responsavel_inativo: 'Responsável atribuído está inativo.',
  sem_prazo: 'Re-protocolo sem prazo.',
  prazo_vencido: 'Prazo do re-protocolo já passou.',
  sem_responsavel_sugerido: 'Nem a tese tem responsável de re-protocolo nem o processo anterior tem Master ativo (mesma regra do auto-aceite do cron).',
};

// Flags que exigem decisão humana antes de protocolar — cada uma espelha uma regra que já existe
// (a tela exige seleção humana de polo; o cron nunca auto-aceita vínculo encerrado; etc.).
// "intervalo_da_tese_incompleto" fica de fora de propósito: não é dado errado, é prazo — tem
// contagem própria nas seções (ainda_nao_completaram_intervalo).
export const FLAGS_REVISAO_HUMANA = [
  'sem_polo', 'polo_inferido_da_tese', 'polo_generico', 'varios_vinculos_ativos',
  'vinculo_encerrado', 'vinculo_encerrado_sem_data_fim', 'vinculo_divergente',
  'processo_cobrindo_periodo', 'sem_inicio_periodo', 'inicio_no_futuro',
  'vinculo_encerrado_antes_do_inicio', 'fim_do_vinculo_antes_do_ciclo',
  'ente_diverge_do_tribunal_anterior', 'sem_cpf', 'cliente_inativo',
];

// Mesma regra do cron para o responsável do re-protocolo automático: 1º o configurado na tese;
// sem ele, o Master do processo anterior. Se o escolhido estiver inativo, não há sugestão
// (o cron também não cai para o seguinte).
export function responsavelSugerido(r) {
  if (r.resp_tese_config) {
    return r.resp_tese_ativo ? { id: r.resp_tese_config, nome: r.resp_tese_nome, origem: 'configuracao_da_tese' } : null;
  }
  if (r.resp_proc_id) {
    return r.resp_proc_ativo ? { id: r.resp_proc_id, nome: r.resp_proc_nome, origem: 'master_do_processo_anterior' } : null;
  }
  return null;
}

function origemDoPolo(r) {
  if (!r.polo_passivo) return null;
  if (r.polo_processo) return 'processo';
  if (r.polo_vinculo_unico) return 'vinculo_unico';
  if (r.polo_cliente) return 'cadastro_cliente';
  return 'padrao_tese';
}

function comoLista(valor) {
  if (Array.isArray(valor)) return valor;
  if (typeof valor === 'string') { try { const v = JSON.parse(valor); return Array.isArray(v) ? v : []; } catch { return []; } }
  return [];
}

// ───────────────────────────── Item ─────────────────────────────

export function montarItem(r, { hoje, podeVerRestrito = false }) {
  const periodo = calcularPeriodo({
    cicloInicio: r.ciclo_inicio, vinculoAtivo: r.cliente_vinculo_ativo, vinculoFim: r.cliente_vinculo_fim, hoje,
    intervaloMeses: r.intervalo_meses,
  });

  const polo = r.polo_passivo ? String(r.polo_passivo).trim() : null;
  const origemPolo = origemDoPolo(r);
  const classe = classificarEnte(polo);
  const ente = {
    nome: classe.nome, informado: polo, origem: origemPolo,
    fonte_oficial: classe.fonte_oficial, generico: classe.generico,
  };
  if (origemPolo === 'padrao_tese') ente.opcoes_no_padrao_da_tese = r.padrao_tese_opcoes ?? null;
  // Chaves de agrupamento: legíveis pelo código, fora do JSON de resposta.
  Object.defineProperty(ente, 'chave', { value: classe.chave, enumerable: false });

  const anterior = r.anterior_id ? {
    restrito: r.anterior_visibilidade === 'restrito',
    numero: r.anterior_numero, periodo_fim: dataIso(r.anterior_periodo_fim), status: r.anterior_status,
    vara: r.anterior_vara, tribunal: r.anterior_tribunal, comarca: r.anterior_comarca, grau: r.anterior_grau,
  } : null;
  const ocultarAnterior = anterior?.restrito && !podeVerRestrito;
  const { chave: chaveJuizo, ...juizo } = montarJuizo(anterior, podeVerRestrito);
  Object.defineProperty(juizo, 'chave', { value: chaveJuizo, enumerable: false });
  const processoAnterior = !anterior ? null
    : ocultarAnterior ? { restrito: true }
    : { numero: anterior.numero, periodo_fim: anterior.periodo_fim, status: anterior.status, restrito: anterior.restrito };

  const cobrindo = comoLista(r.cobrindo_lista).map(p => (p.visibilidade === 'restrito' && !podeVerRestrito)
    ? { restrito: true }
    : { numero: p.numero, status: p.status, periodo_fim: dataIso(p.periodo_fim) });

  const qtdAtivos = Number(r.qtd_vinculos_ativos ?? 0);
  const qtdTotal = Number(r.qtd_vinculos ?? 0);
  const vinculosAtivos = comoLista(r.vinculos_ativos);
  const vinculoTarefa = r.vinculo_tarefa_id ? {
    cargo: r.vinculo_tarefa_cargo || null, orgao: r.vinculo_tarefa_orgao || null,
    polo_passivo: r.vinculo_tarefa_polo || null, ativo: r.vinculo_tarefa_ativo,
  } : null;
  // Cargo/órgão de referência: vínculo gravado na tarefa > vínculo ativo único > cadastro legado.
  const referencia = vinculoTarefa || (qtdAtivos === 1 ? vinculosAtivos[0] : null);
  const vinculoFim = dataIso(r.cliente_vinculo_fim);

  const divergencias = [];
  const fimAntesDoCiclo = r.cliente_vinculo_ativo === true && Boolean(vinculoFim)
    && indiceMes(periodo.inicio) !== null && indiceMes(vinculoFim) < indiceMes(periodo.inicio);
  if (r.cliente_vinculo_ativo === true && vinculoFim && vinculoFim <= hoje) {
    divergencias.push(fimAntesDoCiclo
      ? `cadastro diz vínculo ativo, mas registra fim em ${vinculoFim} — antes do início do ciclo (${periodo.inicio})`
      : `cadastro diz vínculo ativo, mas registra fim já passado (${vinculoFim})`);
  }
  if (r.cliente_vinculo_ativo === true && qtdTotal > 0 && qtdAtivos === 0) {
    divergencias.push('cadastro diz vínculo ativo, mas nenhum vínculo da tabela de vínculos está ativo');
  }
  if (r.cliente_vinculo_ativo === false && qtdAtivos > 0) {
    divergencias.push('cadastro diz vínculo encerrado, mas há vínculo ativo na tabela de vínculos');
  }

  const cpfMascarado = mascararCpf(r.cliente_cpf);
  const secao = r.secao === SECAO_PRONTOS ? SECAO_PRONTOS : SECAO_AGUARDANDO;
  const sugerido = secao === SECAO_AGUARDANDO ? responsavelSugerido(r) : undefined;
  const prazo = dataIso(r.prazo_data);

  const flags = [];
  const marcar = (condicao, codigo) => { if (condicao) flags.push(codigo); };
  marcar(!polo, 'sem_polo');
  marcar(origemPolo === 'padrao_tese', 'polo_inferido_da_tese');
  marcar(ente.generico, 'polo_generico');
  marcar(qtdAtivos >= 2, 'varios_vinculos_ativos');
  marcar(r.cliente_vinculo_ativo === false, 'vinculo_encerrado');
  marcar(r.cliente_vinculo_ativo === false && !vinculoFim, 'vinculo_encerrado_sem_data_fim');
  marcar(divergencias.length > 0, 'vinculo_divergente');
  marcar(!anterior, 'sem_processo_anterior');
  marcar(Number(r.cobrindo_qtd ?? 0) > 0, 'processo_cobrindo_periodo');
  marcar(!r.tem_pasta_drive, 'sem_pasta_drive');
  marcar(periodo.situacao === 'sem_inicio', 'sem_inicio_periodo');
  marcar(periodo.situacao === 'inicio_no_futuro', 'inicio_no_futuro');
  marcar(periodo.situacao === 'encerrado_antes_do_inicio', 'vinculo_encerrado_antes_do_inicio');
  marcar(fimAntesDoCiclo, 'fim_do_vinculo_antes_do_ciclo');
  marcar(periodo.intervalo_completo === false && periodo.situacao === 'ok', 'intervalo_da_tese_incompleto');
  marcar(!ocultarAnterior && enteDivergeDoTribunal(ente, anterior?.tribunal), 'ente_diverge_do_tribunal_anterior');
  marcar(Boolean(juizo.aviso), 'juizo_nao_e_de_origem');
  marcar((periodo.meses_mais_5_anos ?? 0) > 0, 'meses_acima_5_anos');
  marcar(!cpfMascarado, 'sem_cpf');
  marcar(r.cliente_ativo === false, 'cliente_inativo');
  if (secao === SECAO_PRONTOS) {
    marcar(!r.atribuido_a, 'sem_responsavel');
    marcar(Boolean(r.atribuido_a) && r.responsavel_ativo === false, 'responsavel_inativo');
    marcar(!prazo, 'sem_prazo');
    marcar(Boolean(prazo) && prazo < hoje, 'prazo_vencido');
  } else {
    marcar(!sugerido, 'sem_responsavel_sugerido');
  }

  const item = {
    tarefa_id: r.tarefa_id,
    secao,
    cliente: { id: r.cliente_id || null, nome: r.cliente_nome || null, cpf_mascarado: cpfMascarado },
    tese: { id: r.produto_id || null, nome: r.produto_nome || null },
    ente,
    juizo,
    processo_anterior: processoAnterior,
    processos_mesma_tese: Number(r.processos_mesma_tese ?? 0),
    processos_cobrindo_periodo: cobrindo,
    periodo,
    vinculo: {
      situacao: r.cliente_vinculo_ativo === false ? 'encerrado' : r.cliente_vinculo_ativo === true ? 'ativo' : 'nao_informado',
      fim: vinculoFim,
      qtd_vinculos_ativos: qtdAtivos,
      qtd_vinculos: qtdTotal,
      cargo: referencia?.cargo || r.cliente_cargo || null,
      orgao: referencia?.orgao || r.cliente_orgao || null,
      vinculo_da_tarefa: vinculoTarefa,
      divergencias,
    },
    pasta_drive_vinculada: Boolean(r.tem_pasta_drive),
    flags,
    revisao_humana: flags.some(f => FLAGS_REVISAO_HUMANA.includes(f)),
  };
  if (secao === SECAO_PRONTOS) {
    item.responsavel = r.atribuido_a ? { id: r.atribuido_a, nome: r.responsavel_nome || null, ativo: r.responsavel_ativo !== false } : null;
    item.prazo = prazo;
    // Mesma leitura do badge da tela: sem validado_por = entrou sozinho pelo cron.
    item.aceite = r.validado_por ? 'manual' : 'automatico';
  } else {
    item.responsavel_sugerido = sugerido;
  }
  // Só para montar a seção de documentação; removido antes de responder.
  Object.defineProperty(item, '_documentosExigidos', { value: r.documentos_exigidos ?? null, enumerable: false });
  return item;
}

// ───────────────────────────── Agrupamento e totais ─────────────────────────────

const porInicioDepoisNome = (a, b) => {
  const ia = indiceMes(a.periodo.inicio);
  const ib = indiceMes(b.periodo.inicio);
  if (ia !== ib) {
    if (ia === null) return 1;
    if (ib === null) return -1;
    return ia - ib;
  }
  return String(a.cliente.nome || '').localeCompare(String(b.cliente.nome || ''), 'pt-BR')
    || String(a.tarefa_id).localeCompare(String(b.tarefa_id));
};

function contarFlags(itens) {
  const contagem = {};
  for (const item of itens) for (const f of item.flags) contagem[f] = (contagem[f] || 0) + 1;
  return Object.fromEntries(Object.entries(contagem).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function somar(itens, campo) {
  return itens.reduce((s, i) => s + (Number(i.periodo[campo]) || 0), 0);
}

// Agrupa por ente + juízo; grupos ordenados pelo mês mais antigo do período (o mais urgente
// primeiro), itens idem. Desempates por nome e id, para a ordem ser sempre a mesma.
export function agrupar(itens) {
  const mapa = new Map();
  for (const item of [...itens].sort(porInicioDepoisNome)) {
    const chave = `${item.ente.chave}||${item.juizo.chave}`;
    if (!mapa.has(chave)) mapa.set(chave, { itens: [], variantes: new Map() });
    const g = mapa.get(chave);
    g.itens.push(item);
    if (item.ente.nome) g.variantes.set(item.ente.nome, (g.variantes.get(item.ente.nome) || 0) + 1);
  }
  const grupos = [...mapa.values()].map(({ itens: lista, variantes }) => {
    const primeiro = lista[0];
    const nomeEnte = primeiro.ente.fonte_oficial
      ? primeiro.ente.nome
      : [...variantes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))[0]?.[0] ?? null;
    return {
      ente: { nome: nomeEnte || 'Sem polo passivo', fonte_oficial: primeiro.ente.fonte_oficial },
      juizo: { ...primeiro.juizo },
      total: lista.length,
      ciclo_inicio_mais_antigo: primeiro.periodo.inicio,
      meses_total: somar(lista, 'meses'),
      meses_mais_5_anos_total: somar(lista, 'meses_mais_5_anos'),
      revisao_humana: lista.filter(i => i.revisao_humana).length,
      flags: contarFlags(lista),
      itens: lista,
    };
  });
  return grupos.sort((a, b) => {
    const ia = indiceMes(a.ciclo_inicio_mais_antigo);
    const ib = indiceMes(b.ciclo_inicio_mais_antigo);
    if (ia !== ib) {
      if (ia === null) return 1;
      if (ib === null) return -1;
      return ia - ib;
    }
    return a.ente.nome.localeCompare(b.ente.nome, 'pt-BR') || a.juizo.rotulo.localeCompare(b.juizo.rotulo, 'pt-BR');
  });
}

export function montarSecao(itens) {
  const grupos = agrupar(itens);
  return {
    total: itens.length,
    grupos_total: grupos.length,
    ciclo_inicio_mais_antigo: grupos[0]?.ciclo_inicio_mais_antigo ?? null,
    meses_total: somar(itens, 'meses'),
    meses_mais_5_anos_total: somar(itens, 'meses_mais_5_anos'),
    itens_com_meses_acima_5_anos: itens.filter(i => (i.periodo.meses_mais_5_anos ?? 0) > 0).length,
    revisao_humana: itens.filter(i => i.revisao_humana).length,
    completaram_intervalo: itens.filter(i => i.periodo.intervalo_completo === true).length,
    ainda_nao_completaram_intervalo: itens.filter(i => i.flags.includes('intervalo_da_tese_incompleto')).length,
    flags: contarFlags(itens),
    grupos,
  };
}

// ───────────────────────────── Documentação (seção c) ─────────────────────────────

export const CATEGORIAS_DOCUMENTOS_AM = ['pessoais', 'vinculo', 'procuracao', 'outro'];
export const CATEGORIAS_EXIGIDAS_TESE = ['identidade', 'cpf', 'residencia', 'contracheque'];

export function montarDocumentacao(itens, linhasDocumentos) {
  const docsPorCliente = new Map();
  for (const d of linhasDocumentos) {
    if (!docsPorCliente.has(d.cliente_id)) docsPorCliente.set(d.cliente_id, []);
    docsPorCliente.get(d.cliente_id).push({
      categoria: d.categoria, quantidade: Number(d.quantidade) || 0,
      primeiro_registro: d.primeiro_registro || null, ultimo_registro: d.ultimo_registro || null,
    });
  }

  const clientes = new Map();
  for (const item of itens) {
    const id = item.cliente.id || `sem-cliente:${item.tarefa_id}`;
    if (!clientes.has(id)) {
      const categorias = docsPorCliente.get(item.cliente.id) || [];
      clientes.set(id, {
        cliente_id: item.cliente.id,
        nome: item.cliente.nome,
        cpf_mascarado: item.cliente.cpf_mascarado,
        pasta_drive_vinculada: item.pasta_drive_vinculada,
        documentos_registrados_no_am: {
          total: categorias.reduce((s, c) => s + c.quantidade, 0),
          por_categoria: categorias,
        },
        exigidos_pela_tese: [],
        tarefas: [],
      });
    }
    const c = clientes.get(id);
    c.tarefas.push({ tarefa_id: item.tarefa_id, secao: item.secao, tese: item.tese.nome });
    if (!c.exigidos_pela_tese.some(e => e.tese === item.tese.nome)) {
      const exigidos = item._documentosExigidos;
      c.exigidos_pela_tese.push({ tese: item.tese.nome, categorias: Array.isArray(exigidos) && exigidos.length ? exigidos : null });
    }
  }
  const lista = [...clientes.values()].sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));

  const tesesCom = new Set();
  const tesesSem = new Set();
  for (const c of lista) for (const e of c.exigidos_pela_tese) (e.categorias ? tesesCom : tesesSem).add(e.tese);

  return {
    regra_de_atualizacao: {
      definida: false,
      situacao: 'pendente',
      explicacao: 'Ainda não existe regra de quais documentos precisam ser atualizados para um re-protocolo '
        + '(será derivada das emendas à inicial por juízo). Este levantamento NÃO afirma que algum documento '
        + 'está vencido, válido ou faltando — só mostra o que o AM tem registrado.',
    },
    limitacoes: [
      'Documentos de clientes antigos ficam em pastas do Drive que não estão necessariamente registradas na tabela `documentos`: ausência de registro no AM não significa ausência do documento.',
      'As datas são de REGISTRO no AM, não de emissão do documento.',
      `documentos.categoria (${CATEGORIAS_DOCUMENTOS_AM.join('/')}) e produtos.documentos_exigidos (${CATEGORIAS_EXIGIDAS_TESE.join('/')}) usam vocabulários diferentes, sem correspondência 1:1 — o levantamento não compara um com o outro.`,
      'Nenhuma pasta do Drive é aberta ou listada por este levantamento: "pasta vinculada" só diz que existe o ID da pasta no cadastro.',
    ],
    totais: {
      clientes: lista.length,
      com_pasta_drive: lista.filter(c => c.pasta_drive_vinculada).length,
      sem_pasta_drive: lista.filter(c => !c.pasta_drive_vinculada).length,
      com_documentos_registrados_no_am: lista.filter(c => c.documentos_registrados_no_am.total > 0).length,
      documentos_registrados_no_am: lista.reduce((s, c) => s + c.documentos_registrados_no_am.total, 0),
      teses_com_checklist: [...tesesCom].sort(),
      teses_sem_checklist: [...tesesSem].sort(),
    },
    clientes: lista,
  };
}

// ───────────────────────────── Carga ─────────────────────────────

export async function carregarItens({ conexao = db, podeVerRestrito = false, tarefaId = null, hoje = null } = {}) {
  const dia = hoje || (await conexao.queryOne(SQL_HOJE))?.hoje;
  if (!indiceMes(dia)) throw new Error('Não foi possível determinar a data de referência.');
  const linhas = tarefaId
    ? await conexao.query(sqlItens({ porTarefa: true }), [tarefaId])
    : await conexao.query(sqlItens());
  return { hoje: dia, itens: linhas.map(r => montarItem(r, { hoje: dia, podeVerRestrito })) };
}

export async function levantarReprotocolo({ conexao = db, podeVerRestrito = false, hoje = null } = {}) {
  const { hoje: dia, itens } = await carregarItens({ conexao, podeVerRestrito, hoje });
  const adiados = await conexao.queryOne(SQL_ADIADOS);
  const clienteIds = [...new Set(itens.map(i => i.cliente.id).filter(Boolean))];
  const documentos = clienteIds.length ? await conexao.query(SQL_DOCUMENTOS, [clienteIds]) : [];
  return {
    hoje: dia,
    itens,
    ciclos_adiados_fora_da_fila: Number(adiados?.adiados ?? 0),
    documentos,
  };
}

// ───────────────────────────── Formato de resposta ─────────────────────────────

function casaEnte(grupo, filtro) {
  if (!filtro) return true;
  const alvo = normalizarTexto(filtro);
  return normalizarTexto(grupo.ente.nome).includes(alvo) || normalizarTexto(grupo.juizo.rotulo).includes(alvo);
}

// secao: 'todas' | 'prontos' | 'aguardando'; detalhe: 'resumo' | 'itens'.
// Os totais de cada seção são SEMPRE da fila inteira (são eles que batem com a tela de Tarefas);
// `ente` e `limite` só recortam a lista de grupos/itens devolvida.
export function formatarLevantamento(bruto, { secao = 'todas', detalhe = 'itens', limite = 200, ente = '' } = {}) {
  const incluir = {
    [SECAO_PRONTOS]: secao === 'todas' || secao === 'prontos',
    [SECAO_AGUARDANDO]: secao === 'todas' || secao === 'aguardando',
  };
  const itensIncluidos = bruto.itens.filter(i => incluir[i.secao]);
  const clientesListados = new Set();

  const secaoFormatada = (nome) => {
    if (!incluir[nome]) return undefined;
    const { grupos, ...totais } = montarSecao(bruto.itens.filter(i => i.secao === nome));
    const filtrados = grupos.filter(g => casaEnte(g, ente));
    let restantes = limite; // limite vale por seção
    let listados = 0;
    let omitidos = 0;
    const saidaGrupos = filtrados.map(({ itens, ...g }) => {
      if (detalhe !== 'itens') return g;
      const cabe = Math.max(0, Math.min(itens.length, restantes));
      restantes -= cabe;
      listados += cabe;
      omitidos += itens.length - cabe;
      const visiveis = itens.slice(0, cabe);
      for (const i of visiveis) clientesListados.add(i.cliente.id || `sem-cliente:${i.tarefa_id}`);
      return { ...g, itens: visiveis, itens_omitidos: itens.length - cabe };
    });
    const resultado = { ...totais, grupos: saidaGrupos };
    if (ente) resultado.filtro_ente = { termo: ente, grupos: filtrados.length, itens: filtrados.reduce((s, g) => s + g.total, 0) };
    if (detalhe === 'itens') Object.assign(resultado, { itens_listados: listados, itens_omitidos: omitidos });
    if (nome === SECAO_AGUARDANDO) resultado.ciclos_adiados_fora_da_fila = bruto.ciclos_adiados_fora_da_fila;
    return resultado;
  };
  const prontos = secaoFormatada(SECAO_PRONTOS);
  const aguardando = secaoFormatada(SECAO_AGUARDANDO);

  // Totais da documentação = todas as seções incluídas; a lista de clientes acompanha os itens
  // efetivamente listados (filtro de ente / limite), para não despejar o cadastro inteiro.
  const documentacao = montarDocumentacao(itensIncluidos, bruto.documentos);
  if (detalhe !== 'itens') delete documentacao.clientes;
  else documentacao.clientes = documentacao.clientes.filter(c => clientesListados.has(c.cliente_id || `sem-cliente:${c.tarefas[0].tarefa_id}`));

  const janela = calcularPeriodo({ cicloInicio: bruto.hoje, vinculoAtivo: true, hoje: bruto.hoje });
  return {
    ok: true,
    somente_leitura: true,
    referencia: {
      hoje: bruto.hoje,
      primeiro_mes_dentro_5_anos: janela.primeiro_mes_dentro_5_anos,
      convencao_5_anos: `Janela das últimas ${MESES_JANELA_QUINQUENAL} competências, incluindo o mês atual (a mesma da referência oficial de Estimativas). Indicador de risco para revisão humana, não é análise jurídica de prescrição.`,
    },
    regras: {
      prontos: 'Fila "Re-protocolo" da tela de Tarefas: protocolar sem processo, com ciclo_inicio, subtipo diferente de ciclo, não concluída/cancelada.',
      aguardando_autorizacao: 'Fila "Novos ciclos": protocolar subtipo ciclo, não concluída/cancelada, fora do adiamento.',
      ente: 'Polo passivo com a prioridade da tela de Tarefas: processo > vínculo ativo único > cadastro do cliente > padrão da tese. Agrupamento tolera grafias diferentes do mesmo ente.',
      juizo: 'Vara registrada no processo anterior (mesmo cliente e tese, maior período fim — o mesmo que o cron usa para iniciar o ciclo). É a localização ATUAL do processo: gabinete/núcleo de cumprimento vem com aviso, não é o juízo de origem.',
      periodo: 'ciclo_inicio → mês atual, ou → data de fim do vínculo quando encerrado (clientes.vinculo_ativo=false). A tela de Tarefas conta sempre até o mês atual. "completa_intervalo_em" usa a mesma conta do cron (início + intervalo da tese − 1).',
      flags: FLAGS,
      revisao_humana: FLAGS_REVISAO_HUMANA,
    },
    prontos,
    aguardando_autorizacao: aguardando,
    documentacao,
  };
}
