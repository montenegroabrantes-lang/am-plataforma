import 'dotenv/config';
import { aiConfig }                 from '../../config/ai.js';
import { claudeProvider }           from './providers/claude.js';
import { openaiProvider }           from './providers/openai.js';
import { diagnosticarMovimentacao } from './tasks/diagnostico.js';
import { gerarPeticao }             from './tasks/peticao.js';
import { classificarProcesso }      from './tasks/classificacao.js';

function provedorPara(tipoTarefa) {
  const rota = aiConfig.roteamento[tipoTarefa] || 'claude';

  if (rota === 'openai') {
    if (!aiConfig.openai.apiKey) throw new Error('Chave da OpenAI não configurada no Railway (OPENAI_API_KEY).');
    return openaiProvider;
  }

  if (!aiConfig.claude.apiKey) throw new Error('Chave da Anthropic não configurada no Railway (ANTHROPIC_API_KEY).');
  return claudeProvider;
}

export const ai = {
  async diagnosticar(movimentacao) {
    return diagnosticarMovimentacao(movimentacao, provedorPara('diagnostico'));
  },

  async gerarPeticao(dados) {
    return gerarPeticao(dados, provedorPara('peticao'));
  },

  async classificar(dados) {
    return classificarProcesso({ ...dados, provider: provedorPara('classificacao') });
  },

  status() {
    return {
      claude: {
        apiKeyOk: !!aiConfig.claude.apiKey,
        modelo:   aiConfig.claude.modelo,
      },
      openai: {
        apiKeyOk:    !!aiConfig.openai.apiKey,
        modeloTexto: aiConfig.openai.modeloTexto,
      },
      roteamento: { ...aiConfig.roteamento },
    };
  },
};
