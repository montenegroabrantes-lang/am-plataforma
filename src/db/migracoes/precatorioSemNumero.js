// 27/11/2026: quando o juiz assina o precatório, a varredura do PJe cria a ficha ligada ao processo de
// origem. O número do TJPB (2º grau) só entra depois, lido no ofício requisitório ou informado à mão.
//
// Uso em src/index.js: await migrar('2026_11_27_precatorio_sem_numero', () => db.transaction(tx => aplicarPrecatorioSemNumero(tx)));
//
// Só afrouxa a obrigatoriedade de `precatorios.numero`. Nenhuma linha muda. A unicidade do número
// continua valendo (o PostgreSQL aceita várias linhas com número vazio numa restrição UNIQUE).
export async function aplicarPrecatorioSemNumero(conexao) {
  await conexao.execute('ALTER TABLE precatorios ALTER COLUMN numero DROP NOT NULL');
}
