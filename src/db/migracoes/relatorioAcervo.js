// Relatório mensal do acervo, etapa 1 (24/11/2026). Spec "AM - Spec Relatorio Mensal do Acervo.md" (Drive).
// Retrato do mês: no fechamento, os números do relatório ficam gravados, para o relatório de um mês não
// mudar quando os dados mudarem depois (e a comparação com o mês anterior usar o que estava valendo).
//
// Uso em src/index.js (dentro de iniciar()), numa transação:
//   await migrar('2026_11_24_relatorio_acervo', () => db.transaction(tx => aplicarRelatorioAcervo(tx)));
//
// Só acrescenta: tabela nova.
export async function aplicarRelatorioAcervo(conexao) {
  await conexao.execute(`CREATE TABLE IF NOT EXISTS acervo_relatorios_mensais (
    mes         TEXT PRIMARY KEY CHECK (mes ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    dados       JSONB NOT NULL,
    fechado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fechado_por UUID REFERENCES usuarios(id)
  )`);
}
