import { claudeProvider } from '../providers/claude.js';
import { openaiProvider } from '../providers/openai.js';

export const SITUACOES = [
  'em_conhecimento','aguardando_contestacao','contestacao_apresentada',
  'impugnacao_contestacao','manifestacao_provas','concluso_sentenca',
  'sentenca_proferida','sentenca_publicada','em_recurso','em_segundo_grau',
  'aguardando_baixa','autos_baixados','cumprimento_sentenca',
  'calculos_apresentados','fazenda_intimada_impugnar',
  'impugnacao_fazenda_apresentada','calculos_homologados',
  'aguardando_rpv','em_rpv','rpv_expedida','rpv_paga',
  'em_precatorio','minuta_precatorio_juntada','precatorio_assinado',
  'precatorio_remetido','precatorio_incluido_fila',
  'aguardando_alvara','alvara_expedido','pagamento_realizado','arquivado',
];

export const LOCALIZACOES = [
  'parado_cartorio','parado_gabinete','parado_tribunal',
  'aguardando_fazenda','aguardando_parte_autora','aguardando_parte_contraria',
  'aguardando_orgao_publico','aguardando_banco','aguardando_pagamento','aguardando_baixa',
];

export const STATUS_RPV        = ['nao_iniciado','determinada','confeccionada','expedida','aguardando_pagamento','paga'];
export const STATUS_PRECATORIO = ['nao_iniciado','minuta_juntada','assinado','remetido_tribunal','autuado','incluido_fila','pagamento_disponibilizado'];
export const STATUS_ALVARA     = ['nao_iniciado','pedido_apresentado','concluso_expedicao','expedido','pagamento_realizado','conferido'];
export const TIPOS_REQUISICAO  = ['rpv','precatorio','alvara','a_definir'];

const SISTEMA = `Você é um classificador de situação processual para o escritório Abrantes & Montenegro Advogados.
Analise as movimentações e retorne APENAS JSON válido, sem texto antes ou depois, sem markdown.

Campos obrigatórios:
{
  "situacao_atual": "um dos valores permitidos",
  "etapa_atual": "texto livre objetivo em até 12 palavras descrevendo a etapa exata",
  "localizacao_processual": "um dos valores permitidos",
  "tipo_requisicao": "um dos valores permitidos",
  "status_rpv": "um dos valores permitidos",
  "status_precatorio": "um dos valores permitidos",
  "status_alvara": "um dos valores permitidos",
  "confianca": "ALTA | MEDIA | BAIXA"
}

Valores permitidos para situacao_atual:
${SITUACOES.join(', ')}

Valores permitidos para localizacao_processual:
${LOCALIZACOES.join(', ')}

Valores para tipo_requisicao: ${TIPOS_REQUISICAO.join(', ')}
Valores para status_rpv: ${STATUS_RPV.join(', ')}
Valores para status_precatorio: ${STATUS_PRECATORIO.join(', ')}
Valores para status_alvara: ${STATUS_ALVARA.join(', ')}

Regras:
1. Use a movimentação mais recente como referência principal.
2. Se não há informação suficiente para determinar um campo, use o valor mais conservador (ex: 'nao_iniciado' para status).
3. etapa_atual deve ser uma frase curta e objetiva sobre o momento exato do processo.
4. localizacao_processual indica com quem está a bola agora.
5. confianca = ALTA se o texto é claro; MEDIA se há ambiguidade; BAIXA se o texto é insuficiente.`;

export async function classificarProcesso({ numero, tribunal, produto, movimentacoes, provider }) {
  const historico = movimentacoes
    .slice(0, 8)
    .map(m => `[${m.data_movimentacao?.toISOString?.()?.substring(0,10) || ''}] ${m.texto}`)
    .join('\n');

  const prompt = `Processo: ${numero}
Tribunal: ${tribunal}
Produto/Ação: ${produto || 'não informado'}

Movimentações recentes (mais recente primeiro):
${historico || 'Nenhuma movimentação disponível'}`;

  const prov = provider || claudeProvider;
  const texto = await prov.gerarTexto({
    sistema: SISTEMA,
    prompt,
    maxTokens: 400,
  });

  try {
    const limpo  = texto.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(limpo);

    return {
      situacao_atual:        SITUACOES.includes(parsed.situacao_atual)           ? parsed.situacao_atual        : null,
      etapa_atual:           parsed.etapa_atual?.slice(0, 200)                   || null,
      localizacao_processual: LOCALIZACOES.includes(parsed.localizacao_processual) ? parsed.localizacao_processual : null,
      tipo_requisicao:       TIPOS_REQUISICAO.includes(parsed.tipo_requisicao)   ? parsed.tipo_requisicao       : 'a_definir',
      status_rpv:            STATUS_RPV.includes(parsed.status_rpv)              ? parsed.status_rpv            : 'nao_iniciado',
      status_precatorio:     STATUS_PRECATORIO.includes(parsed.status_precatorio)? parsed.status_precatorio     : 'nao_iniciado',
      status_alvara:         STATUS_ALVARA.includes(parsed.status_alvara)        ? parsed.status_alvara         : 'nao_iniciado',
      confianca:             ['ALTA','MEDIA','BAIXA'].includes(parsed.confianca) ? parsed.confianca             : 'BAIXA',
    };
  } catch {
    return {
      situacao_atual: null, etapa_atual: null, localizacao_processual: null,
      tipo_requisicao: 'a_definir', status_rpv: 'nao_iniciado',
      status_precatorio: 'nao_iniciado', status_alvara: 'nao_iniciado',
      confianca: 'BAIXA',
    };
  }
}
