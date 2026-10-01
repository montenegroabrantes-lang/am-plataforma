import { Worker } from 'bullmq';
import { redis }  from '../cache/redis.js';
import { enviarLembretesDiarios, enviarEscalonamentoVespera } from './alertasTarefas.js';
import { verificarCiclosRecorrentes } from '../services/ciclosRecorrentes.js';
import { verificarWatchdogSAC } from './sac.worker.js';
import { reprocessarSincronizacaoCamila } from '../services/reprocessarSyncCamila.js';
import { reprocessarSincronizacaoDrive } from '../services/reprocessarSyncDrive.js';
import { verificarTokenGoogle } from '../services/google/verificarToken.js';

export function criarAlertasWorker() {
  return new Worker('alertas', async job => {
    if (job.name === 'lembretes-diarios') {
      await enviarLembretesDiarios();
    }
    if (job.name === 'ciclos-recorrentes') {
      const { tarefas } = await verificarCiclosRecorrentes();
      console.log(`[Ciclos] Verificação diária concluída — ${tarefas} tarefas criadas.`);
      await verificarWatchdogSAC().catch(err => console.warn('[SAC Watchdog] Falha na verificação:', err.message));
    }
    if (job.name === 'escalonamento-vespera') {
      await enviarEscalonamentoVespera();
    }
    if (job.name === 'reprocessar-sync-camila') {
      const { tentadas, sincronizadas } = await reprocessarSincronizacaoCamila();
      if (tentadas > 0) console.log(`[SyncCamila] ${sincronizadas}/${tentadas} onboarding(s) sincronizado(s) com sucesso.`);
    }
    if (job.name === 'reprocessar-sync-drive') {
      const { tentadas, sincronizadas } = await reprocessarSincronizacaoDrive();
      if (tentadas > 0) console.log(`[SyncDrive] ${sincronizadas}/${tentadas} onboarding(s) sincronizado(s) com sucesso.`);
    }
    if (job.name === 'verificar-token-google') {
      await verificarTokenGoogle();
    }
  }, { connection: redis, concurrency: 1 });
}
