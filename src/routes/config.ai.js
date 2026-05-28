// Rota: GET/POST /api/config/ai
// Salva e carrega configurações de IA do banco de dados

import { Router }  from 'express';
import { db }      from '../db/index.js';
import { encrypt } from '../utils/crypto.js';
import { recarregarAiConfig } from '../config/ai.js';

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

  const { roteamento } = req.body;

  const pares = [
    { chave: 'rota_diagnostico', valor: roteamento.diagnostico },
    { chave: 'rota_peticao',     valor: roteamento.peticao },
  ];

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

// Status dos provedores (chave configurada + roteamento atual)
configAiRouter.get('/status', async (req, res) => {
  const { ai } = await import('../services/ai/index.js');
  res.json(ai.status());
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
  await recarregarAiConfig(db);
}
