import { Worker, Queue } from 'bullmq';
import { redis }  from '../cache/redis.js';
import { db }     from '../db/index.js';
import { criarEventoCalendar } from '../services/calendar/index.js';

export const audienciaQueue = new Queue('audiencia', { connection: redis });

// Padrões que indicam audiência numa movimentação
const PADROES_AUDIENCIA = [
  /audiência\s+(de\s+)?(instrução|conciliação|julgamento|una|inaugural)/i,
  /designad[ao]\s+audiência/i,
  /data\s+da\s+audiência/i,
  /fica\s+designad[ao]\s+para\s+audiência/i,
];

// Extrai data e tipo da audiência do texto da movimentação
function extrairAudiencia(texto) {
  const dataMatch = texto.match(/(\d{2})\/(\d{2})\/(\d{4})\s+às?\s+(\d{2})[h:](\d{2})/i)
    || texto.match(/(\d{2})\/(\d{2})\/(\d{4})/);

  if (!dataMatch) return null;

  let dataHora;
  if (dataMatch[5] !== undefined) {
    dataHora = new Date(`${dataMatch[3]}-${dataMatch[2]}-${dataMatch[1]}T${dataMatch[4]}:${dataMatch[5]}:00`);
  } else {
    dataHora = new Date(`${dataMatch[3]}-${dataMatch[2]}-${dataMatch[1]}T09:00:00`);
  }

  if (isNaN(dataHora)) return null;

  let tipo = 'instrucao';
  if (/conciliação/i.test(texto)) tipo = 'conciliacao';
  if (/julgamento/i.test(texto))  tipo = 'julgamento';

  return { dataHora, tipo };
}

export function criarAudienciaWorker() {
  const worker = new Worker(
    'audiencia',
    async (job) => {
      const { movimentacaoId } = job.data;

      const mov = await db.queryOne(
        `SELECT m.*, p.numero, p.tribunal, p.vara, p.cliente_id,
                p.master_responsavel_id,
                c.nome AS cliente_nome
         FROM movimentacoes m
         JOIN processos p ON p.id = m.processo_id
         LEFT JOIN clientes c ON c.id = p.cliente_id
         WHERE m.id = $1`,
        [movimentacaoId]
      );

      if (!mov) return;

      const temAudiencia = PADROES_AUDIENCIA.some(p => p.test(mov.texto));
      if (!temAudiencia) return;

      const audienciaInfo = extrairAudiencia(mov.texto);
      if (!audienciaInfo) return;

      // Verifica se audiência já existe para esse processo nessa data
      const existe = await db.queryOne(
        `SELECT id FROM audiencias WHERE processo_id = $1 AND data_hora::date = $2::date`,
        [mov.processo_id, audienciaInfo.dataHora]
      );
      if (existe) return;

      const [nova] = await db.query(
        `INSERT INTO audiencias (processo_id, data_hora, tipo, vara)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [mov.processo_id, audienciaInfo.dataHora, audienciaInfo.tipo, mov.vara]
      );

      console.log(`[Audiência] Detectada: processo ${mov.numero} em ${audienciaInfo.dataHora.toISOString()}`);

      // Cria no Google Calendar
      const eventId = await criarEventoCalendar({
        titulo:    `Audiência — ${mov.numero} (${mov.cliente_nome || 'cliente'})`,
        dataHora:  audienciaInfo.dataHora,
        tipo:      audienciaInfo.tipo,
        vara:      mov.vara,
        tribunal:  mov.tribunal,
        processoId: mov.processo_id,
      });

      if (eventId) {
        await db.execute(
          'UPDATE audiencias SET google_event_id = $1 WHERE id = $2',
          [eventId, nova.id]
        );
      }
    },
    { connection: redis }
  );

  worker.on('completed', (job) => {
    console.log(`[Audiência Worker] Job ${job.id} concluído.`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[Audiência Worker] Job ${job?.id} falhou:`, err.message);
  });

  return worker;
}

// Enfileira verificação de audiência após nova movimentação
export async function verificarAudiencia(movimentacaoId) {
  await audienciaQueue.add('verificar', { movimentacaoId }, {
    attempts: 2,
    removeOnComplete: 50,
  });
}
