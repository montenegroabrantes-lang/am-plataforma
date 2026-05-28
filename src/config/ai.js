// Configuração central de IA — defaults do .env, sobrescritos pelo banco via recarregarAiConfig()
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

// Aplica configurações salvas no banco por cima dos defaults do .env
export async function recarregarAiConfig(db) {
  try {
    const rows = await db.query(`SELECT chave, valor FROM configuracoes WHERE categoria = 'ia'`);
    const cfg = {};
    rows.forEach(r => { cfg[r.chave] = r.valor; });

    if (cfg.claude_habilitado !== undefined) aiConfig.claude.habilitado = cfg.claude_habilitado === 'true';
    if (cfg.claude_modelo)     aiConfig.claude.modelo     = cfg.claude_modelo;
    if (cfg.openai_habilitado !== undefined) aiConfig.openai.habilitado = cfg.openai_habilitado === 'true';
    if (cfg.openai_modelo_texto) aiConfig.openai.modeloTexto = cfg.openai_modelo_texto;
    if (cfg.rota_diagnostico)  aiConfig.roteamento.diagnostico = cfg.rota_diagnostico;
    if (cfg.rota_peticao)      aiConfig.roteamento.peticao     = cfg.rota_peticao;

    console.log(`[AI Config] Roteamento: diagnóstico=${aiConfig.roteamento.diagnostico}, peticao=${aiConfig.roteamento.peticao} | Claude=${aiConfig.claude.habilitado}, OpenAI=${aiConfig.openai.habilitado}`);
  } catch (err) {
    console.warn('[AI Config] Não foi possível carregar config do banco:', err.message);
  }
}
