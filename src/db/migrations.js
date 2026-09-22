import { db } from './index.js';

// Fase 6 (resiliência) do cronograma AM Plataforma. Até 21/09/2026 toda alteração de
// schema/dado vivia como um bloco solto em src/index.js, sem registro de quando/se já
// rodou -- só "IF NOT EXISTS" defendendo contra reexecução. Isso funciona pra DDL puro,
// mas não dá visibilidade nenhuma (não dá pra saber, olhando o banco, o que já rodou) e é
// perigoso pra migração de DADOS (um bloco sem guarda idempotente reexecuta silenciosamente
// a cada boot).
//
// Esta tabela + helper NÃO substitui os blocos que já existem em src/index.js -- retrofitar
// aqueles ~50 blocos exige entender a ordem de dependência de cada um e não é seguro fazer
// de uma vez sem ambiente de staging (ver CONTEXTO-SISTEMA-AM.md, seção Fase 6). É só o ponto
// de partida pra toda migração NOVA, a partir de agora, nascer versionada.
//
// Uso (em src/index.js, dentro de iniciar(), depois da conexão ao banco):
//   import { migrar } from './db/migrations.js';
//   await migrar('2026_09_22_exemplo', async () => {
//     await db.execute(`ALTER TABLE foo ADD COLUMN bar TEXT`);
//   });
export async function garantirTabelaMigrations() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      nome        TEXT PRIMARY KEY,
      executado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

// Roda `fn` no máximo uma vez, identificada por `nome` (convenção: AAAA_MM_DD_descricao).
// Registra sucesso só depois de `fn` completar -- se `fn` lançar, a migração NÃO é marcada
// como executada e tenta de novo no próximo boot (mesma garantia que os blocos com
// `.catch(() => {})` de antes não tinham: lá, um erro era engolido pra sempre).
export async function migrar(nome, fn) {
  const jaRodou = await db.queryOne('SELECT 1 FROM schema_migrations WHERE nome = $1', [nome]);
  if (jaRodou) return;
  await fn();
  await db.execute('INSERT INTO schema_migrations (nome) VALUES ($1)', [nome]);
  console.log(`[Migration] ${nome} aplicada.`);
}
