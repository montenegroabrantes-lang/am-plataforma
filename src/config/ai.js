// Configuração central de IA — lida uma vez, usada em todo o sistema
export const aiConfig = {
  claude: {
    habilitado: process.env.CLAUDE_HABILITADO !== 'false',
    apiKey:     process.env.ANTHROPIC_API_KEY,
    modelo:     process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
  },
  openai: {
    habilitado:  process.env.OPENAI_HABILITADO !== 'false',
    apiKey:      process.env.OPENAI_API_KEY,
    modeloTexto: process.env.OPENAI_MODEL_TEXTO || 'gpt-4o',
  },
  roteamento: {
    diagnostico: process.env.AI_TAREFA_DIAGNOSTICO || 'claude',
    peticao:     process.env.AI_TAREFA_PETICAO     || 'claude',
  },
};
