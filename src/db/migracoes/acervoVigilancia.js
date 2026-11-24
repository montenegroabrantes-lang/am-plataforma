// Camada de conhecimento do acervo, fase 2 (24/11/2026). Spec "AM - Estrutura Avancada do Acervo.md":
// §4.5 vigilância jurisprudencial (temas, PUILs e julgamentos pendentes que afetam teses do escritório)
// e §4.3 decisao_id da peça (o precedente gerado pelo julgamento daquela peça).
//
// Uso em src/index.js (dentro de iniciar()), numa transação:
//   await migrar('2026_11_24_acervo_vigilancia', () => db.transaction(tx => aplicarAcervoVigilancia(tx)));
//
// Só acrescenta: tabelas novas e uma coluna anulável. Nenhum dado existente muda.
export async function aplicarAcervoVigilancia(conexao) {
  await conexao.execute(`CREATE TABLE IF NOT EXISTS acervo_vigilancia (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    referencia      TEXT NOT NULL UNIQUE,
    descricao       TEXT,
    url_fonte       TEXT,
    ultima_situacao TEXT,
    verificado_em   TIMESTAMPTZ,
    impacto         TEXT,
    ativo           BOOLEAN NOT NULL DEFAULT true,
    criado_por      UUID REFERENCES usuarios(id),
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await conexao.execute(`CREATE TABLE IF NOT EXISTS acervo_vigilancia_teses (
    vigilancia_id UUID NOT NULL REFERENCES acervo_vigilancia(id) ON DELETE CASCADE,
    tese_id       UUID NOT NULL REFERENCES teses_acervo(id),
    PRIMARY KEY (vigilancia_id, tese_id)
  )`);
  await conexao.execute(`CREATE INDEX IF NOT EXISTS idx_acervo_vigilancia_teses_tese ON acervo_vigilancia_teses (tese_id)`);
  // Histórico de cada verificação (situação anterior → nova): base do alerta "o que mudou".
  await conexao.execute(`CREATE TABLE IF NOT EXISTS acervo_vigilancia_historico (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vigilancia_id      UUID NOT NULL REFERENCES acervo_vigilancia(id) ON DELETE CASCADE,
    situacao_anterior  TEXT,
    situacao_nova      TEXT,
    mudou              BOOLEAN NOT NULL,
    registrado_por     UUID REFERENCES usuarios(id),
    registrado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await conexao.execute(`CREATE INDEX IF NOT EXISTS idx_acervo_vigilancia_historico ON acervo_vigilancia_historico (vigilancia_id, registrado_em DESC)`);
  // §4.3: decisão gerada pelo julgamento da peça.
  await conexao.execute(`ALTER TABLE acervo_pecas ADD COLUMN IF NOT EXISTS decisao_id UUID REFERENCES acervo_precedentes(id) ON DELETE SET NULL`);
}
