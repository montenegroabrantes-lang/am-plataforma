import OpenAI from 'openai';
import { aiConfig } from '../../../config/ai.js';

let _client = null;

function client() {
  if (!_client) _client = new OpenAI({ apiKey: aiConfig.openai.apiKey });
  return _client;
}

// Geração de texto via GPT-4o (usado como fallback quando Claude está desabilitado)
export async function gerarTexto({ sistema, prompt, maxTokens = 4096 }) {
  const resp = await client().chat.completions.create({
    model:      aiConfig.openai.modeloTexto,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: sistema },
      { role: 'user',   content: prompt },
    ],
  });
  return resp.choices[0].message.content;
}

// Geração de embeddings (recomendado para pgvector — modelo pequeno e barato)
export async function gerarEmbedding(texto) {
  const resp = await client().embeddings.create({
    model: 'text-embedding-3-small',
    input: texto,
  });
  return resp.data[0].embedding;
}

export const openaiProvider = { gerarTexto, gerarEmbedding };
