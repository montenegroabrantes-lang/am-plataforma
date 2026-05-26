import 'dotenv/config';
import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

redis.on('connect', () => console.log('[Redis] Conectado.'));
redis.on('error',   (err) => console.error('[Redis] Erro:', err.message));

export async function conectarRedis() {
  await new Promise((resolve) => {
    if (redis.status === 'ready') return resolve();
    redis.once('ready', resolve);
    redis.once('error', resolve);
    setTimeout(resolve, 5000);
  });
}
