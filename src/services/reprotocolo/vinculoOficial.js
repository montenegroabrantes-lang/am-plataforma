// Conferência do vínculo na fonte oficial, SOB DEMANDA, para UMA tarefa de re-protocolo.
//
// Reaproveita buscarReferenciaEstadual (a mesma usada pela aba Estimativas: API de Dados Abertos
// da Paraíba e Pentaho do Portal da Transparência de Pernambuco, cache de 6h, lotes de 5). Só
// existe fonte integrada para Estado da Paraíba e Estado de Pernambuco; para qualquer outro ente
// a resposta é "sem fonte oficial integrada". Nunca rodar em massa sobre a fila inteira — é API
// pública do governo; a rota tem limite de taxa e a ferramenta do chat aceita no máximo 5 casos.
//
// Somente leitura: não grava nada no AM nem aprova valor. O resultado é referência para
// conferência humana.
import { db } from '../../db/index.js';
import { buscarReferenciaEstadual, ReferenciaEstadualError, detectarUfEstadual } from '../remuneracaoEstadual.js';
import { carregarItens, indiceMes } from './levantamento.js';
import { MESES_JANELA_QUINQUENAL } from './regras.js';

function indiceCompetencia(texto) {
  const m = String(texto || '').match(/^(\d{1,2})\/(\d{4})$/);
  return m ? Number(m[2]) * 12 + Number(m[1]) - 1 : null;
}

const arredondar = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

// Órgão enviado à consulta: o do vínculo quando ele já identifica o estado (melhora a
// compatibilidade); senão, acrescenta o nome do ente para a fonte certa ser escolhida.
export function orgaoParaConsulta(orgaoVinculo, ente) {
  const orgao = String(orgaoVinculo || '').trim();
  if (orgao && detectarUfEstadual(orgao) === ente.fonte_oficial) return orgao;
  return orgao ? `${orgao} — ${ente.nome}` : ente.nome;
}

export function resumirVinculoOficial(vinculo, { janelaIdx, fimConsultaIdx }) {
  const competencias = Array.isArray(vinculo.competencias) ? vinculo.competencias : [];
  const comPagamento = competencias.filter(c => Number(c.remuneracao) > 0);
  const ultimaPaga = comPagamento.at(-1)?.competencia ?? null;
  const idxUltimaPaga = indiceCompetencia(ultimaPaga);
  // Parte da referência que deixa a janela de 5 anos nos próximos 12 meses sem ajuizamento.
  const saindo = competencias
    .filter(c => { const i = indiceCompetencia(c.competencia); return i !== null && i <= janelaIdx + 11; })
    .reduce((s, c) => s + (Number(c.remuneracao) || 0), 0);
  return {
    cargo: vinculo.cargo || null,
    orgao: vinculo.orgao || null,
    regime: vinculo.regime || null,
    admissao: vinculo.admissao || null,
    competencias_localizadas: vinculo.competencias_localizadas,
    primeira_competencia: vinculo.mesesInicio || null,
    ultima_competencia: vinculo.mesesFim || null,
    ultima_competencia_com_pagamento: ultimaPaga,
    meses_sem_pagamento_ate_o_fim_da_consulta: idxUltimaPaga === null || fimConsultaIdx === null
      ? null : Math.max(0, fimConsultaIdx - idxUltimaPaga),
    compatibilidade: vinculo.compatibilidade,
    total_remuneracao_oficial: vinculo.total_remuneracao_oficial,
    referencia_8pct: vinculo.referencia_fgts_8pct,
    referencia_8pct_saindo_da_janela_em_12_meses: arredondar(saindo * 0.08),
  };
}

