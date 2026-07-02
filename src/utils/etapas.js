// Fonte única de verdade para o mapeamento situacao_atual → etapa exibida.
// Antes disso, processos.js e triagem.js tinham cópias divergentes: triagem.js
// não conhecia as etapas mais novas (Citação, Embargos, etc.) e classificava
// esses processos como "Sem classificação", enquanto processos.js mostrava a
// etapa correta — resultado: a mesma situação aparecia diferente em cada tela.

export const ETAPA_WHERE = {
  'Pagamento':               `(p.situacao_atual IN ('rpv_paga','pagamento_realizado') OR p.status_rpv = 'paga' OR p.status_alvara = 'pagamento_realizado')`,
  'Arquivado':               `p.situacao_atual IN ('arquivado','autos_baixados')`,
  'Alvará':                  `(p.tipo_requisicao = 'alvara' OR p.situacao_atual IN ('aguardando_alvara','alvara_expedido'))`,
  'Minuta de Precatório':    `p.situacao_atual = 'minuta_precatorio_juntada'`,
  'Precatório':              `(p.tipo_requisicao = 'precatorio' OR p.situacao_atual IN ('em_precatorio','precatorio_assinado','precatorio_remetido','precatorio_incluido_fila'))`,
  'RPV':                     `(p.tipo_requisicao = 'rpv' OR p.situacao_atual IN ('aguardando_rpv','em_rpv','rpv_expedida'))`,
  'Cumprimento de Sentença': `p.situacao_atual IN ('cumprimento_sentenca','calculos_apresentados','fazenda_intimada_impugnar','impugnacao_fazenda_apresentada','calculos_homologados')`,
  'Recurso':                 `p.situacao_atual IN ('em_recurso','em_segundo_grau','aguardando_baixa')`,
  'Sentença':                `p.situacao_atual IN ('concluso_sentenca','sentenca_proferida','sentenca_publicada')`,
  'Contestação':             `p.situacao_atual IN ('contestacao_apresentada','impugnacao_contestacao','manifestacao_provas')`,
  'Inicial':                 `p.situacao_atual IN ('em_conhecimento','aguardando_contestacao')`,
  'Concluso para Bloqueio':  `p.situacao_atual = 'concluso_para_bloqueio'`,
  'Concluso para Sentença':  `p.situacao_atual = 'concluso_para_sentenca'`,
  'Concluso':                `p.situacao_atual = 'concluso'`,
  'Certidão NUMOPED':        `p.situacao_atual = 'certidao_numoped'`,
  'Sem classificação':       `p.situacao_atual IS NULL`,
  'Citação':                 `p.situacao_atual = 'citacao'`,
  'Impugnada a Contestação': `p.situacao_atual = 'impugnada_contestacao'`,
  'Embargos de Declaração':  `p.situacao_atual = 'embargos_declaracao'`,
  'Impugnado Cumprimento':   `p.situacao_atual = 'impugnado_cumprimento'`,
  'Alvará Assinado':         `p.situacao_atual = 'alvara_assinado'`,
  'Intimado do Bloqueio':    `p.situacao_atual = 'intimado_bloqueio'`,
  'Concluso para Gratuidade':`p.situacao_atual = 'concluso_gratuidade'`,
  'Gratuidade Deferida':     `p.situacao_atual = 'gratuidade_deferida'`,
};

export const ETAPA_CASE = `
  CASE
    WHEN p.situacao_atual IN ('rpv_paga','pagamento_realizado') OR p.status_rpv = 'paga' OR p.status_alvara = 'pagamento_realizado' THEN 'Pagamento'
    WHEN p.situacao_atual IN ('arquivado','autos_baixados') THEN 'Arquivado'
    WHEN p.tipo_requisicao = 'alvara' OR p.situacao_atual IN ('aguardando_alvara','alvara_expedido') THEN 'Alvará'
    WHEN p.situacao_atual = 'minuta_precatorio_juntada' THEN 'Minuta de Precatório'
    WHEN p.tipo_requisicao = 'precatorio' OR p.situacao_atual IN ('em_precatorio','precatorio_assinado','precatorio_remetido','precatorio_incluido_fila') THEN 'Precatório'
    WHEN p.tipo_requisicao = 'rpv' OR p.situacao_atual IN ('aguardando_rpv','em_rpv','rpv_expedida') THEN 'RPV'
    WHEN p.situacao_atual IN ('cumprimento_sentenca','calculos_apresentados','fazenda_intimada_impugnar','impugnacao_fazenda_apresentada','calculos_homologados') THEN 'Cumprimento de Sentença'
    WHEN p.situacao_atual IN ('em_recurso','em_segundo_grau','aguardando_baixa') THEN 'Recurso'
    WHEN p.situacao_atual IN ('concluso_sentenca','sentenca_proferida','sentenca_publicada') THEN 'Sentença'
    WHEN p.situacao_atual IN ('contestacao_apresentada','impugnacao_contestacao','manifestacao_provas') THEN 'Contestação'
    WHEN p.situacao_atual IN ('em_conhecimento','aguardando_contestacao') THEN 'Inicial'
    WHEN p.situacao_atual = 'concluso_para_bloqueio' THEN 'Concluso para Bloqueio'
    WHEN p.situacao_atual = 'concluso_para_sentenca' THEN 'Concluso para Sentença'
    WHEN p.situacao_atual = 'concluso' THEN 'Concluso'
    WHEN p.situacao_atual = 'certidao_numoped' THEN 'Certidão NUMOPED'
    WHEN p.situacao_atual = 'citacao' THEN 'Citação'
    WHEN p.situacao_atual = 'impugnada_contestacao' THEN 'Impugnada a Contestação'
    WHEN p.situacao_atual = 'embargos_declaracao' THEN 'Embargos de Declaração'
    WHEN p.situacao_atual = 'impugnado_cumprimento' THEN 'Impugnado Cumprimento'
    WHEN p.situacao_atual = 'alvara_assinado' THEN 'Alvará Assinado'
    WHEN p.situacao_atual = 'intimado_bloqueio' THEN 'Intimado do Bloqueio'
    WHEN p.situacao_atual = 'concluso_gratuidade' THEN 'Concluso para Gratuidade'
    WHEN p.situacao_atual = 'gratuidade_deferida' THEN 'Gratuidade Deferida'
    ELSE 'Sem classificação'
  END
`;
