// S-03 (30/09/2026) — sessão revogável. Idempotente (IF NOT EXISTS) e não destrutiva: só acrescenta uma
// coluna com valor padrão e uma tabela nova. Usada por src/index.js via migrar('2026_10_S03_sessao_revogavel', ...),
// SEM .catch: se falhar, o boot falha e o /health segue em 503 (o Railway não promove o deploy).
//
// `usuarios.sessao_versao`: todo token carrega a versão da conta; subir a versão derruba todos.
// `sessoes_refresh`: um refresh token por linha (só o hash SHA-256), agrupados em "família" (um
// navegador/login). `familia_expira_em` é a validade ABSOLUTA da família (30 dias desde o login):
// o refresh renova 7 dias a cada uso, mas nunca passa dessa data.
export const SQL_MIGRACAO_SESSAO = [
  `ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS sessao_versao INTEGER NOT NULL DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS sessoes_refresh (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id        UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    familia           UUID NOT NULL,
    token_hash        TEXT NOT NULL UNIQUE,
    criado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expira_em         TIMESTAMPTZ NOT NULL,
    familia_expira_em TIMESTAMPTZ NOT NULL,
    usado_em          TIMESTAMPTZ,
    revogado_em       TIMESTAMPTZ,
    ip                TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessoes_refresh_usuario ON sessoes_refresh (usuario_id, familia)`,
  `CREATE INDEX IF NOT EXISTS idx_sessoes_refresh_familia ON sessoes_refresh (familia)`,
];

export async function migrarSessaoRevogavel(execute) {
  for (const sql of SQL_MIGRACAO_SESSAO) await execute(sql);
}
