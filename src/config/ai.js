// Configuração central de IA — defaults do .env, sobrescritos pelo banco via recarregarAiConfig()
export const aiConfig = {
  claude: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    modelo: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
  },
  openai: {
    apiKey:      process.env.OPENAI_API_KEY,
    modeloTexto: process.env.OPENAI_MODEL_TEXTO || 'gpt-4o',
  },
  roteamento: {
    diagnostico:    process.env.AI_TAREFA_DIAGNOSTICO    || 'claude',
    peticao:        process.env.AI_TAREFA_PETICAO        || 'claude',
    classificacao:  process.env.AI_TAREFA_CLASSIFICACAO  || 'openai',
  },
};

// Aplica configurações salvas no banco por cima dos defaults do .env
export async function recarregarAiConfig(db) {
  try {
    const rows = await db.query(`SELECT chave, valor FROM configuracoes WHERE categoria = 'ia'`);
    const cfg = {};
    rows.forEach(r => { cfg[r.chave] = r.valor; });

    if (cfg.claude_modelo)      aiConfig.claude.modelo       = cfg.claude_modelo;
    if (cfg.openai_modelo_texto) aiConfig.openai.modeloTexto = cfg.openai_modelo_texto;
    if (cfg.rota_diagnostico)   aiConfig.roteamento.diagnostico   = cfg.rota_diagnostico;
    if (cfg.rota_peticao)       aiConfig.roteamento.peticao       = cfg.rota_peticao;
    if (cfg.rota_classificacao) aiConfig.roteamento.classificacao = cfg.rota_classificacao;

    console.log(`[AI Config] Diagnóstico=${aiConfig.roteamento.diagnostico} | Peças=${aiConfig.roteamento.peticao} | Classificação=${aiConfig.roteamento.classificacao} | Claude=${aiConfig.claude.apiKey ? 'chave OK' : 'sem chave'} | OpenAI=${aiConfig.openai.apiKey ? 'chave OK' : 'sem chave'}`);
  } catch (err) {
    console.warn('[AI Config] Não foi possível carregar config do banco:', err.message);
  }
}
