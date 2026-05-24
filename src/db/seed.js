// Executa uma vez na implantação para criar o Master 01 (Ramona)
// Uso: node src/db/seed.js
// Lê: MASTER_NOME, MASTER_EMAIL, MASTER_SENHA do .env

import 'dotenv/config';
import bcrypt from 'bcrypt';
import { db }  from './index.js';
import fs      from 'fs';
import path    from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function seed() {
  const nome  = process.env.MASTER_NOME  || 'Ramona';
  const email = process.env.MASTER_EMAIL;
  const senha = process.env.MASTER_SENHA;

  if (!email || !senha) {
    console.error('❌ Defina MASTER_EMAIL e MASTER_SENHA no .env antes de rodar o seed.');
    process.exit(1);
  }

  // Aplica schema se tabela não existir ainda
  const tabelas = await db.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'usuarios'`
  );

  if (!tabelas.length) {
    console.log('Aplicando schema.sql...');
    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await db.execute(sql);
    console.log('Schema aplicado.');
  }

  const existe = await db.queryOne('SELECT id FROM usuarios WHERE email = $1', [email]);
  if (existe) {
    console.log(`Master 01 já existe: ${email}`);
    await db.pool.end();
    return;
  }

  const hash = await bcrypt.hash(senha, 12);

  const [master] = await db.query(
    `INSERT INTO usuarios (nome, email, senha_hash, perfil, pode_marcar_restrito)
     VALUES ($1, $2, $3, 'master', true)
     RETURNING id, nome, email`,
    [nome, email.toLowerCase().trim(), hash]
  );

  console.log(`✅ Master 01 criado: ${master.nome} <${master.email}> (id: ${master.id})`);
  await db.pool.end();
}

seed().catch(err => {
  console.error('Seed falhou:', err.message);
  process.exit(1);
});
