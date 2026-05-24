// Rota: GET/POST /api/config/ai
// Salva e carrega configurações de IA do banco de dados

import { Router }  from 'express';
import { db }      from '../db/index.js';
import { encrypt } from '../utils/crypto.js';

export const configAiRouter = Router();

// Carrega configuração atual
configAiRouter.get('/', async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT chave, valor FROM configuracoes WHERE categoria = 'ia'`
    );
    const config = {};
    rows.forEach(r => { config[r.chave] = r.valor; });
    res.json({ ok: true, config });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// Salva configuração (apenas usuário Master)
configAiRouter.post('/', async (req, res) => {
  if (req.user?.perfil !== 'master') {
    return res.status(403).json({ ok: false, erro: 'Apenas usuários Master podem alterar configurações de IA.' });
  }

  const { claude, openai, roteamento } = req.body;

  const pares = [
    { chave: 'claude_habilitado',  valor: String(claude.habilitado) },
    { chave: 'claude_modelo',      valor: claude.modelo },
    { chave: 'openai_habilitado',  valor: String(openai.habilitado) },
    { chave: 'openai_modelo_texto', valor: openai.modeloTexto },
    { chave: 'rota_diagnostico',   valor: roteamento.diagnostico },
    { chave: 'rota_peticao',       valor: roteamento.peticao },
  ];

  // Chaves de API: salvas separadamente com criptografia
  if (claude.apiKey && !claude.apiKey.includes('•')) {
    pares.push({ chave: 'claude_api_key_enc', valor: encrypt(claude.apiKey) });
  }
  if (openai.apiKey && !openai.apiKey.includes('•')) {
    pares.push({ chave: 'openai_api_key_enc', valor: encrypt(openai.apiKey) });
  }

  try {
    // UPSERT — insere ou atualiza cada par
    for (const { chave, valor } of pares) {
      await db.query(
        `INSERT INTO configuracoes (categoria, chave, valor, atualizado_por, atualizado_em)
         VALUES ('ia', $1, $2, $3, NOW())
         ON CONFLICT (categoria, chave) DO UPDATE
         SET valor = $2, atualizado_por = $3, atualizado_em = NOW()`,
        [chave, valor, req.user.id]
      );
    }

    // Recarrega o aiConfig em memória sem reiniciar o servidor
    await recarregarConfigAI();

    res.json({ ok: true, mensagem: 'Configurações salvas com sucesso.' });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// Testa conexão com um provedor
configAiRouter.get('/test', async (req, res) => {
  const { provider } = req.query;

  try {
    if (provider === 'claude') {
      const { claudeProvider } = await import('../services/ai/providers/claude.js');
      await claudeProvider.gerarTexto({
        sistema: 'Responda apenas: ok',
        prompt:  'teste',
        maxTokens: 5,
      });
    } else if (provider === 'openai') {
      const { openaiProvider } = await import('../services/ai/providers/openai.js');
      await openaiProvider.gerarTexto({
        sistema: 'Responda apenas: ok',
        prompt:  'teste',
        maxTokens: 5,
      });
    } else {
      return res.status(400).json({ ok: false, erro: 'Provedor inválido.' });
    }

    res.json({ ok: true, mensagem: `${provider} conectado com sucesso.` });
  } catch (e) {
    res.status(400).json({ ok: false, erro: e.message });
  }
});

async function recarregarConfigAI() {
  // No modelo atual, aiConfig lê process.env na inicialização.
  // Configurações salvas no banco entram em vigor no próximo restart do servidor.
  // Para reload sem restart, substituir por leitura do banco em tempo real.
}