// Devolve null quando a tarefa não está em nenhuma das duas filas (a rota responde 404).
export async function conferirVinculoOficial(tarefaId, {
  conexao = db, podeVerRestrito = false, buscar = buscarReferenciaEstadual, forcar = false, hoje = null,
} = {}) {
  const { hoje: dia, itens } = await carregarItens({ conexao, podeVerRestrito, tarefaId, hoje });
  const item = itens[0];
  if (!item) return null;

  const base = {
    ok: true,
    somente_leitura: true,
    tarefa_id: item.tarefa_id,
    secao: item.secao,
    cliente: { nome: item.cliente.nome, cpf_mascarado: item.cliente.cpf_mascarado },
    tese: item.tese.nome,
    ente: { nome: item.ente.nome, informado: item.ente.informado, origem: item.ente.origem, fonte_oficial: item.ente.fonte_oficial },
    periodo_no_am: item.periodo,
    vinculo_no_am: {
      situacao: item.vinculo.situacao, fim: item.vinculo.fim, cargo: item.vinculo.cargo,
      orgao: item.vinculo.orgao, qtd_vinculos_ativos: item.vinculo.qtd_vinculos_ativos,
    },
    flags: item.flags,
  };

  if (!item.ente.fonte_oficial) {
    return {
      ...base, status: 'sem_fonte_oficial',
      mensagem: `Sem fonte oficial integrada para ${item.ente.nome || 'este ente (polo passivo não definido)'}. `
        + 'A conferência automática cobre apenas Estado da Paraíba e Estado de Pernambuco.',
    };
  }
  if (item.ente.origem === 'padrao_tese') {
    return {
      ...base, status: 'ente_nao_confirmado',
      mensagem: 'O ente veio só do padrão da tese (menu de opções), não do cadastro do cliente. Confirme o polo passivo antes de consultar a fonte oficial.',
    };
  }
  if (item.periodo.meses === 0) {
    return { ...base, status: 'periodo_sem_meses', mensagem: 'Não há período acumulado a conferir (início futuro ou vínculo encerrado antes do início).' };
  }
  const hojeIdx = indiceMes(dia);
  const janelaIdx = hojeIdx - (MESES_JANELA_QUINQUENAL - 1);
  if (item.periodo.fim && indiceMes(item.periodo.fim) < janelaIdx) {
    return {
      ...base, status: 'periodo_todo_acima_5_anos',
      mensagem: 'Todo o período é anterior às últimas 60 competências; a fonte oficial integrada só é consultada dentro dessa janela.',
    };
  }

  let resultado;
  try {
    resultado = await buscar({
      nome: item.cliente.nome,
      cargo: item.vinculo.cargo || '',
      orgao: orgaoParaConsulta(item.vinculo.orgao, item.ente),
      inicio: item.periodo.inicio || '',
      fim: item.periodo.fim || '',
      forcar,
      agora: new Date(`${dia}T12:00:00Z`),
    });
  } catch (err) {
    // 422 = pedido inviável (nome incompleto, período sem competência válida): resposta de negócio.
    // Fonte fora do ar (502) e erros inesperados sobem para a rota.
    if (err instanceof ReferenciaEstadualError && err.status === 422) {
      return { ...base, status: 'nao_consultavel', mensagem: err.message };
    }
    throw err;
  }

  const fimConsultaIdx = indiceCompetencia(resultado.periodo_consultado?.fim);
  const vinculos = (resultado.vinculos || []).map((v, i) => ({ ordem: i + 1, ...resumirVinculoOficial(v, { janelaIdx, fimConsultaIdx }) }));
  const melhor = vinculos[0] || null;
  return {
    ...base,
    status: resultado.status,
    uf: resultado.uf,
    fonte: { nome: resultado.fonte_nome, url: resultado.fonte_url },
    cache: Boolean(resultado.cache),
    periodo_consultado: resultado.periodo_consultado,
    vinculos_encontrados: vinculos,
    valor_em_risco_referencia: melhor ? {
      referencia_8pct: melhor.referencia_8pct,
      saindo_da_janela_em_12_meses: melhor.referencia_8pct_saindo_da_janela_em_12_meses,
      base: 'Vínculo de maior compatibilidade: 8% da remuneração oficial localizada no período, dentro das últimas 60 competências.',
    } : null,
    aviso: [
      resultado.aviso,
      'Busca por nome exato: homônimos são possíveis — confira cargo, órgão e admissão.',
      'Mês sem registro não prova que o vínculo terminou (a fonte pode atrasar a publicação).',
    ].filter(Boolean).join(' '),
  };
}
