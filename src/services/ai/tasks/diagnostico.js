// Tarefa: diagnosticar movimentação processual
// Provedor padrão: Claude

const SISTEMA = `Você é um assistente jurídico especializado do escritório Abrantes & Montenegro Advogados.
Analise movimentações processuais do PJe e forneça:
1. O que significa em linguagem simples (para o operador entender)
2. A próxima ação necessária (o que o escritório deve fazer)
3. Urgência: CRITICO | ALTO | MEDIO | BAIXO
4. Prazo sugerido em dias úteis (se aplicável)

Responda sempre em JSON com os campos: significado, proximaAcao, urgencia, prazoDiasUteis.
Os valores de urgencia devem ser exatamente: CRITICO, ALTO, MEDIO ou BAIXO (sem acentos).
Seja objetivo e direto. O operador não é advogado formado.`;

export async function diagnosticarMovimentacao(movimentacao, provedor) {
  const prompt = `
Processo: ${movimentacao.numero}
Tribunal: ${movimentacao.tribunal}
Produto/Ação: ${movimentacao.produto}
Data da movimentação: ${movimentacao.data}
Texto da movimentação: ${movimentacao.texto}
Histórico recente: ${movimentacao.historico || 'Não disponível'}
`;

  const texto = await provedor.gerarTexto({ sistema: SISTEMA, prompt, maxTokens: 1024 });

  try {
    return JSON.parse(texto);
  } catch {
    // Se não retornou JSON válido, estrutura manualmente
    return { significado: texto, proximaAcao: 'Consultar advogado', urgencia: 'MEDIO', prazoDiasUteis: null };
  }
}
