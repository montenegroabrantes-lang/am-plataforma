import 'dotenv/config';
import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from './src/db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

try {
  // 1. Aplica schema completo se a tabela usuarios ainda não existir
  const tabelas = await db.query(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='usuarios'`
  );
  if (!tabelas.length) {
    console.log('[migrate] Aplicando schema.sql...');
    const sql = fs.readFileSync(path.join(__dirname, 'src/db/schema.sql'), 'utf8');
    await db.execute(sql);
    console.log('[migrate] ✅ Schema aplicado');
  } else {
    console.log('[migrate] ℹ️  Schema já existe');
  }

  // 2. Cria ou atualiza o usuário master
  const nome  = process.env.MASTER_NOME  || 'Ramona';
  const email = process.env.MASTER_EMAIL;
  const senha = process.env.MASTER_SENHA;

  if (!email || !senha) {
    console.log('[migrate] ⚠️  MASTER_EMAIL ou MASTER_SENHA não configurados');
  } else {
    const hash = await bcrypt.hash(senha, 12);
    const master = await db.queryOne(`SELECT id FROM usuarios WHERE perfil = 'master'`);

    if (master) {
      await db.execute(
        `UPDATE usuarios SET senha_hash = $1, email = $2 WHERE id = $3`,
        [hash, email.toLowerCase().trim(), master.id]
      );
      console.log(`[migrate] ✅ Senha e email do master atualizados: ${email}`);
    } else {
      await db.execute(
        `INSERT INTO usuarios (nome, email, senha_hash, perfil, pode_marcar_restrito)
         VALUES ($1, $2, $3, 'master', true)`,
        [nome, email.toLowerCase().trim(), hash]
      );
      console.log(`[migrate] ✅ Usuário master criado: ${email}`);
    }
  }

  // 3. Corrige constraint de status em processos (era aprovado/aguardando_protocolo, deve ser ativo/suspenso)
  await db.execute(`
    ALTER TABLE processos
      DROP CONSTRAINT IF EXISTS processos_status_check
  `).catch(() => {});
  await db.execute(`
    ALTER TABLE processos
      ADD CONSTRAINT processos_status_check
      CHECK (status IN ('ativo','suspenso','encerrado','arquivado'))
  `).catch(() => {});
  await db.execute(`
    ALTER TABLE processos ALTER COLUMN status SET DEFAULT 'ativo'
  `).catch(() => {});

  // 4. Adiciona coluna grau em credenciais_tribunal se ainda não existir
  await db.execute(`
    ALTER TABLE credenciais_tribunal
      ADD COLUMN IF NOT EXISTS grau TEXT NOT NULL DEFAULT '1'
        CHECK (grau IN ('1','2'))
  `).catch(() => {});

  // Recria constraint única incluindo grau (DROP IF EXISTS + ADD)
  await db.execute(`
    ALTER TABLE credenciais_tribunal
      DROP CONSTRAINT IF EXISTS credenciais_tribunal_usuario_id_tribunal_key
  `).catch(() => {});
  await db.execute(`
    ALTER TABLE credenciais_tribunal
      ADD CONSTRAINT IF NOT EXISTS credenciais_tribunal_usuario_id_tribunal_grau_key
      UNIQUE (usuario_id, tribunal, grau)
  `).catch(() => {});

  // 5. Adiciona coluna oab em credenciais_tribunal se ainda não existir
  await db.execute(`
    ALTER TABLE credenciais_tribunal
      ADD COLUMN IF NOT EXISTS oab TEXT
  `).catch(() => {});

  console.log('[migrate] ✅ Migração concluída');
} catch (err) {
  console.error('[migrate] ❌ Erro (não fatal):', err.message);
}

await db.pool.end().catch(() => {});
