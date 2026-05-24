import 'dotenv/config';
import { createClient } from 'redis';

const client = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});

client.on('error', (err) => console.error('[Redis] Erro:', err.message));

let connected = false;

export async function conectarRedis() {
  if (!connected) {
    await client.connect();
    connected = true;
    console.log('[Redis] Conectado.');
  }
}

export const redis = client;
