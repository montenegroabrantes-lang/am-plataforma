/**
 * Colunas novas do sync de andamentos (R-06). Só acrescenta colunas anuláveis: idempotente, sem tocar
 * em dado existente e sem lock demorado (ADD COLUMN sem DEFAULT é instantâneo no Postgres).
 * Aplicada por migrar('2026_09_30_sync_datajud_r06', ...) em src/index.js.
 *
 *  - processos.datajud_atualizado_em: `dataHoraUltimaAtualizacao` do DataJud na última captura BEM-SUCEDIDA
 *    do processo. É a marca que substitui a "janela": só avança depois que os dados foram gravados; NULL =
 *    nunca capturado pelo sync novo (a 1ª captura é tratada como backfill: sem IA e sem WhatsApp CRÍTICO).
 *  - sync_execucoes.status_http / hits / casados: ver criarMetricasSync() em syncExecucao.js.
 *    Ficam NULL nas execuções anteriores (não foram medidas).
 */
export const DDL_SYNC_R06 = [
  `ALTER TABLE processos ADD COLUMN IF NOT EXISTS datajud_atualizado_em TIMESTAMPTZ`,
  `ALTER TABLE sync_execucoes ADD COLUMN IF NOT EXISTS status_http INTEGER`,
  `ALTER TABLE sync_execucoes ADD COLUMN IF NOT EXISTS hits INTEGER`,
  `ALTER TABLE sync_execucoes ADD COLUMN IF NOT EXISTS casados INTEGER`,
];

export async function aplicarMigracaoSyncR06(banco) {
  for (const ddl of DDL_SYNC_R06) await banco.execute(ddl);
}
