import 'dotenv/config';
import { aiConfig }                 from '../../config/ai.js';
import { claudeProvider }           from './providers/claude.js';
import { openaiProvider }           from './providers/openai.js';
import { diagnosticarMovimentacao } from './tasks/diagnostico.js';
import { gerarPeticao }             from './tasks/peticao.js';

function provedorPara(tipoTarefa) {
  const config = aiConfig.roteamento[tipoTarefa];

  if (config === 'openai') {
    if (!aiConfig.openai.habilitado) throw new Error('OpenAI está desabilitado no .env');
    return openaiProvider;
  }

  if (!aiConfig.claude.habilitado) {
    if (aiConfig.openai.habilitado) return openaiProvider;
    throw new Error('Nenhum provedor de IA habilitado. Verifique CLAUDE_HABILITADO e OPENAI_HABILITADO no .env');
  }

  return claudeProvider;
}

export const ai = {

  async diagnosticar(movimentacao) {
    return diagnosticarMovimentacao(movimentacao, provedorPara('diagnostico'));
  },

  async gerarPeticao(dados) {
    return gerarPeticao(dados, provedorPara('peticao'));
  },

  status() {
    return {
      claude: {
        habilitado: aiConfig.claude.habilitado,
        modelo:     aiConfig.claude.modelo,
        apiKeyOk:   !!aiConfig.claude.apiKey,
      },
      openai: {
        habilitado:  aiConfig.openai.habilitado,
        modeloTexto: aiConfig.openai.modeloTexto,
        apiKeyOk:    !!aiConfig.openai.apiKey,
      },
      roteamento: aiConfig.roteamento,
    };
  },
};
