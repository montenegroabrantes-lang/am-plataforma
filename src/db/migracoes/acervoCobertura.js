// Peças que faltam no acervo, etapa 1 (24/11/2026). Spec "AM - Spec Pecas que Faltam no Acervo.md" (Drive).
// Ligação opcional produto → tese do acervo (aprovada pelo usuário) e a marca de peça cadastrada retroativamente
// (inicial mínima criada a partir do processo; fica fora de "Peças de mérito sem argumentos", D4).
//
// Uso em src/index.js (dentro de iniciar()), numa transação:
//   await migrar('2026_11_24_acervo_cobertura', () => db.transaction(tx => aplicarAcervoCobertura(tx)));
//
// Só acrescenta: duas colunas com padrão nulo/false e um índice.
export async function aplicarAcervoCobertura(conexao) {
  await conexao.execute(`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS tese_acervo_id UUID REFERENCES teses_acervo(id) ON DELETE SET NULL`);
  await conexao.execute(`ALTER TABLE acervo_pecas ADD COLUMN IF NOT EXISTS retroativa BOOLEAN NOT NULL DEFAULT false`);
  await conexao.execute(`CREATE INDEX IF NOT EXISTS idx_acervo_pecas_processo ON acervo_pecas (processo_id) WHERE arquivada_em IS NULL`);
}
