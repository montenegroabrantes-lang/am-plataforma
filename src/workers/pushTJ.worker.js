// Worker do push do TJPB: lê os e-mails de pje@tjpb.jus.br no Outlook a cada
// 5 minutos e os converte em movimentação + prazo.
//
// Escolha deliberada de consulta periódica em vez de webhook do Graph:
// as assinaturas de notificação do Graph expiram a cada ~3 dias e precisam ser
// renovadas. Se a renovação falha, a Microsoft simplesmente para de avisar — em
// silêncio. É exatamente o modo de falha do DataJud, que ficou 22 dias morto sem
// ninguém notar. Consulta periódica falha de forma visível: se parar de rodar,
// `push_execucoes` para de receber linhas e a verificação de saúde acusa.

import { Worker } from 'bullmq';
import { redis }  from '../cache/redis.js';
import { db }     from '../db/index.js';
import { listarMensagens } from '../services/outlook/graph.js';
import { processarMensagem } from '../services/outlook/pushTJ.js';
import { outlookConfigurado } from '../services/outlook/auth.js';

const REMETENTE = process.env.OUTLOOK_PUSH_REMETENTE || 'pje@tjpb.jus.br';

export function criarPushTJWorker() {
  return new Worker('push-tj', async () => {
    await lerPushTJ();
  }, { connection: redis, concurrency: 1 });
}

export async function lerPushTJ() {
  if (!outlookConfigurado()) {
    console.warn('[Push TJ] Outlook não configurado — worker ocioso.');
    return { ok: false, erro: 'nao_configurado' };
  }

  // Retoma de onde parou. Sem marca anterior, começa nas últimas 24h para não
  // varrer a caixa inteira na primeira execução.
  const ultima = await db.queryOne(
    `SELECT MAX(recebido_em) AS ultimo FROM push_tj_mensagens`
  ).catch(() => null);

  const desde = ultima?.ultimo
    ? new Date(ultima.ultimo)
    : new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [execucao] = await db.query(
    `INSERT INTO push_execucoes (iniciado_em) VALUES (NOW()) RETURNING id`
  );

  let lidas = 0, prazos = 0, desconhecidos = 0, semPrazo = 0, duplicadas = 0, falhas = 0;
  let erroFatal = null;

  try {
    const mensagens = await listarMensagens(REMETENTE, desde.toISOString(), 50);

    for (const msg of mensagens) {
      // Dedup por id da mensagem: se o worker morrer no meio, o restart não
      // reprocessa o que já entrou.
      const jaVista = await db.queryOne(
        `SELECT id FROM push_tj_mensagens WHERE mensagem_id = $1`, [msg.id]
      );
      if (jaVista) continue;

      let resultado;
      try {
        resultado = await processarMensagem(msg);
      } catch (e) {
        resultado = { status: 'erro', motivo: e.message };
        falhas++;
      }

      await db.execute(
        `INSERT INTO push_tj_mensagens
           (mensagem_id, remetente, assunto, recebido_em, numero_processo, processo_id, status, motivo, corpo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (mensagem_id) DO NOTHING`,
        [
          msg.id, REMETENTE, msg.subject || null, new Date(msg.receivedDateTime),
          resultado.numero || null, resultado.processoId || null,
          resultado.status, resultado.motivo || null,
          // Guarda o corpo: é o que permite reprocessar quando o parser melhorar,
          // sem depender de o e-mail ainda estar na caixa.
          (msg.body?.content || msg.bodyPreview || '').slice(0, 20_000),
        ]
      ).catch(e => console.warn('[Push TJ] Falha ao registrar mensagem:', e.message));

      lidas++;
      if (resultado.status === 'prazo_criado')          prazos++;
      if (resultado.status === 'processo_desconhecido') desconhecidos++;
      if (resultado.status === 'sem_prazo')             semPrazo++;
      if (resultado.status === 'duplicada')             duplicadas++;
    }
  } catch (e) {
    // Falha de conexão/autenticação é registrada como falha REAL, não como
    // "nada novo". Distinguir os dois é o que faltou no DataJud.
    erroFatal = e.message;
    falhas++;
    console.error('[Push TJ] Falha ao consultar o Outlook:', e.message);
  }

  await db.execute(
    `UPDATE push_execucoes
        SET concluido_em = NOW(), lidas = $1, prazos_criados = $2,
            processos_desconhecidos = $3, sem_prazo = $4, duplicadas = $5,
            falhas = $6, erro = $7
      WHERE id = $8`,
    [lidas, prazos, desconhecidos, semPrazo, duplicadas, falhas, erroFatal, execucao.id]
  ).catch(() => {});

  if (lidas > 0 || erroFatal) {
    console.log(`[Push TJ] ${lidas} lida(s) · ${prazos} prazo(s) · ${desconhecidos} de processo não cadastrado · ${semPrazo} sem prazo${erroFatal ? ` · ERRO: ${erroFatal}` : ''}`);
  }

  return { ok: !erroFatal, lidas, prazos, desconhecidos, semPrazo, duplicadas, falhas, erro: erroFatal };
}
