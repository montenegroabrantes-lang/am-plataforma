// Fase 3.3 do cronograma (20/09/2026): reprocessa onboardings cuja sincronização com a Camila
// falhou (camila_sync_status='erro') — sem isso, um onboarding criado durante uma
// indisponibilidade da Camila ficava desatualizado lá pra sempre, sem ninguém perceber.
import { db } from '../db/index.js';
import { camila } from './camila.js';
import { marcarSincronizacaoCamila } from './onboarding.js';

// Reaproveitada pelo worker (em lote) e pelo botão "Sincronizar de novo" na tela (um só).
async function tentarSincronizar(api, o, registradoPor) {
  try {
    await api.post(`/api/funil-leads/${o.camila_contact_id}/desfecho`, {
      desfecho: 'fechado',
      valorFechado: o.valor_fechado || undefined,
      telefone: o.whatsapp || undefined,
      registradoPor,
    });
    await marcarSincronizacaoCamila(o.id, true);
    return true;
  } catch (err) {
    await marcarSincronizacaoCamila(o.id, false, err.response?.data?.erro || err.message);
    return false;
  }
}

export async function reprocessarSincronizacaoCamila() {
  const api = camila();
  if (!api) return { tentadas: 0, sincronizadas: 0 };

  // Onboardings sem lead (cadastro manual, contactId sintético 'manual-...') não têm card
  // nenhum na Camila pra sincronizar — não tentar, senão o retry falharia pra sempre.
  const pendentes = await db.query(
    `SELECT id, camila_contact_id, whatsapp, valor_fechado
       FROM onboardings_contrato
      WHERE camila_sync_status = 'erro' AND camila_contact_id NOT LIKE 'manual-%'`
  );
  if (pendentes.length === 0) return { tentadas: 0, sincronizadas: 0 };

  let sincronizadas = 0;
  for (const o of pendentes) {
    if (await tentarSincronizar(api, o, 'sistema (retry automático)')) sincronizadas++;
  }
  return { tentadas: pendentes.length, sincronizadas };
}

// Retry de um onboarding só, disparado manualmente pelo botão na tela.
export async function sincronizarOnboardingComCamila(onboardingId, registradoPor) {
  const api = camila();
  if (!api) { const e = new Error('Integração com a Camila não configurada.'); e.status = 503; throw e; }
  const o = await db.queryOne(
    `SELECT id, camila_contact_id, whatsapp, valor_fechado, camila_sync_status
       FROM onboardings_contrato WHERE id = $1`,
    [onboardingId]
  );
  if (!o) { const e = new Error('Onboarding não encontrado.'); e.status = 404; throw e; }
  if (o.camila_contact_id?.startsWith('manual-')) {
    const e = new Error('Este cadastro não veio de um lead da Camila — não há nada pra sincronizar.');
    e.status = 400; throw e;
  }
  const ok = await tentarSincronizar(api, o, registradoPor || 'sistema (retry manual)');
  if (!ok) { const e = new Error('A Camila recusou ou está indisponível — tente novamente em instantes.'); e.status = 502; throw e; }
  return true;
}
