import { Queue }        from 'bullmq';
import { redis }        from '../cache/redis.js';
import { criarSyncWorker, criarSyncIndividualWorker } from './sync.worker.js';
import { criarBackupWorker }    from './backup.worker.js';
import { criarAudienciaWorker }        from './audiencia.worker.js';
import { criarSACWorker, agendarSACWorker, sacQueue } from './sac.worker.js';
import { criarAlertasWorker }   from './alertas.worker.js';
import { criarPushTJWorker }    from './pushTJ.worker.js';
import { AGENDA, removerAgendamentosAntigos, descreverAgendamentos } from './agendamentos.js';
import { fontePush }            from '../services/pushTJ/fonte.js';

let syncQueue;
let individualSyncQueue;
let backupQueue;
let alertasQueue;
let pushTJQueue;

export async function iniciarWorkers() {
  syncQueue           = new Queue('sync-tribunal', { connection: redis });
  individualSyncQueue = new Queue('sync-individual', { connection: redis });
  backupQueue         = new Queue('backup',          { connection: redis });
  alertasQueue        = new Queue('alertas',         { connection: redis });

  // Limpa fila de publicações do Redis (legado — sync agora feito via script local)
  try {
    const pubQ = new Queue('publicacoes', { connection: redis });
    await pubQ.obliterate({ force: true });
    await pubQ.close();
  } catch { /* ignora se já não existia */ }

  criarSyncWorker();
  criarSyncIndividualWorker();
  criarBackupWorker();
  criarAudienciaWorker();
  criarSACWorker();
  criarAlertasWorker();

  // Push do TJPB por e-mail — só sobe se houver caixa configurada (IMAP ou Outlook),
  // para não encher o log de erro em ambiente sem a integração configurada.
  const fonte = fontePush();
  if (fonte) {
    pushTJQueue = new Queue('push-tj', { connection: redis });
    criarPushTJWorker();
    await pushTJQueue.add(
      'ler-push',
      {},
      {
        repeat: { pattern: '*/5 * * * *' },   // a cada 5 min — prazo judicial não precisa de segundos
        jobId:  'push-tj-recorrente',
        removeOnComplete: 20,
        removeOnFail:     10,
      }
    );
    console.log(`[Workers] Push do TJPB ativo via ${fonte} (consulta a cada 5 min).`);
  } else {
    console.log('[Workers] Push do TJPB inativo — defina PUSH_TJ_IMAP_HOST/USER/SENHA (ou OUTLOOK_CLIENT_ID/SECRET/REFRESH_TOKEN) para ligar.');
  }

  // Worker de publicações desativado — Comunica API bloqueia IPs de nuvem (CloudFront 403)
  // Sync feito via script local (~/sync-publicacoes.mjs) ou GitHub Actions com IP residencial
  // criarPublicacoesWorker();
  await agendarSACWorker();

  // Agenda sync de todos os processos a cada hora
  await syncQueue.add(
    'sincronizar-todos',
    {},
    {
      repeat:     { pattern: '0 * * * *' },
      jobId:      'sync-todos-recorrente',
      removeOnComplete: 10,
      removeOnFail:      5,
    }
  );

  // Se havia sync interrompido por restart, fecha TODAS as execuções abertas e reagenda uma vez.
  // (Antes o UPDATE usava a coluna `status`, que não existe: nada fechava, e todo boot reagendava.)
  try {
    const { db } = await import('../db/index.js');
    const { fecharExecucoesAbertas } = await import('../services/tribunal/syncExecucao.js');
    const fechadas = await fecharExecucoesAbertas(db);
    if (fechadas > 0) {
      // Reagenda imediatamente
      await syncQueue.add('sincronizar-todos', {}, { removeOnComplete: 10, removeOnFail: 5 });
      console.log(`[Workers] ${fechadas} sync(s) interrompido(s) por restart — fechado(s) e reagendado imediatamente.`);
    }
  } catch (err) {
    console.warn('[Workers] Não foi possível fechar sync interrompido:', err.message); // não bloqueia boot
  }

  // Backup diário às 02h de Brasília (A5-03/A4-08: sem `tz` rodava às 23h). Horários em agendamentos.js.
  await backupQueue.add(
    'backup-diario',
    {},
    {
      repeat:     { ...AGENDA['backup-diario'] },
      jobId:      'backup-diario-recorrente',
      removeOnComplete: 3,
      removeOnFail:     3,
    }
  );

  // Lembretes diários de tarefas via WhatsApp às 08h de Brasília, segunda a sexta (antes: 05h, todo dia)
  await alertasQueue.add(
    'lembretes-diarios',
    {},
    {
      repeat:           { ...AGENDA['lembretes-diarios'] },
      jobId:            'lembretes-diarios-recorrente',
      removeOnComplete: 3,
      removeOnFail:     3,
    }
  );

  // Verificação diária de ciclos recorrentes (FGTS Remanescente, etc.) às 07h de Brasília (antes: 04h)
  await alertasQueue.add(
    'ciclos-recorrentes',
    {},
    {
      repeat:           { ...AGENDA['ciclos-recorrentes'] },
      jobId:            'ciclos-recorrentes-diario',
      removeOnComplete: 3,
      removeOnFail:     3,
    }
  );

  // Escalonamento de véspera de prazos — alerta o responsável direto às 08h30 e 16h30 de Brasília, de
  // segunda a sexta (antes: 05h30 e 13h30, todo dia)
  await alertasQueue.add(
    'escalonamento-vespera',
    {},
    {
      repeat:           { ...AGENDA['escalonamento-vespera'] },
      jobId:            'escalonamento-vespera-recorrente',
      removeOnComplete: 3,
      removeOnFail:     3,
    }
  );

  // R-01 (30/09/2026) — testa o GOOGLE_REFRESH_TOKEN todo dia às 8h de Brasília (renova de verdade,
  // confere escopos drive+calendar) e alerta os masters por WhatsApp se estiver morto ou incompleto.
  // (Este job já nasceu com `tz`; os que dependiam de relógio de parede ganharam o seu em A5-03.)
  await alertasQueue.add(
    'verificar-token-google',
    {},
    {
      repeat:           { ...AGENDA['verificar-token-google'] },
      jobId:            'verificar-token-google-diario',
      removeOnComplete: 3,
      removeOnFail:     3,
    }
  );

  // Fase 3.3 do cronograma (20/09/2026) — reprocessa onboardings cuja sincronização com a
  // Camila falhou (indisponibilidade externa); a cada 15 min é frequente o bastante sem
  // martelar a API da Camila, e a operação já é idempotente (marcarSincronizacaoCamila).
  await alertasQueue.add(
    'reprocessar-sync-camila',
    {},
    {
      repeat:           { pattern: '*/15 * * * *' },
      jobId:            'reprocessar-sync-camila-recorrente',
      removeOnComplete: 3,
      removeOnFail:     3,
    }
  );

  // Fase 6 (21/09/2026) — mesmo raciocínio do retry da Camila, pro Google Drive: achado real
  // desta sessão, o GOOGLE_REFRESH_TOKEN ficou morto por 11 dias e nenhum cliente novo ganhava
  // pasta, sem nenhum retry automático quando a credencial voltasse. 30 min (mais espaçado que
  // a Camila) porque a API do Drive tem cota mais sensível e a urgência é menor — cadastro em
  // si já é concluído sem a pasta, ela só chega depois.
  await alertasQueue.add(
    'reprocessar-sync-drive',
    {},
    {
      repeat:           { pattern: '*/30 * * * *' },
      jobId:            'reprocessar-sync-drive-recorrente',
      removeOnComplete: 3,
      removeOnFail:     3,
    }
  );

  // A5-03: mudar padrão ou `tz` de um repeatable cria um agendamento NOVO e mantém o antigo no
  // Redis — sem esta limpeza, o bom dia sairia às 05h (UTC antigo) e às 08h, e o backup 2x por dia.
  // Roda depois dos `add` acima, para nunca haver um instante sem agendamento.
  await removerAgendamentosAntigos(backupQueue, ['backup-diario']);
  await removerAgendamentosAntigos(alertasQueue, [
    'lembretes-diarios', 'ciclos-recorrentes', 'escalonamento-vespera', 'verificar-token-google',
  ]);

  console.log('[Workers] Sync DataJud (a cada hora), Backup (02h BRT), Alertas WhatsApp (08h BRT, seg-sex), Ciclos Recorrentes (07h BRT), Escalonamento de Véspera (08h30/16h30 BRT, seg-sex), Reprocessamento de Sync Camila (15/15min), Reprocessamento de Sync Drive (30/30min) e Teste do token Google (08h BRT) iniciados.');
  // Lista dos agendamentos vivos no Redis, com a próxima execução já em Brasília: se algum horário
  // estiver errado (ou sobrar um agendamento antigo), aparece aqui no primeiro deploy.
  for (const fila of [syncQueue, backupQueue, alertasQueue, sacQueue]) {
    for (const linha of await descreverAgendamentos(fila)) console.log(`[Workers] Agendamento: ${linha}`);
  }
}

// Dispara sync imediato de um processo — fila separada, não bloqueia pelo lote
export async function enfileirarSincronizarProcesso(processoId) {
  await individualSyncQueue.add('sincronizar-processo', { processoId }, {
    jobId:            `sync-proc-${processoId}`,
    attempts:         2,
    backoff:          { type: 'fixed', delay: 10_000 },
    removeOnComplete: 20,
    removeOnFail:     10,
  });
}

export { syncQueue, individualSyncQueue, backupQueue, alertasQueue };
