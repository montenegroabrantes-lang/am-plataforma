import 'dotenv/config';
import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null, // obrigatório para BullMQ
  enableReadyCheck: false,
});

redis.on('connect', () => console.log('[Redis] Conectado.'));
redis.on('error',   (err) => console.error('[Redis] Erro:', err.message));

export async function conectarRedis() {
  // ioredis conecta automaticamente — aguarda o evento ready
  await new Promise((resolve, reject) => {
    if (redis.status === 'ready') return resolve();
    redis.once('ready', resolve);
    redis.once('error', reject);
    setTimeout(resolve, 3000); // timeout de segurança
  });
}
