import { Worker } from 'bullmq';
import { redis }  from '../cache/redis.js';
import { db }     from '../db/index.js';
import { enviarAlerta } from '../services/digisac/index.js';

export function criarAlertasWorker() {
  return new Worker('alertas', async job => {
    if (job.name === 'lembretes-diarios') {
      await enviarLembretesDiarios();
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
