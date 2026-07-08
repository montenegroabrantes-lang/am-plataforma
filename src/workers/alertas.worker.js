import { Worker } from 'bullmq';
import { redis }  from '../cache/redis.js';
import { db }     from '../db/index.js';
import { enviarAlerta } from '../services/digisac/index.js';
import { verificarCiclosRecorrentes } from '../services/ciclosRecorrentes.js';
import { verificarWatchdogSAC } from './sac.worker.js';

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
  }, { connection: redis, concurrency: 1 });
}

async function enviarLembretesDiarios() {
  const masters = await db.query(
    `SELECT id, nome, whatsapp FROM usuarios
     WHERE perfil = 'master' AND whatsapp IS NOT NULL AND whatsapp <> ''`
  );

  for (const master of masters) {
    const tarefas = await db.query(
      `SELECT t.urgencia, COUNT(*) AS total
       FROM tarefas t
       WHERE t.status NOT IN ('concluida','cancelada')
         AND t.validado_por = $1
       GROUP BY t.urgencia
       ORDER BY CASE t.urgencia WHEN 'CRITICO' THEN 1 WHEN 'ALTO' THEN 2 WHEN 'MEDIO' THEN 3 ELSE 4 END`,
      [master.id]
    );

    const obj     = Object.fromEntries(tarefas.map(r => [r.urgencia, Number(r.total)]));
    const critico = obj.CRITICO || 0;
    const alto    = obj.ALTO    || 0;
    const medio   = obj.MEDIO   || 0;

    if (critico + alto + medio === 0) continue;

    const linhas = [];
    if (critico > 0) linhas.push(`🔴 ${critico} Crítica${critico > 1 ? 's' : ''}`);
    if (alto    > 0) linhas.push(`🟠 ${alto} Alta${alto > 1 ? 's' : ''}`);
    if (medio   > 0) linhas.push(`🟡 ${medio} Média${medio > 1 ? 's' : ''}`);

    const msg =
      `📋 *Bom dia, ${master.nome.split(' ')[0]}!*\n\n` +
      `Resumo de tarefas pendentes:\n${linhas.join('\n')}\n\n` +
      `Acesse a plataforma para ver os detalhes.`;

    await enviarAlerta(master.whatsapp, msg);
  }

  console.log(`[Alertas] Lembretes diários enviados para ${masters.length} master(s).`);
}

// Escalonamento de véspera — alerta diretamente o responsável (atribuído) por tarefas
// cujo prazo vence amanhã ou hoje, além de notificar o master validador em caso crítico.
async function enviarEscalonamentoVespera() {
  const tarefas = await db.query(
    `SELECT t.id, t.descricao, t.tipo, t.prazo_data,
            (t.prazo_data::date - CURRENT_DATE) AS dias_restantes,
            ua.id AS atribuido_id, ua.nome AS atribuido_nome, ua.whatsapp AS atribuido_whatsapp,
            um.id AS master_id, um.nome AS master_nome, um.whatsapp AS master_whatsapp
     FROM tarefas t
     JOIN usuarios ua ON ua.id = t.atribuido_a
     LEFT JOIN usuarios um ON um.id = t.validado_por
     WHERE t.status NOT IN ('concluida', 'cancelada', 'devolvida')
       AND t.prazo_data IS NOT NULL
       AND (t.prazo_data::date - CURRENT_DATE) IN (0, 1)`
  );

  const porResponsavel = new Map();
  for (const t of tarefas) {
    if (!t.atribuido_whatsapp) continue;
    if (!porResponsavel.has(t.atribuido_id)) porResponsavel.set(t.atribuido_id, { nome: t.atribuido_nome, whatsapp: t.atribuido_whatsapp, tarefas: [] });
    porResponsavel.get(t.atribuido_id).tarefas.push(t);
  }

  for (const { nome, whatsapp, tarefas: lista } of porResponsavel.values()) {
    const linhas = lista.map(t => {
      const quando = Number(t.dias_restantes) === 0 ? 'HOJE' : 'AMANHÃ';
      return `🔴 ${quando} — ${t.descricao}`;
    });
    const msg =
      `⏰ *Atenção, ${nome.split(' ')[0]}!*\n\n` +
      `Você tem ${lista.length} prazo${lista.length > 1 ? 's' : ''} vencendo:\n${linhas.join('\n')}\n\n` +
      `Acesse a plataforma para regularizar.`;
    await enviarAlerta(whatsapp, msg).catch(err => console.warn(`[Escalonamento] Falha ao alertar ${nome}:`, err.message));
  }

  console.log(`[Alertas] Escalonamento de véspera enviado para ${porResponsavel.size} responsável(is) — ${tarefas.length} tarefa(s) críticas.`);
}
