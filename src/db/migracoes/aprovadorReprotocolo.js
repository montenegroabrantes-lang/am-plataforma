// S-05 / D-S4 (30/09/2026): o aprovador do re-protocolo passa a poder ser marcado no cadastro do usuário
// (usuarios.aprova_reprotocolo), COMBINADO com REPROTOCOLO_APROVADORES (união — ver
// services/reprotocolo/pacote.js). Aditivo e idempotente; nunca apaga nem desmarca ninguém.
//
// Uso em src/index.js (dentro de iniciar()):
//   await migrar('2026_10_S05_aprovador_reprotocolo', () => aplicarAprovadorReprotocolo({ conexao: db, emails: aprovadoresConfigurados() }));
//
// `migrar` roda UMA vez. Se a variável estiver vazia (ou o aprovador desativado) no deploy, a coluna é
// criada e ninguém é marcado — a correção passa a ser a caixa "Aprova re-protocolo" em Configurações ›
// Usuários (só o Master 01), sem SQL. Sem marcação e sem variável, ninguém aprova (padrão seguro).
export async function aplicarAprovadorReprotocolo({ conexao, emails = [] }) {
  await conexao.execute(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS aprova_reprotocolo BOOLEAN NOT NULL DEFAULT false`);

  const lista = [...new Set(emails.map(e => String(e).trim().toLowerCase()).filter(Boolean))];
  if (!lista.length) {
    console.warn('[Migration] S-05: REPROTOCOLO_APROVADORES vazia — ninguém foi marcado como aprovador no cadastro.');
    return { marcados: [] };
  }
  // Só Master ativo, e só quem ainda não estava marcado (reexecução não gera log repetido).
  const marcados = await conexao.query(
    `UPDATE usuarios SET aprova_reprotocolo = true
      WHERE ativo = true AND perfil = 'master' AND aprova_reprotocolo = false AND lower(email) = ANY($1::text[])
      RETURNING id`,
    [lista]
  );
  for (const m of marcados) {
    await conexao.execute(
      `INSERT INTO logs_auditoria (usuario_id, acao, entidade, entidade_id, valor_depois)
       VALUES (NULL, 'definir_aprovador_reprotocolo', 'usuario', $1, $2)`,
      [m.id, JSON.stringify({ aprova_reprotocolo: true, origem: 'migracao_S05' })]
    );
  }
  if (!marcados.length) console.warn('[Migration] S-05: nenhum Master ativo casou com REPROTOCOLO_APROVADORES — marque o aprovador em Configurações › Usuários.');
  return { marcados: marcados.map(m => m.id) };
}
