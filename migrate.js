import 'dotenv/config';
import bcrypt from 'bcrypt';
import { db } from './src/db/index.js';

// 1. Adiciona coluna grau se não existir
await db.execute(`
  ALTER TABLE processos ADD COLUMN IF NOT EXISTS grau TEXT NOT NULL DEFAULT '1'
    CHECK (grau IN ('1','2'))
`).catch(e => console.log('[migrate] grau:', e.message));

// 2. Reseta senha do Master 01
const email = process.env.MASTER_EMAIL;
const senha = process.env.MASTER_SENHA;
if (email && senha) {
  const hash = await bcrypt.hash(senha, 12);
  await db.execute(`UPDATE usuarios SET senha_hash = $1 WHERE email = $2`, [hash, email.toLowerCase()]);
  console.log(`[migrate] ✅ Senha resetada: ${email}`);
}

console.log('[migrate] ✅ Migração concluída');
await db.pool.end();
