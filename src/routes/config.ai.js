// Rota: GET/POST /api/config/ai
// Salva e carrega configurações de IA do banco de dados

import { Router }  from 'express';
import { db }      from '../db/index.js';
import { encrypt } from '../utils/crypto.js';
import { recarregarAiConfig } from '../config/ai.js';
import axios from 'axios';

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

  const { roteamento, modelos } = req.body;

  const MODELOS_CLAUDE = ['claude-sonnet-5', 'claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-haiku-4-5-20251001', 'claude-opus-4-8', 'claude-opus-4-7'];
  const MODELOS_OPENAI = ['gpt-4o', 'gpt-4.5', 'gpt-5'];

  const PROVEDORES = ['claude', 'openai'];
  const pares = [
    { chave: 'rota_diagnostico',    valor: PROVEDORES.includes(roteamento?.diagnostico)   ? roteamento.diagnostico   : 'claude' },
    { chave: 'rota_peticao',        valor: PROVEDORES.includes(roteamento?.peticao)        ? roteamento.peticao        : 'claude' },
    { chave: 'rota_classificacao',  valor: PROVEDORES.includes(roteamento?.classificacao)  ? roteamento.classificacao  : 'openai' },
    { chave: 'claude_modelo',       valor: MODELOS_CLAUDE.includes(modelos?.claude) ? modelos.claude : 'claude-sonnet-4-6' },
    { chave: 'openai_modelo_texto', valor: MODELOS_OPENAI.includes(modelos?.openai) ? modelos.openai : 'gpt-4o' },
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

// GET /api/config/camila-ia — lê config atual da Camila
configAiRouter.get('/camila', async (req, res) => {
  const url    = process.env.CAMILA_ADMIN_URL;
  const secret = process.env.CAMILA_ADMIN_SECRET;
  console.log(`[Camila Config] URL=${url ? url : 'NÃO DEFINIDA'} SECRET=${secret ? 'definido' : 'NÃO DEFINIDO'}`);
  if (!url) return res.json({ ok: true, config: { vendas: 'claude', processo: 'claude' }, offline: true });
  try {
    const { data } = await axios.get(`${url}/admin/ia-config`, {
      headers: { 'x-admin-secret': secret || '' }, timeout: 5000,
    });
    res.json(data);
  } catch (err) {
    console.error(`[Camila Config] Erro ao conectar: ${err.response?.status || err.message}`);
    res.json({ ok: false, config: { vendas: 'claude', processo: 'claude' }, offline: true });
  }
});

// POST /api/config/camila-ia — aplica config na Camila em tempo real
configAiRouter.post('/camila', async (req, res) => {
  if (req.user?.perfil !== 'master') return res.status(403).json({ ok: false, erro: 'Apenas Master.' });
  const url    = process.env.CAMILA_ADMIN_URL;
  const secret = process.env.CAMILA_ADMIN_SECRET;
  if (!url) return res.status(503).json({ ok: false, erro: 'CAMILA_ADMIN_URL não configurada no Railway.' });
  try {
    const MODELOS_CLAUDE = ['claude-sonnet-5', 'claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-haiku-4-5-20251001', 'claude-opus-4-8', 'claude-opus-4-7'];
    const MODELOS_OPENAI = ['gpt-4o', 'gpt-4.5', 'gpt-5'];
    const payload = { ...req.body };
    if (payload.claude_modelo          && !MODELOS_CLAUDE.includes(payload.claude_modelo))          delete payload.claude_modelo;
    if (payload.claude_modelo_processo && !MODELOS_CLAUDE.includes(payload.claude_modelo_processo)) delete payload.claude_modelo_processo;
    if (payload.openai_modelo          && !MODELOS_OPENAI.includes(payload.openai_modelo))          delete payload.openai_modelo;
    const { data } = await axios.post(`${url}/admin/ia-config`, payload, {
      headers: { 'x-admin-secret': secret || '', 'Content-Type': 'application/json' }, timeout: 5000,
    });
    res.json(data);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Camila offline ou inacessível.' });
  }
});
