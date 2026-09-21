import { Worker } from 'bullmq';
import { exec }   from 'child_process';
import { promisify } from 'util';
import { redis }  from '../cache/redis.js';
import { db }     from '../db/index.js';
import { uploadBackup, limparBackupsAntigos } from '../services/drive/index.js';
import { enviarAlerta } from '../services/digisac/index.js';
import path       from 'path';
import fs         from 'fs';

const execAsync = promisify(exec);
const BACKUP_DIR = process.env.BACKUP_DIR || '/tmp/am-backups';

// 21/09/2026 — achado real: o upload pro Drive podia falhar (ex.: refresh_token expirado —
// confirmado morto em produção, invalid_grant há pelo menos 11 dias) e o job continuava
// "completado" no BullMQ, com o arquivo local apagado logo em seguida (/tmp não é persistente
// no Railway) — nenhum backup chegava a lugar nenhum, e nada avisava ninguém. Agora: upload
// falhou = job falha de verdade (aparece como falha no BullMQ, não como sucesso) e os masters
// são alertados por WhatsApp; o arquivo local só é apagado quando o upload dá certo.
async function alertarFalhaBackup(mensagem) {
  const masters = await db.query(
    `SELECT whatsapp FROM usuarios WHERE perfil='master' AND whatsapp IS NOT NULL AND whatsapp <> ''`
  ).catch(() => []);
  for (const m of masters) {
    await enviarAlerta(m.whatsapp, mensagem).catch(err => console.warn('[Backup] Falha ao alertar master:', err.message));
  }
}

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
          fs.unlink(arquivo, () => {});
        } catch (err) {
          console.error('[Backup] Erro ao enviar para Drive:', err.message);
          await alertarFalhaBackup(
            `🔴 *Backup do banco NÃO chegou ao Google Drive*\n\nErro: ${err.message}\n\nO arquivo (${nomeArquivo}) foi gerado mas o envio falhou — provavelmente a autorização do Google precisa ser refeita. Verifique com urgência: sem isso, o backup diário não está sendo salvo em nenhum lugar fora do próprio banco.`
          );
          throw err;
        }
      } else {
        console.warn('[Backup] GOOGLE_DRIVE_PASTA_BACKUP não definida — backup salvo apenas localmente.');
        fs.unlink(arquivo, () => {});
      }

      return { arquivo: nomeArquivo };
    },
    { connection: redis }
  );

  worker.on('failed', (job, err) => {
    console.error('[Backup] Falhou:', err.message);
  });

  return worker;
}
