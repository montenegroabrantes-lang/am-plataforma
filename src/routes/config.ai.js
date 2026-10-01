// Rota: GET/POST /api/config/ai
// Salva e carrega configurações de IA do banco de dados

import { Router }  from 'express';
import { db }      from '../db/index.js';
import { encrypt } from '../utils/crypto.js';
import { recarregarAiConfig } from '../config/ai.js';
import { apenasMaster } from '../middleware/auth.js';
import { registrarAuditoria } from '../middleware/auditoria.js';
import { criarLimiteIA } from '../middleware/limites.js';
import axios from 'axios';
import { erroInterno } from '../middleware/erros.js';
import { diferenca } from '../utils/auditoriaCampos.js';

export const configAiRouter = Router();

// S-20: o teste faz chamada paga ao provedor — 20 por hora por usuário
const limiteTesteIA = criarLimiteIA('teste');

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
    erroInterno(res, e);
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
    // S-13: valores anteriores das chaves que serão gravadas (para o log trazer só o que mudou)
    const anteriores = await db.query(
      `SELECT chave, valor FROM configuracoes WHERE categoria = 'ia' AND chave = ANY($1::text[])`,
      [pares.map(p => p.chave)]
    );
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

    const mudancas = diferenca(
      Object.fromEntries(anteriores.map(r => [r.chave, r.valor])),
      Object.fromEntries(pares.map(p => [p.chave, p.valor])),
      pares.map(p => p.chave)
    );
    await registrarAuditoria({
      usuarioId: req.user.id, acao: 'alterar_config_ia', entidade: 'configuracao',
      valorAntes: mudancas.antes, valorDepois: mudancas.depois, ip: req._ip,
    });

    res.json({ ok: true, mensagem: 'Configurações salvas com sucesso.' });
  } catch (e) {
    erroInterno(res, e);
  }
});

// Status dos provedores (chave configurada + roteamento atual)
configAiRouter.get('/status', async (req, res) => {
  const { ai } = await import('../services/ai/index.js');
  res.json(ai.status());
});

// Testa conexão com um provedor (faz chamada paga à API: só Master)
configAiRouter.get('/test', apenasMaster, limiteTesteIA, async (req, res) => {
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

// POST /api/config/ai/camila — aplica config na Camila em tempo real (S-09).
// Repassa SÓ os campos que a tela de Configurações usa (lista branca), nunca o corpo inteiro,
// e audita quem mudou o quê (provedores e modelos apenas — não há segredo nesse payload).
const CAMILA_PROVEDORES = ['claude', 'openai'];
const CAMILA_MODELOS_CLAUDE = ['claude-sonnet-5', 'claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-haiku-4-5-20251001', 'claude-opus-4-8', 'claude-opus-4-7'];
// Alinhada ao que a Camila aceita em /admin/ia-config (camila/server.js): o que ela não
// aceita era descartado por lá sem aviso.
const CAMILA_MODELOS_OPENAI = ['gpt-4.1', 'gpt-4o', 'gpt-4.1-mini'];
const CAMILA_CAMPOS = {
  vendas:                 CAMILA_PROVEDORES,
  processo:               CAMILA_PROVEDORES,
  claude_modelo:          CAMILA_MODELOS_CLAUDE,
  claude_modelo_processo: CAMILA_MODELOS_CLAUDE,
  openai_modelo:          CAMILA_MODELOS_OPENAI,
};

// Só campos conhecidos com valor permitido; `descartados` lista os NOMES do que ficou de fora.
export function filtrarConfigCamila(corpo) {
  const payload = {};
  const descartados = [];
  const origem = corpo && typeof corpo === 'object' && !Array.isArray(corpo) ? corpo : {};
  for (const [campo, valor] of Object.entries(origem)) {
    if (Object.hasOwn(CAMILA_CAMPOS, campo) && typeof valor === 'string' && CAMILA_CAMPOS[campo].includes(valor)) payload[campo] = valor;
    else descartados.push(campo);
  }
  return { payload, descartados };
}

export function criarSalvarCamila({ http = axios, auditar = registrarAuditoria } = {}) {
  return async (req, res) => {
    const url    = process.env.CAMILA_ADMIN_URL;
    const secret = process.env.CAMILA_ADMIN_SECRET;
    if (!url) return res.status(503).json({ ok: false, erro: 'CAMILA_ADMIN_URL não configurada no Railway.' });
    const { payload, descartados } = filtrarConfigCamila(req.body);
    if (!Object.keys(payload).length) {
      return res.status(400).json({ ok: false, erro: 'Nenhum campo válido para salvar.', descartados });
    }
    const headers = { 'x-admin-secret': secret || '' };
    try {
      // Config de antes, só para o registro de auditoria: se a Camila não responder, segue sem ela.
      const antes = await http.get(`${url}/admin/ia-config`, { headers, timeout: 5000 })
        .then(r => filtrarConfigCamila(r?.data?.config).payload)
        .catch(() => null);
      const { data } = await http.post(`${url}/admin/ia-config`, payload, {
        headers: { ...headers, 'Content-Type': 'application/json' }, timeout: 5000,
      });
      await auditar({
        usuarioId: req.user.id, acao: 'alterar_config_ia_camila', entidade: 'config_ia_camila',
        valorAntes: antes, valorDepois: payload, ip: req._ip,
      });
      res.json(data && typeof data === 'object' && !Array.isArray(data) && descartados.length ? { ...data, descartados } : data);
    } catch (err) {
      res.status(502).json({ ok: false, erro: 'Camila offline ou inacessível.' });
    }
  };
}

configAiRouter.post('/camila', apenasMaster, criarSalvarCamila());
