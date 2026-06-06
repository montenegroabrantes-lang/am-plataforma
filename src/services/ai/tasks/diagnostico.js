// Tarefa: classificar movimentação processual em pendência operacional

const TIPOS_PENDENCIA = [
  'PETICIONAR', 'CONFERIR_EXPEDIENTE', 'AGUARDAR_CONCLUSAO', 'PEDIR_CONCLUSAO',
  'AGUARDAR_CITACAO', 'PROVIDENCIAR_CITACAO', 'AGUARDAR_SENTENCA', 'AGUARDAR_ALVARA',
  'CONFERIR_ALVARA', 'AGUARDAR_RPV', 'AGUARDAR_PRECATORIO', 'AGUARDAR_PAGAMENTO',
  'CUMPRIR_DETERMINACAO', 'ANEXAR_DOCUMENTO', 'CORRIGIR_DADOS_BANCARIOS',
  'SEM_PROVIDENCIA_IMEDIATA', 'ERRO_DE_LEITURA',
];

// System prompt ESTÁTICO (sem data interpolada) — condição para o prompt caching
// reaproveitar o prefixo entre chamadas. A data de hoje vai no prompt do usuário.
const SISTEMA = `Você é um classificador operacional de movimentações processuais do escritório Abrantes & Montenegro Advogados.
Sua função é transformar movimentações e expedientes em uma pendência objetiva para o escritório.

Não explique o processo.
Não escreva em tom de atendimento.
Não use markdown.
Não devolva texto longo.
Não invente prazos, partes, pedidos ou documentos.
Não trate botões da interface do PJe como providência jurídica. Exemplos de texto que são botões de UI e devem ser ignorados: "VISUALIZAR ATO", "VALIDAR ASSINATURA DIGITAL", "ASSINAR DIGITALMENTE".

Responda apenas com JSON válido, sem markdown, sem texto antes ou depois.

Campos obrigatórios:
{
  "ultimaMovimentacao": { "data": "AAAA-MM-DD", "descricao": "texto curto" },
  "pendencia": {
    "tipo": "UM_DOS_TIPOS_PERMITIDOS",
    "resumo": "uma frase objetiva",
    "prazoFinal": "AAAA-MM-DDTHH:MM:SS ou null",
    "statusPrazo": "ATIVO | VENCENDO | VENCIDO | null",
    "precisaConferenciaPJe": true
  },
  "prioridade": "CRITICO | ALTO | MEDIO | BAIXO",
  "confianca": "ALTA | MEDIA | BAIXA"
}

Tipos permitidos (use exatamente um destes):
${TIPOS_PENDENCIA.join(', ')}

Regras (a "data de hoje" é informada na primeira linha do input):
1. Se houver expediente com prazo para manifestação → tipo = PETICIONAR.
2. Se houver expediente mas o teor do ato não estiver descrito → precisaConferenciaPJe = true.
3. Se prazoFinal for anterior à data de hoje → statusPrazo = VENCIDO.
4. Se prazoFinal estiver entre a data de hoje e 2 dias à frente → statusPrazo = VENCENDO.
5. Se prazoFinal for posterior a 2 dias da data de hoje → statusPrazo = ATIVO.
6. Se não houver prazoFinal identificável → statusPrazo = null.
7. Se o texto indicar apenas conclusão ao juiz → tipo = AGUARDAR_CONCLUSAO.
8. Se não houver nenhuma providência para o escritório → tipo = SEM_PROVIDENCIA_IMEDIATA.
9. Se o prazo vier como "SIM" ou texto não-data → prazoFinal = null.
10. prioridade = CRITICO se statusPrazo = VENCIDO ou VENCENDO; ALTO se expediente aberto sem prazo iminente; MEDIO para demais pendências ativas; BAIXO se SEM_PROVIDENCIA_IMEDIATA.`;

export async function diagnosticarMovimentacao(movimentacao, provedor) {
  const hoje = new Date().toISOString().substring(0, 10);

  const prompt = `Data de hoje: ${hoje}
Processo: ${movimentacao.numero}
Tribunal: ${movimentacao.tribunal}
Produto/Ação: ${movimentacao.produto || 'não informado'}
Data da movimentação: ${movimentacao.data}
Texto da movimentação: ${movimentacao.texto}
Histórico recente (últimas movimentações):
${movimentacao.historico || 'Não disponível'}`;

  const texto = await provedor.gerarTexto({
    sistema: SISTEMA,
    prompt,
    maxTokens: 512,
  });

  try {
    // Remove possível markdown ```json ... ``` antes de parsear
    const limpo = texto.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(limpo);

    // Garante que os campos críticos existem — fallback seguro
    return {
      ultimaMovimentacao: parsed.ultimaMovimentacao || { data: null, descricao: movimentacao.texto?.slice(0, 80) },
      pendencia: {
        tipo:                 TIPOS_PENDENCIA.includes(parsed.pendencia?.tipo) ? parsed.pendencia.tipo : 'ERRO_DE_LEITURA',
        resumo:               parsed.pendencia?.resumo || null,
        prazoFinal:           parsed.pendencia?.prazoFinal || null,
        statusPrazo:          parsed.pendencia?.statusPrazo || null,
        precisaConferenciaPJe: parsed.pendencia?.precisaConferenciaPJe ?? false,
      },
      prioridade: ['CRITICO','ALTO','MEDIO','BAIXO'].includes(parsed.prioridade) ? parsed.prioridade : 'MEDIO',
      confianca:  ['ALTA','MEDIA','BAIXA'].includes(parsed.confianca) ? parsed.confianca : 'BAIXA',
    };
  } catch {
    return {
      ultimaMovimentacao: { data: null, descricao: movimentacao.texto?.slice(0, 80) },
      pendencia: {
        tipo: 'ERRO_DE_LEITURA', resumo: 'IA não retornou JSON válido.',
        prazoFinal: null, statusPrazo: null, precisaConferenciaPJe: false,
      },
      prioridade: 'MEDIO',
      confianca: 'BAIXA',
    };
  }
}
