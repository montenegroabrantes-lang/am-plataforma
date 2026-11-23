import { paginacaoSegura } from '../utils/validacao.js';

// Leitura de processos para integrações externas (folha de despachos e painel financeiro).
// Devolve só o necessário: nada de nome, CPF ou contato do cliente, e nunca processo restrito.

const STATUS_VALIDOS = new Set(['ativo', 'suspenso', 'encerrado', 'arquivado']);

// Andamentos que não mostram impulso real do processo e por isso não zeram os "dias parado".
// Andamentos que não indicam movimento real do processo (texto do PJe e do DataJud).
export const MOVIMENTOS_AUTOMATICOS = [
  'decorrido prazo',
  'decurso de prazo',
  'publicado',
  'publica[cç][aã]o',
  'disponibilizado',
  'disponibiliza[cç][aã]o',
  'provimento correcional',
  'expedi[cç][aã]o de outros',
  'expedi[cç][aã]o de documento',
  'retificado o movimento',
  'processo encaminhado',
  'inclus[aã]o no ju[ií]zo',
  'autos inclu[ií]dos no ju[ií]zo',
  'certid[aã]o autom[aá]tica',
  'confirmada a intima[cç][aã]o',
  'expedida/certificada a comunica[cç][aã]o',
].join('|');

const MS_POR_DIA = 86_400_000;
const MOVIMENTOS_NO_HISTORICO = 60;
const LIMITE_MAXIMO_COM_HISTORICO = 100;

export function exigePermissao(permissao) {
  return (req, res, next) => (req.integracao?.permissoes?.includes(permissao)
    ? next()
    : res.status(403).json({ ok: false, erro: `Esta chave não possui a permissão “${permissao}”.` }));
}

export function montarConsultaProcessos({ status, pagina, limite, historico } = {}) {
  if (status !== undefined && !STATUS_VALIDOS.has(status)) {
    return { erro: 'Status inválido. Use ativo, suspenso, encerrado ou arquivado.' };
  }
  const comHistorico = historico === '1' || historico === 'true';
  const paginacao = comHistorico
    ? paginacaoSegura(pagina, limite ?? LIMITE_MAXIMO_COM_HISTORICO, LIMITE_MAXIMO_COM_HISTORICO)
    : paginacaoSegura(pagina, limite ?? 100);
  const colunaHistorico = comHistorico ? `,
           COALESCE(hist.itens, '[]'::json) AS movimentacoes` : '';
  const juncaoHistorico = comHistorico ? `
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object('data', h.data_movimentacao, 'texto', h.texto)
                        ORDER BY h.data_movimentacao DESC) AS itens
          FROM (
            SELECT m.data_movimentacao, LEFT(m.texto, 200) AS texto
              FROM movimentacoes m
             WHERE m.processo_id = p.id
             ORDER BY m.data_movimentacao DESC
             LIMIT ${MOVIMENTOS_NO_HISTORICO}
          ) h
      ) hist ON true` : '';
  const filtros = status === undefined ? [] : [status];
  const where = `p.visibilidade = 'normal'${status === undefined ? '' : ' AND p.status = $1'}`;

  const padrao = filtros.length + 1;
  const sqlItens = `
    SELECT p.numero, p.tribunal, p.grau, p.vara,
           p.acervo, p.acervo_origem, p.acervo_lido_em,
           p.status, p.etapa_atual, p.situacao_atual, p.localizacao_processual,
           p.tipo_requisicao, p.tipo_execucao, p.status_alvara, p.status_rpv, p.status_precatorio,
           p.data_limite_pagamento, p.polo_passivo,
           p.valor_causa, p.valor_estimativa, p.valor_proposta, p.valor_homologado, p.valor_rpv,
           ultima.data_movimentacao AS ultima_movimentacao_em,
           ultima.texto AS ultima_movimentacao,
           relevante.data_movimentacao AS ultima_movimentacao_relevante_em,
           relevante.texto AS ultima_movimentacao_relevante${colunaHistorico}
      FROM processos p
      LEFT JOIN LATERAL (
        SELECT m.data_movimentacao, LEFT(m.texto, 300) AS texto
          FROM movimentacoes m
         WHERE m.processo_id = p.id
         ORDER BY m.data_movimentacao DESC
         LIMIT 1
      ) ultima ON true
      LEFT JOIN LATERAL (
        SELECT m.data_movimentacao, LEFT(m.texto, 300) AS texto
          FROM movimentacoes m
         WHERE m.processo_id = p.id AND m.texto !~* $${padrao}
         ORDER BY m.data_movimentacao DESC
         LIMIT 1
      ) relevante ON true${juncaoHistorico}
     WHERE ${where}
     ORDER BY p.numero
     LIMIT $${padrao + 1} OFFSET $${padrao + 2}`;

  return {
    sqlItens,
    paramsItens: [...filtros, MOVIMENTOS_AUTOMATICOS, paginacao.limite, paginacao.offset],
    sqlTotal: `SELECT COUNT(*) AS total FROM processos p WHERE ${where}`,
    paramsTotal: filtros,
    pagina: paginacao.pagina,
    limite: paginacao.limite,
  };
}

const numeroOuNulo = valor => (valor === null || valor === undefined ? null : Number(valor));

export function serializarProcesso(linha, agora = new Date()) {
  const referencia = linha.ultima_movimentacao_relevante_em;
  const diasParado = referencia
    ? Math.max(0, Math.floor((agora.getTime() - new Date(referencia).getTime()) / MS_POR_DIA))
    : null;
  return {
    ...linha,
    acervo: linha.acervo || null,
    valor_causa: numeroOuNulo(linha.valor_causa),
    valor_estimativa: numeroOuNulo(linha.valor_estimativa),
    valor_proposta: numeroOuNulo(linha.valor_proposta),
    valor_homologado: numeroOuNulo(linha.valor_homologado),
    valor_rpv: numeroOuNulo(linha.valor_rpv),
    dias_parado: diasParado,
  };
}

export function criarListagemProcessos(conexao, relogio = () => new Date()) {
  return async (req, res) => {
    const consulta = montarConsultaProcessos({
      status: req.query.status,
      pagina: req.query.pagina,
      limite: req.query.limite,
      historico: req.query.historico,
    });
    if (consulta.erro) return res.status(400).json({ ok: false, erro: consulta.erro });
    try {
      const [linhas, [{ total }]] = await Promise.all([
        conexao.query(consulta.sqlItens, consulta.paramsItens),
        conexao.query(consulta.sqlTotal, consulta.paramsTotal),
      ]);
      const agora = relogio();
      return res.json({
        ok: true,
        pagina: consulta.pagina,
        limite: consulta.limite,
        total: Number(total),
        gerado_em: agora.toISOString(),
        processos: linhas.map(linha => serializarProcesso(linha, agora)),
      });
    } catch (err) {
      console.error('[Integrações] Falha ao listar processos:', err.message);
      return res.status(500).json({ ok: false, erro: 'Não foi possível listar os processos.' });
    }
  };
}
