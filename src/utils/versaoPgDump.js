import { execFile } from 'node:child_process';

// Lote S / S-16 — linha de boot com as versões que importam para o backup. O cliente do
// Postgres no contêiner precisa ser da major do servidor (ou mais nova): pg_dump 15 contra o
// Postgres 18 falha, e foi isso que deixou 7 backups vazios em set/2026. Com a versão no log
// de boot, dá para conferir logo depois de cada deploy, sem esperar o backup das 23h.

// "pg_dump (PostgreSQL) 18.1 (Debian 18.1-1.pgdg120+2)" -> "18.1"; texto estranho -> null.
export function extrairVersaoPgDump(saida) {
  const m = /\(PostgreSQL\)\s+(\d+(?:\.\d+)*)/i.exec(String(saida ?? ''));
  return m ? m[1] : null;
}

// Nunca rejeita e nunca demora além do timeout: o boot não pode depender do pg_dump.
// `executar` é injetável para teste (mesma assinatura do execFile).
export function lerVersaoPgDump({ comando = 'pg_dump', executar = execFile, timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    try {
      executar(comando, ['--version'], { timeout: timeoutMs }, (erro, stdout) => {
        resolve(erro ? null : extrairVersaoPgDump(stdout));
      });
    } catch {
      resolve(null);
    }
  });
}

export async function logarVersoesBoot({ log = console, ...opcoes } = {}) {
  log.log(`[BOOT] Node ${process.version}`);
  const versao = await lerVersaoPgDump(opcoes);
  if (versao) log.log(`[BOOT] pg_dump ${versao}`);
  else log.warn('[BOOT] pg_dump não encontrado no PATH: o backup diário vai falhar (ver Dockerfile).');
  return versao;
}
