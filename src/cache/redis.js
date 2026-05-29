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
    redis.once('error', (err) => {
      console.warn('[Redis] Boot sem Redis — workers de sync desativados:', err.message);
      resolve();
    });
    setTimeout(() => {
      if (redis.status !== 'ready') console.warn('[Redis] Timeout na conexão — continuando sem Redis.');
      resolve();
    }, 5000);
  });
}
