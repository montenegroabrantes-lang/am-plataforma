import { Worker, Queue } from 'bullmq';
import { redis }  from '../cache/redis.js';
import { db }     from '../db/index.js';
import { sincronizarEventosSAC }      from '../services/digisac/index.js';
import { sincronizarProcessosCamila } from '../services/sheets/index.js';
import { enviarAlerta } from '../services/digisac/index.js';

export const sacQueue = new Queue('sac', { connection: redis });

const LIMITE_HORAS = { 'sync-digisac': 4, 'sync-sheets': 8 }; // 2x o intervalo agendado, tolerância

async function marcarSucesso(nomeJob) {
  await db.query(
    `INSERT INTO configuracoes (categoria, chave, valor) VALUES ('sac_watchdog', $1, $2)
     ON CONFLICT (categoria, chave) DO UPDATE SET valor = $2`,
    [`${nomeJob}_ultimo_sucesso`, new Date().toISOString()]
  ).catch(err => console.warn('[SAC Watchdog] Falha ao registrar sucesso:', err.message));
  await db.query(
    `INSERT INTO configuracoes (categoria, chave, valor) VALUES ('sac_watchdog', $1, '0')
     ON CONFLICT (categoria, chave) DO UPDATE SET valor = '0'`,
    [`${nomeJob}_falhas_seguidas`]
  ).catch(() => {});
}

async function marcarFalha(nomeJob, mensagemErro) {
  const row = await db.queryOne(
    `SELECT valor FROM configuracoes WHERE categoria = 'sac_watchdog' AND chave = $1`,
    [`${nomeJob}_falhas_seguidas`]
  ).catch(() => null);
  const falhas = (Number(row?.valor) || 0) + 1;
  await db.query(
    `INSERT INTO configuracoes (categoria, chave, valor) VALUES ('sac_watchdog', $1, $2)
     ON CONFLICT (categoria, chave) DO UPDATE SET valor = $2`,
    [`${nomeJob}_falhas_seguidas`, String(falhas)]
  ).catch(() => {});

  // A partir da 3ª falha seguida, alerta os masters — sinal de que o sync pode estar travado.
  if (falhas >= 3) {
    const masters = await db.query(
      `SELECT whatsapp FROM usuarios WHERE perfil = 'master' AND whatsapp IS NOT NULL AND whatsapp <> ''`
    ).catch(() => []);
    const msg = `🚨 *Alerta de sincronização*\n\nO job "${nomeJob}" falhou ${falhas} vezes seguidas.\nÚltimo erro: ${mensagemErro}\n\nVerifique o worker SAC — pode estar travado.`;
    for (const m of masters) await enviarAlerta(m.whatsapp, msg).catch(() => {});
  }
}

// Verifica se algum sync não roda com sucesso há mais tempo que o esperado —
// detecta o cenário de fila pausada silenciosamente (já ocorreu por ~1 mês em produção).
export async function verificarWatchdogSAC() {
  for (const [nomeJob, limiteHoras] of Object.entries(LIMITE_HORAS)) {
    const row = await db.queryOne(
      `SELECT valor FROM configuracoes WHERE categoria = 'sac_watchdog' AND chave = $1`,
      [`${nomeJob}_ultimo_sucesso`]
    ).catch(() => null);
    if (!row) continue; // ainda não rodou nenhuma vez desde o deploy — não é uma falha
    const horasDesde = (Date.now() - new Date(row.valor).getTime()) / 3600000;
    if (horasDesde > limiteHoras) {
      const masters = await db.query(
        `SELECT whatsapp FROM usuarios WHERE perfil = 'master' AND whatsapp IS NOT NULL AND whatsapp <> ''`
      ).catch(() => []);
      const msg = `🚨 *Sync travado*\n\nO job "${nomeJob}" não roda com sucesso há ${horasDesde.toFixed(1)}h (esperado a cada ${limiteHoras / 2}h aprox).\n\nVerifique se a fila "sac" está pausada ou se o worker travou.`;
      for (const m of masters) await enviarAlerta(m.whatsapp, msg).catch(() => {});
      console.warn(`[SAC Watchdog] ${nomeJob} travado há ${horasDesde.toFixed(1)}h — alertado.`);
    }
  }
}

export function criarSACWorker() {
  const worker = new Worker(
    'sac',
    async (job) => {
      if (job.name === 'sync-digisac') {
        const salvos = await sincronizarEventosSAC();
        return { digisac: salvos };
      }

      if (job.name === 'sync-sheets') {
        const salvos = await sincronizarProcessosCamila();
        return { sheets: salvos };
      }

      if (job.name === 'sync-tudo') {
        const [digisac, sheets] = await Promise.all([
          sincronizarEventosSAC(),
          sincronizarProcessosCamila(),
        ]);
        return { digisac, sheets };
      }
    },
    { connection: redis }
  );

  worker.on('completed', (job, result) => {
    console.log(`[SAC Worker] ${job.name}:`, JSON.stringify(result));
    if (LIMITE_HORAS[job.name]) marcarSucesso(job.name);
  });

  worker.on('failed', (job, err) => {
    console.error(`[SAC Worker] ${job?.name} falhou:`, err.message);
    if (job?.name && LIMITE_HORAS[job.name]) marcarFalha(job.name, err.message);
  });

  return worker;
}

export async function agendarSACWorker() {
  // Sync Digisac a cada 2h
  await sacQueue.add('sync-digisac', {}, {
    repeat:           { pattern: '0 */2 * * *' },
    jobId:            'sac-digisac-recorrente',
    removeOnComplete: 5,
  });

  // Sync Sheets (processos Camila) a cada 4h
  await sacQueue.add('sync-sheets', {}, {
    repeat:           { pattern: '0 */4 * * *' },
    jobId:            'sac-sheets-recorrente',
    removeOnComplete: 5,
  });

  console.log('[SAC Worker] Digisac (2h) e Sheets (4h) agendados.');
}
