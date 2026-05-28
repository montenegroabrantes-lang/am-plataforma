import { Queue }        from 'bullmq';
import { redis }        from '../cache/redis.js';
import { criarSyncWorker }      from './sync.worker.js';
import { criarBackupWorker }    from './backup.worker.js';
import { criarAudienciaWorker }        from './audiencia.worker.js';
import { criarSACWorker, agendarSACWorker } from './sac.worker.js';
import { criarAlertasWorker }   from './alertas.worker.js';

let syncQueue;
let backupQueue;
let alertasQueue;

export async function iniciarWorkers() {
  syncQueue    = new Queue('sync-tribunal', { connection: redis });
  backupQueue  = new Queue('backup',        { connection: redis });
  alertasQueue = new Queue('alertas',       { connection: redis });

  criarSyncWorker();
  criarBackupWorker();
  criarAudienciaWorker();
  criarSACWorker();
  criarAlertasWorker();
  await agendarSACWorker();

  // Agenda sync de todos os processos a cada hora
  await syncQueue.add(
    'sincronizar-todos',
    {},
    {
      repeat:     { pattern: '0 * * * *' },
      jobId:      'sync-todos-recorrente',
      removeOnComplete: 10,
      removeOnFail:      5,
    }
  );

  // Backup diário às 2h
  await backupQueue.add(
    'backup-diario',
    {},
    {
      repeat:     { pattern: '0 2 * * *' },
      jobId:      'backup-diario-recorrente',
      removeOnComplete: 3,
      removeOnFail:     3,
    }
  );

  // Lembretes diários de tarefas via WhatsApp às 8h
  await alertasQueue.add(
    'lembretes-diarios',
    {},
    {
      repeat:           { pattern: '0 8 * * *' },
      jobId:            'lembretes-diarios-recorrente',
      removeOnComplete: 3,
      removeOnFail:     3,
    }
  );

  console.log('[Workers] Sync (a cada hora), Backup (02h) e Alertas WhatsApp (08h) iniciados.');
}

// Dispara sync imediato de um processo (chamado pelas rotas)
export async function enfileirarSincronizarProcesso(processoId) {
  await syncQueue.add('sincronizar-processo', { processoId }, {
    attempts:      3,
    backoff:       { type: 'exponential', delay: 5_000 },
    removeOnComplete: 20,
  });
}

export { syncQueue, backupQueue, alertasQueue };
