import { db } from '../db/index.js';

// Resolve o vínculo funcional automático de um cliente: só preenche quando existe
// exatamente um vínculo ativo. Com 0 ou 2+ vínculos ativos retorna null — a escolha
// do polo passivo fica para quem protocola, para nunca atribuir o processo ao órgão errado.
export async function vinculoUnicoAtivo(clienteId, pgClient = db) {
  if (!clienteId) return null;
  const executor = pgClient.query ? pgClient : db;
  const resultado = await executor.query(
    `SELECT id, polo_passivo FROM cliente_vinculos WHERE cliente_id=$1 AND vinculo_ativo=true`,
    [clienteId]
  );
  const linhas = resultado.rows || resultado; // aceita tanto pg.Client quanto o wrapper db
  return Array.isArray(linhas) && linhas.length === 1 ? linhas[0] : null;
}
