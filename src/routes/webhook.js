/**
 * Webhook DataJud — CNJ push notification
 *
 * O CNJ está implementando notificação push (ainda não lançada em produção).
 * Este endpoint recebe o POST quando um processo monitorado é atualizado,
 * eliminando a necessidade do pull horário para processos ativos.
 *
 * Registro do webhook no CNJ (quando disponível):
 *   POST https://api-publica.datajud.cnj.jus.br/api_publica/webhook
 *   Body: { url: "https://<seu-dominio>/api/webhook/datajud", eventos: ["movimento"] }
 *
 * Payload esperado do CNJ:
 *   { numeroProcesso: "0000001-00.0000.0.00.0000", tribunal: "TJPB", evento: "movimento" }
 */
import { Router } from 'express';
import { db }     from '../db/index.js';

export const webhookRouter = Router();

// Token de validação — CNJ envia no header X-Datajud-Token para evitar spam
const WEBHOOK_TOKEN = process.env.DATAJUD_WEBHOOK_TOKEN || null;

// POST /api/webhook/datajud
webhookRouter.post('/datajud', async (req, res) => {
  // Valida token se configurado
  if (WEBHOOK_TOKEN) {
    const token = req.headers['x-datajud-token'] || req.headers['authorization']?.replace('Bearer ', '');
    if (token !== WEBHOOK_TOKEN) {
      return res.status(401).json({ ok: false, erro: 'Token inválido' });
    }
  }

  const { numeroProcesso, tribunal, evento } = req.body || {};

  if (!numeroProcesso) {
    return res.status(400).json({ ok: false, erro: 'numeroProcesso ausente' });
  }

  // Responde imediatamente para o CNJ não fazer retry (processamento assíncrono)
  res.json({ ok: true, recebido: true });

  // Processa em background
  setImmediate(async () => {
    try {
      const numeroPuro = String(numeroProcesso).replace(/\D/g, '');

      const processo = await db.queryOne(
        `SELECT id FROM processos WHERE REPLACE(REPLACE(numero, '.', ''), '-', '') = $1 AND status IN ('ativo','suspenso') LIMIT 1`,
        [numeroPuro]
      );

      if (!processo) {
        console.log(`[Webhook DataJud] ${numeroProcesso} não é nosso — ignorado`);
        return;
      }

      console.log(`[Webhook DataJud] Push recebido para ${numeroProcesso} (evento: ${evento || 'não informado'}) — disparando sync`);

      const { sincronizarProcesso } = await import('../services/tribunal/sync.js');
      await sincronizarProcesso(processo.id);

      console.log(`[Webhook DataJud] Sync concluído para ${numeroProcesso}`);
    } catch (err) {
      console.error(`[Webhook DataJud] Erro ao sincronizar ${numeroProcesso}:`, err.message);
    }
  });
});

// GET /api/webhook/datajud/status — confirma que o endpoint está ativo (usado pelo CNJ para verificar)
webhookRouter.get('/datajud/status', (_req, res) => {
  res.json({ ok: true, servico: 'AM Plataforma Webhook', versao: '1.0' });
});
