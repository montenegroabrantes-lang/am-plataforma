// Tarefa: gerar petição jurídica
// Provedor padrão: Claude

const SISTEMA = `Você é um redator jurídico especializado do escritório Abrantes & Montenegro Advogados.
Redija petições no estilo do escritório: formal, objetivo, fundamentado em lei e jurisprudência.
Use as peças de referência fornecidas para manter o padrão de linguagem do escritório.
Não inclua dados fictícios — use apenas as informações fornecidas.
Retorne apenas o texto da petição, pronto para revisão do advogado.`;

export async function gerarPeticao({ tipo, processo, cliente, pecasReferencia }, provedor) {
  const referencias = pecasReferencia?.length
    ? `\n\nPeças de referência do escritório (use como base de estilo):\n${pecasReferencia.map((p, i) => `--- Referência ${i+1} ---\n${p.trecho}`).join('\n')}`
    : '';

  const prompt = `
Tipo de petição: ${tipo}
Número do processo: ${processo.numero}
Tribunal: ${processo.tribunal}
Vara: ${processo.vara}
Juiz: ${processo.juiz || 'Não informado'}
Réu/Polo passivo: ${processo.polo_passivo}
Autor/Cliente: ${cliente.nome}, CPF ${cliente.cpf}
Advogado responsável: ${processo.advogadoNome}
Produto/Ação: ${processo.produto}
Última movimentação: ${processo.ultimaMovimentacao || 'Não disponível'}
${referencias}

Redija a petição de ${tipo} para este processo.`;

  return provedor.gerarTexto({ sistema: SISTEMA, prompt, maxTokens: 8192 });
}
