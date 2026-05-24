import { Worker } from 'bullmq';
import { redis }  from '../cache/redis.js';
import { sincronizarProcesso, sincronizarTodos } from '../services/tribunal/sync.js';

export function criarSyncWorker() {
  const worker = new Worker(
    'sync-tribunal',
    async (job) => {
      if (job.name === 'sincronizar-todos') {
        return sincronizarTodos();
      }

      if (job.name === 'sincronizar-processo') {
        const { processoId } = job.data;
        return sincronizarProcesso(processoId);
      }
    },
    { connection: redis }
  );

  worker.on('completed', (job, result) => {
    console.log(`[Sync] Job ${job.name} concluído:`, JSON.stringify(result).slice(0, 200));
  });

  worker.on('failed', (job, err) => {
    console.error(`[Sync] Job ${job?.name} falhou:`, err.message);
  });

  return worker;
}
