import { Worker, Queue } from 'bullmq';
import { redis }  from '../cache/redis.js';
import { sincronizarEventosSAC }      from '../services/digisac/index.js';
import { sincronizarProcessosCamila } from '../services/sheets/index.js';

export const sacQueue = new Queue('sac', { connection: redis });

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
  });

  worker.on('failed', (job, err) => {
    console.error(`[SAC Worker] ${job?.name} falhou:`, err.message);
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
