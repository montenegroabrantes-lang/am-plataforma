// Camada de conhecimento do acervo, fase 1 (23/11/2026). Spec: "AM - Estrutura Avancada do Acervo.md",
// seções 4.1 a 4.3. O acervo deixa de ser só arquivo de peças: cada tese sabe de quem é variante e em
// que situação está; os argumentos (fundamento, defesa da Fazenda, resposta, preliminar, cálculo) viram
// dado consultável; a peça diz quais argumentos e precedentes usou e o resultado de cada pedido.
//
// Uso em src/index.js (dentro de iniciar()), numa transação para não sobrar meio esquema:
//   await migrar('2026_11_23_acervo_conhecimento', () => db.transaction(tx => aplicarAcervoConhecimento(tx)));
//
// Só acrescenta colunas anuláveis ou com padrão e tabelas novas: a versão anterior do backend
// continua funcionando com o esquema novo. Nenhum dado existente é alterado (a árvore de teses e o
// status de cada tese são lançados depois, pela API, com auditoria).
export async function aplicarAcervoConhecimento(conexao) {
  // 4.1 Tese: árvore (tese-mãe), situação jurídica e skill que redige a peça.
  await conexao.execute(`ALTER TABLE teses_acervo ADD COLUMN IF NOT EXISTS tese_mae_id UUID REFERENCES teses_acervo(id)`);
  await conexao.execute(`ALTER TABLE teses_acervo ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ativa'`);
  await conexao.execute(`ALTER TABLE teses_acervo ADD COLUMN IF NOT EXISTS status_motivo TEXT`);
  await conexao.execute(`ALTER TABLE teses_acervo ADD COLUMN IF NOT EXISTS skill_slug TEXT`);
  await conexao.execute(`ALTER TABLE teses_acervo ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await conexao.execute(`ALTER TABLE teses_acervo DROP CONSTRAINT IF EXISTS teses_acervo_status_check`);
  await conexao.execute(`ALTER TABLE teses_acervo ADD CONSTRAINT teses_acervo_status_check CHECK (status IN ('ativa','em_risco','suspensa','superada'))`);
  await conexao.execute(`ALTER TABLE teses_acervo DROP CONSTRAINT IF EXISTS teses_acervo_mae_check`);
  await conexao.execute(`ALTER TABLE teses_acervo ADD CONSTRAINT teses_acervo_mae_check CHECK (tese_mae_id IS NULL OR tese_mae_id <> id)`);
  await conexao.execute(`CREATE INDEX IF NOT EXISTS idx_teses_acervo_mae ON teses_acervo (tese_mae_id) WHERE tese_mae_id IS NOT NULL`);

  // 4.2 Argumento. Uma resposta aponta para a defesa da Fazenda que rebate (responde_a_id).
  await conexao.execute(`CREATE TABLE IF NOT EXISTS acervo_argumentos (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tese_id       UUID NOT NULL REFERENCES teses_acervo(id),
    tipo          TEXT NOT NULL CHECK (tipo IN ('fundamento','defesa_fazenda','resposta','preliminar','calculo')),
    titulo        TEXT NOT NULL,
    responde_a_id UUID REFERENCES acervo_argumentos(id),
    texto_modelo  TEXT,
    status        TEXT NOT NULL DEFAULT 'em_teste' CHECK (status IN ('em_teste','aprovado','abandonado')),
    observacoes   TEXT,
    criado_por    UUID REFERENCES usuarios(id),
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT acervo_argumentos_resposta_check CHECK (responde_a_id IS NULL OR (tipo = 'resposta' AND responde_a_id <> id))
  )`);
  await conexao.execute(`CREATE INDEX IF NOT EXISTS idx_acervo_argumentos_tese ON acervo_argumentos (tese_id, tipo, status)`);
  await conexao.execute(`CREATE INDEX IF NOT EXISTS idx_acervo_argumentos_responde ON acervo_argumentos (responde_a_id) WHERE responde_a_id IS NOT NULL`);
  await conexao.execute(`CREATE TABLE IF NOT EXISTS acervo_argumentos_precedentes (
    argumento_id  UUID NOT NULL REFERENCES acervo_argumentos(id) ON DELETE CASCADE,
    precedente_id UUID NOT NULL REFERENCES acervo_precedentes(id) ON DELETE CASCADE,
    PRIMARY KEY (argumento_id, precedente_id)
  )`);
  await conexao.execute(`CREATE INDEX IF NOT EXISTS idx_acervo_argumentos_precedentes_prec ON acervo_argumentos_precedentes (precedente_id)`);

  // 4.3 Peça: argumentos usados, precedentes citados, data da decisão e resultado por pedido.
  await conexao.execute(`ALTER TABLE acervo_pecas ADD COLUMN IF NOT EXISTS data_decisao DATE`);
  await conexao.execute(`ALTER TABLE acervo_pecas ADD COLUMN IF NOT EXISTS resultado_por_pedido JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await conexao.execute(`CREATE TABLE IF NOT EXISTS acervo_pecas_argumentos (
    peca_id      UUID NOT NULL REFERENCES acervo_pecas(id) ON DELETE CASCADE,
    argumento_id UUID NOT NULL REFERENCES acervo_argumentos(id) ON DELETE CASCADE,
    PRIMARY KEY (peca_id, argumento_id)
  )`);
  await conexao.execute(`CREATE INDEX IF NOT EXISTS idx_acervo_pecas_argumentos_arg ON acervo_pecas_argumentos (argumento_id)`);
  await conexao.execute(`CREATE TABLE IF NOT EXISTS acervo_pecas_precedentes (
    peca_id       UUID NOT NULL REFERENCES acervo_pecas(id) ON DELETE CASCADE,
    precedente_id UUID NOT NULL REFERENCES acervo_precedentes(id) ON DELETE CASCADE,
    PRIMARY KEY (peca_id, precedente_id)
  )`);
  await conexao.execute(`CREATE INDEX IF NOT EXISTS idx_acervo_pecas_precedentes_prec ON acervo_pecas_precedentes (precedente_id)`);
  // A busca do impacto parte da tese para as peças.
  await conexao.execute(`CREATE INDEX IF NOT EXISTS idx_acervo_pecas_teses_tese ON acervo_pecas_teses (tese_id)`);
}
