// Camada de conhecimento do acervo, fase 3 (24/11/2026). Spec "AM - Estrutura Avancada do Acervo.md" §4.4:
// órgão julgador como entidade (juízo, tribunal, instância, magistrado atual, padrões observados), ligado às
// peças, para medir o êxito por tese e por pedido em cada juízo.
//
// Uso em src/index.js (dentro de iniciar()), numa transação:
//   await migrar('2026_11_24_acervo_orgaos', () => db.transaction(tx => aplicarAcervoOrgaos(tx)));
//
// Só acrescenta: tabela nova e uma coluna anulável. O texto livre acervo_pecas.orgao_julgador continua.
export async function aplicarAcervoOrgaos(conexao) {
  await conexao.execute(`CREATE TABLE IF NOT EXISTS acervo_orgaos (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nome              TEXT NOT NULL,
    tribunal          TEXT NOT NULL,
    instancia         TEXT NOT NULL,
    magistrado_atual  TEXT,
    notas             TEXT,
    ativo             BOOLEAN NOT NULL DEFAULT true,
    criado_por        UUID REFERENCES usuarios(id),
    criado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT acervo_orgaos_unico UNIQUE (tribunal, nome)
  )`);
  await conexao.execute(`ALTER TABLE acervo_pecas ADD COLUMN IF NOT EXISTS orgao_julgador_id UUID REFERENCES acervo_orgaos(id) ON DELETE SET NULL`);
  await conexao.execute(`CREATE INDEX IF NOT EXISTS idx_acervo_pecas_orgao ON acervo_pecas (orgao_julgador_id) WHERE orgao_julgador_id IS NOT NULL`);
}
