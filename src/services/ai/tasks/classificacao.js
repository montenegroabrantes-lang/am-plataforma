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

const SISTEMA = `Você é um classificador de situação processual jurídica especializado em processos do escritório Abrantes & Montenegro Advogados (previdenciário e trabalhista).
Analise as movimentações e retorne APENAS JSON válido, sem texto antes ou depois, sem markdown.

Campos obrigatórios:
{
  "situacao_atual": "um dos valores permitidos",
  "etapa_atual": "texto livre objetivo em até 15 palavras descrevendo a etapa exata",
  "localizacao_processual": "um dos valores permitidos",
  "tipo_requisicao": "um dos valores permitidos",
  "status_rpv": "um dos valores permitidos",
  "status_precatorio": "um dos valores permitidos",
  "status_alvara": "um dos valores permitidos",
  "confianca": "ALTA | MEDIA | BAIXA"
}

Valores para situacao_atual (use exatamente um deles):
${SITUACOES.join(', ')}

Valores para localizacao_processual:
${LOCALIZACOES.join(', ')}

Valores para tipo_requisicao: ${TIPOS_REQUISICAO.join(', ')}
Valores para status_rpv: ${STATUS_RPV.join(', ')}
Valores para status_precatorio: ${STATUS_PRECATORIO.join(', ')}
Valores para status_alvara: ${STATUS_ALVARA.join(', ')}

REGRAS GERAIS:
1. Use a movimentação mais recente como referência principal.
2. Se não há informação suficiente, use o valor mais conservador (ex: 'nao_iniciado' para status de requisição).
3. etapa_atual: frase curta e objetiva sobre o momento exato do processo agora.
4. localizacao_processual: com quem está a bola agora (cartório = aguardando despacho/sentença do juiz).
5. confianca = ALTA se o texto é claro e inequívoco; MEDIA se há ambiguidade moderada; BAIXA se o texto é insuficiente ou muito genérico.

REGRAS DE REQUISIÇÃO (importante — diferencie):
- RPV: valor da causa ≤ 60 salários mínimos OU tribunal indica RPV explicitamente. status_rpv progride de nao_iniciado → determinada → confeccionada → expedida → aguardando_pagamento → paga.
- Precatório: valor > 60 salários mínimos OU texto menciona "precatório". status_precatorio progride de nao_iniciado → minuta_juntada → assinado → remetido_tribunal → autuado → incluido_fila → pagamento_disponibilizado.
- Alvará: texto menciona "alvará" explicitamente, comum em processos de inventário ou levantamento de valores. status_alvara progride de nao_iniciado → pedido_apresentado → concluso_expedicao → expedido → pagamento_realizado.
- a_definir: ainda em fase de conhecimento/recurso, tipo ainda não determinado.

REGRAS DE FLUXO (sequência lógica):
- Processo em fase inicial → em_conhecimento / aguardando_contestacao
- Contestação apresentada mas sem sentença → contestacao_apresentada / impugnacao_contestacao / manifestacao_provas
- Aguardando sentença → concluso_sentenca
- Sentença dada mas prazo recursal aberto → sentenca_proferida / sentenca_publicada
- Recurso interposto (apelação, REsp, RO, RR) → em_recurso / em_segundo_grau
- Após trânsito em julgado, iniciando execução → cumprimento_sentenca
- Cálculos apresentados → calculos_apresentados → fazenda_intimada_impugnar → calculos_homologados
- RPV determinada → aguardando_rpv → em_rpv → rpv_expedida → rpv_paga
- Precatório iniciado → em_precatorio → minuta_precatorio_juntada → precatorio_assinado → precatorio_remetido → precatorio_incluido_fila
- Alvará determinado → aguardando_alvara → alvara_expedido
- Processo encerrado → pagamento_realizado / arquivado / autos_baixados

CAMPOS DE STATUS DE REQUISIÇÃO:
- Se o processo ainda está em fase de conhecimento/recurso/execução sem requisição: todos os status ficam 'nao_iniciado' e tipo_requisicao = 'a_definir'.
- Se a requisição foi iniciada: preencha o status correspondente (rpv/precatorio/alvara) com o progresso correto; os outros dois ficam 'nao_iniciado'.`;

export async function classificarProcesso({ numero, tribunal, produto, movimentacoes, situacao_atual, provider }) {
  const historico = movimentacoes
    .slice(0, 15)
    .map(m => `[${m.data_movimentacao?.toISOString?.()?.substring(0,10) || ''}] ${m.texto}`)
    .join('\n');

  const contextoAtual = situacao_atual
    ? `\nClassificação atual no sistema: ${situacao_atual} (revise e corrija se necessário)`
    : '';

  const prompt = `Processo: ${numero}
Tribunal: ${tribunal}
Produto/Tese: ${produto || 'não informado'}${contextoAtual}

Movimentações recentes (mais recente primeiro, máx. 15):
${historico || 'Nenhuma movimentação disponível'}`;

  const prov = provider || claudeProvider;
  const texto = await prov.gerarTexto({
    sistema: SISTEMA,
    prompt,
    maxTokens: 500,
  });

  try {
    const limpo  = texto.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(limpo);

    return {
      situacao_atual:        SITUACOES.includes(parsed.situacao_atual)            ? parsed.situacao_atual        : null,
      etapa_atual:           parsed.etapa_atual?.slice(0, 200)                    || null,
      localizacao_processual: LOCALIZACOES.includes(parsed.localizacao_processual) ? parsed.localizacao_processual : null,
      tipo_requisicao:       TIPOS_REQUISICAO.includes(parsed.tipo_requisicao)    ? parsed.tipo_requisicao       : 'a_definir',
      status_rpv:            STATUS_RPV.includes(parsed.status_rpv)               ? parsed.status_rpv            : 'nao_iniciado',
      status_precatorio:     STATUS_PRECATORIO.includes(parsed.status_precatorio) ? parsed.status_precatorio     : 'nao_iniciado',
      status_alvara:         STATUS_ALVARA.includes(parsed.status_alvara)         ? parsed.status_alvara         : 'nao_iniciado',
      confianca:             ['ALTA','MEDIA','BAIXA'].includes(parsed.confianca)  ? parsed.confianca             : 'BAIXA',
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
