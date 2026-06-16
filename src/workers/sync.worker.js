import { Worker } from 'bullmq';
import { redis }  from '../cache/redis.js';
import { sincronizarProcesso, sincronizarTodos } from '../services/tribunal/sync.js';

// Worker do sync em lote — concorrência 1, pode demorar horas
export function criarSyncWorker() {
  const worker = new Worker(
    'sync-tribunal',
    async (job) => {
      if (job.name === 'sincronizar-todos') return sincronizarTodos();
    },
    { connection: redis, concurrency: 1 }
  );

  worker.on('completed', (job, result) => {
    console.log(`[Sync] Job ${job.name} concluído:`, JSON.stringify(result).slice(0, 200));
  });
  worker.on('failed', (job, err) => {
    console.error(`[Sync] Job ${job?.name} falhou:`, err.message);
  });

  return worker;
}

// Worker de sync individual — fila separada, responde imediatamente ao clique do usuário
export function criarSyncIndividualWorker() {
  const worker = new Worker(
    'sync-individual',
    async (job) => {
      if (job.name === 'sincronizar-processo') {
        const { processoId } = job.data;
        if (!processoId) throw new Error('Job sem processoId');
        return sincronizarProcesso(processoId);
      }
    },
    { connection: redis, concurrency: 2 }
  );

  worker.on('completed', (job, result) => {
    console.log(`[Sync individual] Concluído:`, JSON.stringify(result).slice(0, 200));
  });
  worker.on('failed', (job, err) => {
    console.error(`[Sync individual] Falhou:`, err.message);
  });

  return worker;
}
