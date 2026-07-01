import { Worker } from 'bullmq';
import { exec }   from 'child_process';
import { promisify } from 'util';
import { redis }  from '../cache/redis.js';
import { uploadBackup, limparBackupsAntigos } from '../services/drive/index.js';
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
      const nomeArquivo = `backup-${timestamp}.sql.gz`;
      const arquivo     = path.join(BACKUP_DIR, nomeArquivo);

      const dbUrl = process.env.DATABASE_URL;
      await execAsync(`pg_dump "${dbUrl}" | gzip > "${arquivo}"`);

      console.log(`[Backup] Arquivo gerado: ${arquivo}`);

      // Envia para Google Drive
      if (process.env.GOOGLE_DRIVE_PASTA_BACKUP) {
        try {
          const stream = fs.createReadStream(arquivo);
          const { url } = await uploadBackup(nomeArquivo, stream);
          console.log(`[Backup] Enviado ao Google Drive: ${url}`);
          await limparBackupsAntigos(7);
        } catch (err) {
          console.error('[Backup] Erro ao enviar para Drive:', err.message);
        }
      } else {
        console.warn('[Backup] GOOGLE_DRIVE_PASTA_BACKUP não definida — backup salvo apenas localmente.');
      }

      // Remove arquivo local após upload (tmp não é persistente no Railway)
      fs.unlink(arquivo, () => {});

      return { arquivo: nomeArquivo };
    },
    { connection: redis }
  );

  worker.on('failed', (job, err) => {
    console.error('[Backup] Falhou:', err.message);
  });

  return worker;
}
