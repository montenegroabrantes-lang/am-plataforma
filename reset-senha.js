import 'dotenv/config';
import bcrypt from 'bcrypt';
import { db } from './src/db/index.js';

const email = process.env.MASTER_EMAIL;
const senha = process.env.MASTER_SENHA;

if (!email || !senha) {
  console.error('MASTER_EMAIL e MASTER_SENHA precisam estar definidos');
  process.exit(1);
}

const hash = await bcrypt.hash(senha, 12);
const r = await db.execute(
  `UPDATE usuarios SET senha_hash = $1 WHERE email = $2`,
  [hash, email.toLowerCase()]
);
console.log(`✅ Senha resetada para ${email}`);
await db.pool.end();
