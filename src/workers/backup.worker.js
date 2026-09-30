import { Worker } from 'bullmq';
import { spawn }  from 'child_process';
import { redis }  from '../cache/redis.js';
import { db }     from '../db/index.js';
import { uploadBackup, limparBackupsAntigos } from '../services/drive/index.js';
import { enviarAlerta } from '../services/digisac/index.js';
import path       from 'path';
import fs         from 'fs';

const BACKUP_DIR = process.env.BACKUP_DIR || '/tmp/am-backups';

// 28/09/2026 — achado real: os 7 backups de 22 a 28/09 no Drive eram gzip vazios de 20 bytes.
// Causa: `pg_dump | gzip > arquivo` num shell sem `pipefail` — o status de saída é o do gzip,
// não o do pg_dump, então um pg_dump que falha (ex.: pg_dump 15 do Debian contra um servidor
// Postgres 18) ainda produz um "sucesso" com um gzip de entrada vazia, e a rotação apagava os
// backups bons anteriores por cima. Agora o dump roda com spawn separado do gzip, checando o
// código de saída e o stderr do pg_dump de verdade, e o arquivo final passa por um piso mínimo
// de tamanho plausível antes de subir ao Drive ou de qualquer rotação acontecer.
const TAMANHO_MINIMO_BACKUP_BYTES = 1024;

export function backupTemTamanhoPlausivel(bytes) {
  return typeof bytes === 'number' && bytes >= TAMANHO_MINIMO_BACKUP_BYTES;
}

// Gera `pg_dump | gzip` sem passar por shell: evita o bug de exit code do pipe (a promise só
// resolve se o pg_dump terminar com código 0 — senão rejeita com o stderr real do pg_dump) e
// evita interpolar a connection string numa string de shell. `comando` é injetável para teste.
export function gerarDumpComprimido(dbUrl, destino, { comando = 'pg_dump' } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => { if (!settled) { settled = true; reject(err); } };

    const dump = spawn(comando, [dbUrl]);
    const gzip = spawn('gzip');
    const out  = fs.createWriteStream(destino);

    let stderr = '';
    dump.stderr.on('data', (chunk) => { stderr += chunk; });

    dump.on('error', (err) => fail(new Error(`Falha ao iniciar ${comando}: ${err.message}`)));
    gzip.on('error', (err) => fail(new Error(`Falha ao iniciar gzip: ${err.message}`)));
    out.on('error',  (err) => fail(new Error(`Falha ao gravar arquivo local: ${err.message}`)));

    dump.stdout.pipe(gzip.stdin);
    gzip.stdout.pipe(out);

    let dumpFechou = false;
    let dumpCodigo = null;
    let escritaConcluida = false;

    const tentarConcluir = () => {
      if (settled || !dumpFechou || !escritaConcluida) return;
      if (dumpCodigo !== 0) {
        fail(new Error(
          `${comando} saiu com código ${dumpCodigo}${stderr.trim() ? `: ${stderr.trim()}` : ' (sem mensagem de erro no stderr)'}`
        ));
        return;
      }
      settled = true;
      resolve();
    };

    dump.on('close', (codigo) => { dumpFechou = true; dumpCodigo = codigo; tentarConcluir(); });
    out.on('finish', () => { escritaConcluida = true; tentarConcluir(); });
  });
}

async function alertarFalhaBackup(mensagem) {
  const masters = await db.query(
    `SELECT id, whatsapp FROM usuarios WHERE perfil='master' AND whatsapp IS NOT NULL AND whatsapp <> ''`
  ).catch(() => []);
  for (const m of masters) {
    // enviarAlerta nunca lança: a falha vem no resultado (R-05), então o .catch antigo era código morto.
    const r = await enviarAlerta(m.whatsapp, mensagem, { origem: 'backup', usuarioId: m.id });
    if (!r.ok) console.warn('[Backup] Alerta de falha não entregue a um master:', r.erro);
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

      try {
        await gerarDumpComprimido(dbUrl, arquivo);
      } catch (err) {
        fs.unlink(arquivo, () => {});
        console.error('[Backup] Erro ao gerar dump do banco:', err.message);
        await alertarFalhaBackup(
          `🔴 *Backup do banco NÃO foi gerado*\n\n${err.message}\n\nNenhum arquivo foi enviado ao Google Drive e nenhum backup antigo foi removido. Verifique com urgência.`
        );
        throw err;
      }

      const { size } = fs.statSync(arquivo);
      if (!backupTemTamanhoPlausivel(size)) {
        fs.unlink(arquivo, () => {});
        const msg = `Arquivo de backup implausivelmente pequeno (${size} bytes, mínimo esperado ${TAMANHO_MINIMO_BACKUP_BYTES}) — provável dump vazio ou incompleto.`;
        console.error(`[Backup] ${msg}`);
        await alertarFalhaBackup(
          `🔴 *Backup do banco NÃO foi gerado*\n\n${msg}\n\nNenhum arquivo foi enviado ao Google Drive e nenhum backup antigo foi removido. Verifique com urgência.`
        );
        throw new Error(msg);
      }

      console.log(`[Backup] Arquivo gerado: ${arquivo} (${size} bytes)`);

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
            `🔴 *Backup do banco NÃO chegou ao Google Drive*\n\nErro: ${err.message}\n\nO arquivo (${nomeArquivo}, ${size} bytes) foi gerado mas o envio falhou — provavelmente a autorização do Google precisa ser refeita. Verifique com urgência: sem isso, o backup diário não está sendo salvo em nenhum lugar fora do próprio banco.`
          );
          throw err;
        }
      } else {
        console.warn('[Backup] GOOGLE_DRIVE_PASTA_BACKUP não definida — backup salvo apenas localmente.');
        fs.unlink(arquivo, () => {});
      }

      return { arquivo: nomeArquivo, tamanho: size };
    },
    { connection: redis }
  );

  worker.on('failed', (job, err) => {
    console.error('[Backup] Falhou:', err.message);
  });

  return worker;
}
