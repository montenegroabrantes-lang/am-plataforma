import { Queue }        from 'bullmq';
import { redis }        from '../cache/redis.js';
import { criarSyncWorker, criarSyncIndividualWorker } from './sync.worker.js';
import { criarBackupWorker }    from './backup.worker.js';
import { criarAudienciaWorker }        from './audiencia.worker.js';
import { criarSACWorker, agendarSACWorker } from './sac.worker.js';
import { criarAlertasWorker }   from './alertas.worker.js';

let syncQueue;
let individualSyncQueue;
let backupQueue;
let alertasQueue;

export async function iniciarWorkers() {
  syncQueue           = new Queue('sync-tribunal', { connection: redis });
  individualSyncQueue = new Queue('sync-individual', { connection: redis });
  backupQueue         = new Queue('backup',          { connection: redis });
  alertasQueue        = new Queue('alertas',         { connection: redis });

  criarSyncWorker();
  criarSyncIndividualWorker();
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

  // Se havia sync interrompido por restart, reagenda imediatamente
  try {
    const { db } = await import('../db/index.js');
    const interrompido = await db.queryOne(
      `SELECT id FROM sync_execucoes WHERE concluido_em IS NULL AND iniciado_em < NOW() - INTERVAL '10 minutes' LIMIT 1`
    ).catch(() => null);
    if (interrompido) {
      // Marca a execução interrompida como falha
      await db.execute(
        `UPDATE sync_execucoes SET concluido_em = NOW(), falhas = 0, status = 'interrompido' WHERE id = $1`,
        [interrompido.id]
      ).catch(() => {});
      // Reagenda imediatamente
      await syncQueue.add('sincronizar-todos', {}, { removeOnComplete: 10, removeOnFail: 5 });
      console.log('[Workers] Sync interrompido por restart — reagendado imediatamente.');
    }
  } catch { /* não bloqueia boot */ }

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

// Dispara sync imediato de um processo — fila separada, não bloqueia pelo lote
export async function enfileirarSincronizarProcesso(processoId) {
  await individualSyncQueue.add('sincronizar-processo', { processoId }, {
    attempts:         2,
    backoff:          { type: 'fixed', delay: 10_000 },
    removeOnComplete: 20,
    removeOnFail:     10,
  });
}

export { syncQueue, individualSyncQueue, backupQueue, alertasQueue };
