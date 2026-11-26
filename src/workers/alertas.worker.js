import { Worker } from 'bullmq';
import { redis }  from '../cache/redis.js';
import { enviarLembretesDiarios, enviarEscalonamentoVespera } from './alertasTarefas.js';
import { verificarCiclosRecorrentes } from '../services/ciclosRecorrentes.js';
import { verificarWatchdogSAC } from './sac.worker.js';
import { executarBaixaAutomatica } from '../services/prazos/baixa.js';
import { db as bancoPrazos } from '../db/index.js';
import { reprocessarSincronizacaoCamila } from '../services/reprocessarSyncCamila.js';
import { reprocessarSincronizacaoDrive } from '../services/reprocessarSyncDrive.js';
import { verificarTokenGoogle } from '../services/google/verificarToken.js';
import { detectarProtocolosNoDrive } from '../services/drive/conciliacao.js';
import { despacharAvisos } from '../services/avisosAcervo.js';
import { fecharMesSeForPrimeiroDiaUtil } from '../services/relatorioMensal.js';
import { fecharRelatorio } from '../routes/acervo.js';

// O fechamento automático age como o sistema: sem usuário, sem acesso a registros restritos.
const REQ_SISTEMA = { user: { id: null, perfil: 'master', pode_marcar_restrito: false }, _ip: null };

export function criarAlertasWorker() {
  return new Worker('alertas', async job => {
    if (job.name === 'lembretes-diarios') {
      await enviarLembretesDiarios();
    }
    if (job.name === 'ciclos-recorrentes') {
      const { tarefas } = await verificarCiclosRecorrentes();
      console.log(`[Ciclos] Verificação diária concluída — ${tarefas} tarefas criadas.`);
      await verificarWatchdogSAC().catch(err => console.warn('[SAC Watchdog] Falha na verificação:', err.message));
      // Baixa diária de prazos (26/11/2026): audiência com data passada e prazo com peça nossa + petição juntada.
      await executarBaixaAutomatica({ banco: bancoPrazos })
        .then(r => console.log(`[Prazos] Baixa automática — ${r.concluidas} concluída(s) (${r.audiencias} audiência(s), ${r.com_peca} com peça); ${r.sugeridas} com petição juntada aguardando confirmação.`))
        .catch(err => console.warn('[Prazos] Falha na baixa automática:', err.message));
    }
    if (job.name === 'escalonamento-vespera') {
      await enviarEscalonamentoVespera();
    }
    if (job.name === 'avisos-acervo') {
      await despacharAvisos();
    }
    if (job.name === 'relatorio-acervo') {
      await fecharMesSeForPrimeiroDiaUtil({ fechar: mes => fecharRelatorio(REQ_SISTEMA, mes) });
    }
    if (job.name === 'reprocessar-sync-camila') {
      const { tentadas, sincronizadas } = await reprocessarSincronizacaoCamila();
      if (tentadas > 0) console.log(`[SyncCamila] ${sincronizadas}/${tentadas} onboarding(s) sincronizado(s) com sucesso.`);
    }
    if (job.name === 'reprocessar-sync-drive') {
      const { tentadas, sincronizadas } = await reprocessarSincronizacaoDrive();
      if (tentadas > 0) console.log(`[SyncDrive] ${sincronizadas}/${tentadas} onboarding(s) sincronizado(s) com sucesso.`);
    }
    if (job.name === 'detectar-protocolos-drive') {
      await detectarProtocolosNoDrive().catch(err => console.warn('[Drive/Conciliação] Detector falhou:', err.message));
    }
    if (job.name === 'verificar-token-google') {
      await verificarTokenGoogle();
    }
  }, { connection: redis, concurrency: 1 });
}
