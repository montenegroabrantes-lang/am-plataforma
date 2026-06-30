import { Worker } from 'bullmq';
import { redis }  from '../cache/redis.js';

export function criarPublicacoesWorker() {
  const worker = new Worker('publicacoes', async (job) => {
    const { db }                   = await import('../db/index.js');
    const { sincronizarPublicacoes } = await import('../services/tribunal/comunica.js');

    // Busca OABs configuradas em configuracoes (categoria='publicacoes')
    const oabs = await db.query(
      `SELECT chave, valor FROM configuracoes WHERE categoria = 'publicacoes'`
    ).catch(() => []);

    const pares = oabs
      .filter(r => r.chave.startsWith('oab_'))
      .map(r => {
        const [numero, uf] = r.valor.split(':');
        return { numero, uf: uf || 'PB' };
      });

    if (pares.length === 0) {
      console.warn('[Publicacoes] Nenhuma OAB configurada em configuracoes (categoria=publicacoes). Pulando.');
      return;
    }

    let totalInseridas = 0, totalVinculadas = 0;
    for (const { numero, uf } of pares) {
      const { inseridas, vinculadas } = await sincronizarPublicacoes(db, numero, uf, 3);
      totalInseridas  += inseridas;
      totalVinculadas += vinculadas;
    }

    console.log(`[Publicacoes] Job concluído — ${totalInseridas} novas, ${totalVinculadas} vinculadas.`);
  }, { connection: redis, concurrency: 1 });

  worker.on('failed', (job, err) => {
    console.error(`[Publicacoes] Job ${job?.id} falhou:`, err.message);
  });

  return worker;
}
