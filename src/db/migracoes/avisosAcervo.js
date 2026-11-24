// Avisos do acervo por WhatsApp, etapa 1 (24/11/2026). Spec "AM - Spec Avisos do Acervo.md" (Drive, BANCO DE DADOS).
// Fila de avisos: um por evento (chave_evento única), para o Master da tarefa, despachada só em dia útil das
// 08h às 20h (Brasília). E a opção de cada usuário desligar os avisos do acervo para si (padrão ligado).
//
// Uso em src/index.js (dentro de iniciar()), numa transação:
//   await migrar('2026_11_24_avisos_acervo', () => db.transaction(tx => aplicarAvisosAcervo(tx)));
//
// Só acrescenta: tabela nova e uma coluna com padrão.
export async function aplicarAvisosAcervo(conexao) {
  await conexao.execute(`CREATE TABLE IF NOT EXISTS avisos_acervo (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tipo          TEXT NOT NULL CONSTRAINT avisos_acervo_tipo_check CHECK (tipo IN ('acervo_vigilancia','acervo_decisao','acervo_tese')),
    chave_evento  TEXT NOT NULL,
    usuario_id    UUID NOT NULL REFERENCES usuarios(id),
    tarefa_id     UUID REFERENCES tarefas(id) ON DELETE SET NULL,
    texto         TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','enviando','enviado','falhou','incerto','descartado')),
    tentativas    INTEGER NOT NULL DEFAULT 0,
    ultimo_erro   TEXT,
    enviar_apos   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    enviado_em    TIMESTAMPTZ,
    CONSTRAINT avisos_acervo_evento_unico UNIQUE (chave_evento)
  )`);
  await conexao.execute(`CREATE INDEX IF NOT EXISTS idx_avisos_acervo_fila ON avisos_acervo (enviar_apos) WHERE status = 'pendente'`);
  await conexao.execute(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS avisos_acervo BOOLEAN NOT NULL DEFAULT true`);
}
