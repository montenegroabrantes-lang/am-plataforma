import Anthropic from '@anthropic-ai/sdk';
import { aiConfig } from '../../../config/ai.js';

let _client = null;

function client() {
  if (!_client) _client = new Anthropic({ apiKey: aiConfig.claude.apiKey });
  return _client;
}

// Geração de texto — base de todas as tarefas jurídicas
export async function gerarTexto({ sistema, prompt, maxTokens = 4096 }) {
  const resp = await client().messages.create({
    model:      aiConfig.claude.modelo,
    max_tokens: maxTokens,
    system:     sistema,
    messages:   [{ role: 'user', content: prompt }],
  });
  return resp.content[0].text;
}

// Embeddings: Claude não tem API de embeddings — usar sempre openaiProvider.gerarEmbedding()
export const claudeProvider = { gerarTexto };
