// Fase 6 (21/09/2026): reprocessa onboardings cujo Drive falhou (drive_sync_status='erro') —
// achado real desta sessão: o GOOGLE_REFRESH_TOKEN ficou morto por 11 dias e nada tentava de
// novo depois que a credencial voltasse a funcionar, exigindo correção manual caso a caso.
// Mesmo padrão já usado pro retry de sincronização com a Camila (reprocessarSyncCamila.js).
import { db } from '../db/index.js';
import { sincronizarDriveCliente } from './onboarding.js';

export async function reprocessarSincronizacaoDrive() {
  // Onboarding cancelado não tem pra que ganhar pasta no Drive — nunca vira cliente de fato.
  const pendentes = await db.query(
    `SELECT o.id AS onboarding_id, c.id AS cliente_id, c.nome, c.cpf, c.drive_pasta_id
       FROM onboardings_contrato o JOIN clientes c ON c.id = o.cliente_id
      WHERE o.drive_sync_status = 'erro' AND o.status <> 'cancelado'`
  );
  if (pendentes.length === 0) return { tentadas: 0, sincronizadas: 0 };

  let sincronizadas = 0;
  for (const p of pendentes) {
    const antes = await db.queryOne(`SELECT drive_sync_status FROM onboardings_contrato WHERE id=$1`, [p.onboarding_id]);
    await sincronizarDriveCliente(
      { id: p.cliente_id, nome: p.nome, cpf: p.cpf, drive_pasta_id: p.drive_pasta_id },
      p.onboarding_id
    );
    const depois = await db.queryOne(`SELECT drive_sync_status FROM onboardings_contrato WHERE id=$1`, [p.onboarding_id]);
    if (antes?.drive_sync_status !== 'sincronizado' && depois?.drive_sync_status === 'sincronizado') sincronizadas++;
  }
  return { tentadas: pendentes.length, sincronizadas };
}

// Retry de um onboarding só, disparado manualmente (ex.: botão na tela, quando existir).
export async function sincronizarDriveOnboarding(onboardingId) {
  const o = await db.queryOne(
    `SELECT o.id AS onboarding_id, o.status, c.id AS cliente_id, c.nome, c.cpf, c.drive_pasta_id
       FROM onboardings_contrato o JOIN clientes c ON c.id = o.cliente_id
      WHERE o.id = $1`,
    [onboardingId]
  );
  if (!o) { const e = new Error('Onboarding não encontrado ou ainda sem cliente vinculado.'); e.status = 404; throw e; }
  if (o.status === 'cancelado') { const e = new Error('Este onboarding foi cancelado — não há pasta a sincronizar.'); e.status = 400; throw e; }

  await sincronizarDriveCliente({ id: o.cliente_id, nome: o.nome, cpf: o.cpf, drive_pasta_id: o.drive_pasta_id }, o.onboarding_id);

  const depois = await db.queryOne(`SELECT drive_sync_status, drive_sync_erro FROM onboardings_contrato WHERE id=$1`, [onboardingId]);
  if (depois.drive_sync_status !== 'sincronizado') {
    const e = new Error(depois.drive_sync_erro || 'Falha ao sincronizar com o Google Drive.');
    e.status = 502; throw e;
  }
  return true;
}
