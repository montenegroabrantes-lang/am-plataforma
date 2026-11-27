// 27/11/2026: respostas do escritório aos pedidos de conferência das folhas de despacho (botões
// Confirmar / Descartar da tela Despachos). Cada varredura reescreve os itens; por isso a resposta
// fica em tabela própria, por processo + tipo de pergunta + documento (data) a que se refere.
// Documento de outra data = pergunta nova (a resposta antiga não vale para ele).
//
// Uso em src/index.js: await migrar('2026_11_27_despachos_conferencias', () => db.transaction(tx => aplicarDespachosConferencias(tx)));
//
// Só acrescenta: uma tabela nova e três colunas opcionais em despachos_itens. Nenhuma linha muda.
export async function aplicarDespachosConferencias(conexao) {
  await conexao.execute(`CREATE TABLE IF NOT EXISTS despachos_conferencias (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    processo_id       UUID NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
    tipo              TEXT NOT NULL,
    referencia        TEXT NOT NULL,
    resposta          TEXT NOT NULL CHECK (resposta IN ('confirmado','descartado')),
    usuario_id        UUID,
    usuario_nome      TEXT,
    respondido_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    estado_anterior   JSONB NOT NULL,
    resultado         JSONB NOT NULL,
    desfeito_em       TIMESTAMPTZ,
    desfeito_por      UUID,
    desfeito_por_nome TEXT
  )`);
  // Uma resposta em vigor por pergunta; as desfeitas ficam guardadas como histórico.
  await conexao.execute(`CREATE UNIQUE INDEX IF NOT EXISTS despachos_conferencias_ativa_idx
    ON despachos_conferencias (processo_id, tipo, referencia) WHERE desfeito_em IS NULL`);
  await conexao.execute('ALTER TABLE despachos_itens ADD COLUMN IF NOT EXISTS conferencia_tipo TEXT');
  await conexao.execute('ALTER TABLE despachos_itens ADD COLUMN IF NOT EXISTS conferencia_ref TEXT');
  await conexao.execute('ALTER TABLE despachos_itens ADD COLUMN IF NOT EXISTS conferencia_id UUID');
}
