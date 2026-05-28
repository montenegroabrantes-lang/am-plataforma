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

  // Recria constraint única incluindo grau (DROP IF EXISTS + ADD condicional)
  await db.execute(`
    ALTER TABLE credenciais_tribunal
      DROP CONSTRAINT IF EXISTS credenciais_tribunal_usuario_id_tribunal_key
  `).catch(() => {});
  await db.execute(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'credenciais_tribunal_usuario_id_tribunal_grau_key'
      ) THEN
        ALTER TABLE credenciais_tribunal
          ADD CONSTRAINT credenciais_tribunal_usuario_id_tribunal_grau_key
          UNIQUE (usuario_id, tribunal, grau);
      END IF;
    END $$
  `).catch(() => {});

  // 5. Adiciona coluna oab em credenciais_tribunal se ainda não existir
  await db.execute(`
    ALTER TABLE credenciais_tribunal
      ADD COLUMN IF NOT EXISTS oab TEXT
  `).catch(() => {});

  // 6. documentos: adiciona coluna deletado, torna drive_file_id/drive_url nullable, expande categorias
  await db.execute(`ALTER TABLE documentos ADD COLUMN IF NOT EXISTS deletado BOOLEAN NOT NULL DEFAULT false`).catch(() => {});
  await db.execute(`ALTER TABLE documentos ALTER COLUMN drive_file_id DROP NOT NULL`).catch(() => {});
  await db.execute(`ALTER TABLE documentos ALTER COLUMN drive_url DROP NOT NULL`).catch(() => {});
  await db.execute(`ALTER TABLE documentos DROP CONSTRAINT IF EXISTS documentos_categoria_check`).catch(() => {});
  await db.execute(`
    ALTER TABLE documentos
      ADD CONSTRAINT documentos_categoria_check
      CHECK (categoria IN ('pessoais','vinculo','procuracao','outro'))
  `).catch(() => {});

  // 7. usuarios: whatsapp para alertas
  await db.execute(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS whatsapp TEXT`).catch(() => {});

  // 8. tarefas: cliente_produto_id + numero_processo_inserido + índice único protocolo
  await db.execute(`ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS cliente_produto_id UUID REFERENCES cliente_produtos(id)`).catch(() => {});
  await db.execute(`ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS numero_processo_inserido TEXT`).catch(() => {});
  await db.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_tarefa_protocolo_ativa
    ON tarefas (cliente_produto_id, tipo)
    WHERE status NOT IN ('concluida', 'cancelada')
  `).catch(() => {});

  // 9. processos: sync_status
  await db.execute(`ALTER TABLE processos ADD COLUMN IF NOT EXISTS sync_status TEXT DEFAULT 'aguardando_primeira_captura'`).catch(() => {});

  console.log('[migrate] ✅ Migração concluída');
} catch (err) {
  console.error('[migrate] ❌ Erro (não fatal):', err.message);
}

await db.pool.end().catch(() => {});
