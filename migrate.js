import 'dotenv/config';
import bcrypt from 'bcrypt';
import { db } from './src/db/index.js';

// 1. Adiciona coluna grau se não existir
await db.execute(`
  ALTER TABLE processos ADD COLUMN IF NOT EXISTS grau TEXT NOT NULL DEFAULT '1'
    CHECK (grau IN ('1','2'))
`).catch(e => console.log('[migrate] grau:', e.message));

// 2. Reseta senha do Master — busca por perfil=master (ignora email)
const senha = process.env.MASTER_SENHA;
if (senha) {
  const hash = await bcrypt.hash(senha, 12);
  const rows = await db.query(
    `UPDATE usuarios SET senha_hash = $1 WHERE perfil = 'master' RETURNING email`,
    [hash]
  );
  if (rows.length > 0) {
    console.log(`[migrate] ✅ Senha resetada: ${rows.map(r => r.email).join(', ')}`);
  } else {
    console.log('[migrate] ⚠️  Nenhum usuário master encontrado no banco');
  }
} else {
  console.log('[migrate] ℹ️  MASTER_SENHA não definida — senha não alterada');
}

console.log('[migrate] ✅ Migração concluída');
await db.pool.end();
