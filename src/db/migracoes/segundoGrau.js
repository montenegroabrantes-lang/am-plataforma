// 27/11/2026 — Acompanhamento do 2º grau (PJe TJPB 2º grau) pela rotina /varredura-2grau.
// Os precatórios correm em segredo de justiça: o sistema guarda só o título e a data de cada
// andamento, nunca documento nem texto de decisão.
//
// Uso em src/index.js: await migrar('2026_11_27_segundo_grau', () => db.transaction(tx => aplicarSegundoGrau(tx)));
//
// Só acrescenta: duas tabelas e cinco colunas em `precatorios`. Nenhuma linha existente muda.
export async function aplicarSegundoGrau(conexao) {
  await conexao.execute(`CREATE TABLE IF NOT EXISTS precatorio_andamentos (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    precatorio_id  UUID NOT NULL REFERENCES precatorios(id) ON DELETE CASCADE,
    data           DATE NOT NULL,
    texto          TEXT NOT NULL,
    criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT precatorio_andamentos_unico UNIQUE (precatorio_id, data, texto)
  )`);
  await conexao.execute(`CREATE INDEX IF NOT EXISTS idx_precatorio_andamentos ON precatorio_andamentos (precatorio_id, data DESC)`);
  await conexao.execute(`CREATE TABLE IF NOT EXISTS segundo_grau_varreduras (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    executada_em       TIMESTAMPTZ NOT NULL,
    precatorios_lidos  INTEGER NOT NULL DEFAULT 0,
    precatorios_sem_acesso INTEGER NOT NULL DEFAULT 0,
    recursos_lidos     INTEGER NOT NULL DEFAULT 0,
    andamentos_novos   INTEGER NOT NULL DEFAULT 0,
    ignorados          INTEGER NOT NULL DEFAULT 0,
    chave_id           UUID,
    criado_em          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  // pje_acesso: 'ok' quando a rotina abriu os autos com o acesso do advogado; 'sem_acesso' quando o
  // número não apareceu na pesquisa (habilitação ainda não liberada); NULL enquanto nunca foi lido.
  await conexao.execute(`ALTER TABLE precatorios ADD COLUMN IF NOT EXISTS pje_acesso TEXT`);
  await conexao.execute(`ALTER TABLE precatorios ADD COLUMN IF NOT EXISTS pje_lido_em TIMESTAMPTZ`);
  await conexao.execute(`ALTER TABLE precatorios ADD COLUMN IF NOT EXISTS pje_classe TEXT`);
  await conexao.execute(`ALTER TABLE precatorios ADD COLUMN IF NOT EXISTS pje_orgao TEXT`);
  await conexao.execute(`ALTER TABLE precatorios ADD COLUMN IF NOT EXISTS pje_relator TEXT`);
}
