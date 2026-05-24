import { Worker } from 'bullmq';
import { exec }   from 'child_process';
import { promisify } from 'util';
import { redis }  from '../cache/redis.js';
import path       from 'path';
import fs         from 'fs';

const execAsync = promisify(exec);
const BACKUP_DIR = process.env.BACKUP_DIR || '/tmp/am-backups';

export function criarBackupWorker() {
  const worker = new Worker(
    'backup',
    async (_job) => {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const arquivo   = path.join(BACKUP_DIR, `backup-${timestamp}.sql.gz`);

      const dbUrl  = process.env.DATABASE_URL;
      const cmd    = `pg_dump "${dbUrl}" | gzip > "${arquivo}"`;

      await execAsync(cmd);

      // Mantém apenas os 7 backups mais recentes
      const arquivos = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.endsWith('.sql.gz'))
        .sort()
        .reverse();

      for (const old of arquivos.slice(7)) {
        fs.unlinkSync(path.join(BACKUP_DIR, old));
      }

      console.log(`[Backup] Gerado: ${arquivo}`);
      return { arquivo };
    },
    { connection: redis }
  );

  worker.on('failed', (job, err) => {
    console.error('[Backup] Falhou:', err.message);
  });

  return worker;
}
