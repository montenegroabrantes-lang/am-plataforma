// Relatório mensal do acervo, etapa 3 (24/11/2026): o aviso do relatório entra na fila dos avisos do acervo.
// Acrescenta o tipo 'acervo_relatorio' à restrição de tipos de avisos_acervo.
//
// Uso em src/index.js (dentro de iniciar()), numa transação:
//   await migrar('2026_11_24_aviso_relatorio', () => db.transaction(tx => aplicarAvisoRelatorio(tx)));
export async function aplicarAvisoRelatorio(conexao) {
  await conexao.execute(`ALTER TABLE avisos_acervo DROP CONSTRAINT IF EXISTS avisos_acervo_tipo_check`);
  await conexao.execute(`ALTER TABLE avisos_acervo ADD CONSTRAINT avisos_acervo_tipo_check
    CHECK (tipo IN ('acervo_vigilancia','acervo_decisao','acervo_tese','acervo_relatorio'))`);
}
