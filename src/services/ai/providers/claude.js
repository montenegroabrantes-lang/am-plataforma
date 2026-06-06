import Anthropic from '@anthropic-ai/sdk';
import { aiConfig } from '../../../config/ai.js';

let _client = null;
let _clientKey = null;

function client() {
  if (!_client || _clientKey !== aiConfig.claude.apiKey) {
    _client    = new Anthropic({ apiKey: aiConfig.claude.apiKey });
    _clientKey = aiConfig.claude.apiKey;
  }
  return _client;
}

// Geração de texto — base de todas as tarefas jurídicas.
//
// PROMPT CACHING: o system prompt é marcado com cache_control. Quando o mesmo
// system prompt (byte a byte) se repete em chamadas próximas (lotes de diagnóstico
// e classificação rodam dezenas de vezes seguidas), a Anthropic reaproveita o
// prefixo já processado — leitura de cache custa ~10% do preço normal de input.
//
// Requisitos para o cache funcionar de fato:
//  - O system prompt precisa ser ESTÁVEL (sem data/hora/ID interpolado). Por isso
//    movemos a data de hoje do diagnóstico para o prompt do usuário.
//  - Prefixo mínimo no Sonnet 4.6 = 2048 tokens. System prompts menores que isso
//    NÃO são cacheados (sem erro — apenas cache_creation_input_tokens = 0).
//  - TTL padrão de 5 min: lotes contínuos mantêm o cache quente sozinhos.
export async function gerarTexto({ sistema, prompt, maxTokens = 4096 }) {
  const resp = await client().messages.create({
    model:      aiConfig.claude.modelo,
    max_tokens: maxTokens,
    system: [
      { type: 'text', text: sistema, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: prompt }],
  });

  // Diagnóstico de cache — confirma se o prefixo está sendo reaproveitado.
  // read > 0  → cache funcionando (economia real)
  // write > 0 → primeira chamada gravando o cache (paga ~1.25x desta vez)
  const u = resp.usage;
  if (u && (u.cache_read_input_tokens || u.cache_creation_input_tokens)) {
    console.log(
      `[Claude] cache read=${u.cache_read_input_tokens || 0} ` +
      `write=${u.cache_creation_input_tokens || 0} ` +
      `input=${u.input_tokens} output=${u.output_tokens}`
    );
  }

  // Pega o primeiro bloco de texto (robusto contra blocos de thinking/tool).
  const bloco = resp.content.find(b => b.type === 'text');
  return bloco?.text ?? '';
}

// Embeddings: Claude não tem API de embeddings — usar sempre openaiProvider.gerarEmbedding()
export const claudeProvider = { gerarTexto };
