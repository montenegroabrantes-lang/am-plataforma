import { Router }        from 'express';
import { db }            from '../db/index.js';
import { autenticar, apenasMaster } from '../middleware/auth.js';
import {
  registrarLote,
  configurarWebhook,
  buscarConfigWebhook,
  normalizarNumero,
  parsearMovimentacoes,
  parsearCapa,
} from '../services/jusbrasil/index.js';

export const jusbrasilRouter = Router();

// ─── WEBHOOK PÚBLICO ─────────────────────────────────────────────────────────
// JusBrasil chama este endpoint quando detecta nova movimentação.
// Não tem autenticação nossa — responde 200 imediatamente para evitar retry.
jusbrasilRouter.post('/webhook', async (req, res) => {
  res.json({ ok: true }); // resposta imediata

  const payload = req.body;
  const eventos = Array.isArray(payload) ? payload : [payload];

  for (const evento of eventos) {
    processarEvento(evento).catch(err =>
      console.error('[JusBrasil] Erro ao processar evento:', err.message)
    );
  }
});

async function processarEvento(evento) {
  const { target_number, evt_type, data } = evento || {};
  if (!target_number || !evt_type) return;

  const numeroNorm = normalizarNumero(target_number);

  // Busca o processo pelo número (tenta formatado e puro)
  const processo = await db.queryOne(
    `SELECT * FROM processos WHERE numero = $1 OR REPLACE(REPLACE(REPLACE(numero,'-',''),'.',''),' ','') = $2`,
    [numeroNorm, target_number.replace(/\D/g, '')]
  );

  if (!processo) {
    console.warn(`[JusBrasil] Processo não encontrado: ${target_number}`);
    return;
  }

  const { salvarResultadoSync } = await import('../services/tribunal/sync.js');

  if (evt_type === 1) {
    // Movimentações novas
    const movs = parsearMovimentacoes(data);
    if (movs.length === 0) return;
    const novas = await salvarResultadoSync(processo.id, processo, {}, movs);
    await db.execute(
      `UPDATE processos SET sync_fonte = 'jusbrasil', atualizado_em = NOW() WHERE id = $1`,
      [processo.id]
    ).catch(() => {});
    console.log(`[JusBrasil] ${processo.numero}: ${novas} nova(s) movimentação(ões)`);

  } else if (evt_type === 7) {
    // Atualização de capa: polo, vara, classe, partes
    const dados = parsearCapa(data);
    if (dados.polo_ativo || dados.polo_passivo || dados.vara) {
      await db.execute(
        `UPDATE processos SET
           polo_ativo   = COALESCE($1, polo_ativo),
           polo_passivo = COALESCE($2, polo_passivo),
           vara         = COALESCE($3, vara),
           acao         = COALESCE($4, acao),
           sync_fonte   = 'jusbrasil',
           atualizado_em = NOW()
         WHERE id = $5`,
        [dados.polo_ativo, dados.polo_passivo, dados.vara, dados.acao, processo.id]
      );
      console.log(`[JusBrasil] Capa atualizada: ${processo.numero}`);
    }
    // Também processa movimentações contidas na capa
    const movsDaCapa = parsearMovimentacoes(data?.new?.movimentos || []);
    if (movsDaCapa.length > 0) {
      await salvarResultadoSync(processo.id, processo, dados, movsDaCapa);
    }
  }
}

// ─── ROTAS PROTEGIDAS (apenas master) ────────────────────────────────────────

// Configura a URL do webhook no JusBrasil
jusbrasilRouter.post('/configurar-webhook', autenticar, apenasMaster, async (req, res) => {
  try {
    const { BACKEND_URL, RAILWAY_PUBLIC_DOMAIN } = process.env;
    const base = BACKEND_URL || (RAILWAY_PUBLIC_DOMAIN ? `https://${RAILWAY_PUBLIC_DOMAIN}` : null);
    if (!base) return res.status(400).json({ ok: false, erro: 'BACKEND_URL não configurada no ambiente.' });

    const webhookUrl = `${base}/api/jusbrasil/webhook`;
    const r = await configurarWebhook(webhookUrl);
    res.json({ ok: true, webhook_url: webhookUrl, resposta: r });
  } catch (err) {
    res.status(500).json({ ok: false, erro: err.message });
  }
});

// Consulta config atual do webhook no JusBrasil
jusbrasilRouter.get('/webhook-config', autenticar, apenasMaster, async (req, res) => {
  try {
    const r = await buscarConfigWebhook();
    res.json({ ok: true, config: r });
  } catch (err) {
    res.status(500).json({ ok: false, erro: err.message });
  }
});

// Registra todos os processos ativos para monitoramento no JusBrasil
jusbrasilRouter.post('/registrar-todos', autenticar, apenasMaster, async (req, res) => {
  try {
    const processos = await db.query(
      `SELECT numero FROM processos
       WHERE status IN ('ativo','suspenso') AND jusbrasil_monitorado = false
       ORDER BY id`
    );

    if (processos.length === 0) {
      return res.json({ ok: true, mensagem: 'Todos os processos já estão registrados.', total: 0 });
    }

    // Responde imediatamente — o lote pode demorar minutos
    res.json({ ok: true, mensagem: `Registrando ${processos.length} processos em background.`, total: processos.length });

    setImmediate(async () => {
      const numeros = processos.map(p => p.numero);
      const resultados = await registrarLote(numeros);
      const ok = resultados.filter(r => r.ok).length;

      // Marca no banco os que foram registrados com sucesso
      const registrados = resultados.filter(r => r.ok).map(r => r.numero);
      if (registrados.length > 0) {
        await db.execute(
          `UPDATE processos SET jusbrasil_monitorado = true WHERE numero = ANY($1)`,
          [registrados]
        ).catch(err => console.warn('[JusBrasil] update jusbrasil_monitorado falhou:', err.message));
      }

      console.log(`[JusBrasil] Lote concluído: ${ok}/${processos.length} registrados.`);
    });
  } catch (err) {
    res.status(500).json({ ok: false, erro: err.message });
  }
});

// Status — quantos processos estão monitorados
jusbrasilRouter.get('/status', autenticar, apenasMaster, async (req, res) => {
  try {
    const [total, monitorados] = await Promise.all([
      db.queryOne(`SELECT COUNT(*) AS n FROM processos WHERE status IN ('ativo','suspenso')`),
      db.queryOne(`SELECT COUNT(*) AS n FROM processos WHERE status IN ('ativo','suspenso') AND jusbrasil_monitorado = true`),
    ]);
    const token_ok = !!process.env.JUSBRASIL_API_TOKEN;
    res.json({
      ok: true,
      token_configurado: token_ok,
      total_processos: Number(total?.n || 0),
      monitorados:      Number(monitorados?.n || 0),
      pendentes:        Number(total?.n || 0) - Number(monitorados?.n || 0),
    });
  } catch (err) {
    res.status(500).json({ ok: false, erro: err.message });
  }
});
