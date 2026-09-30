// Primeiro Master do sistema — usado só pelo migrate.js (pre-deploy do Railway).
//
// S-06 (30/09/2026): antes, a cada deploy o migrate.js regravava a senha de um Master a partir
// de MASTER_EMAIL/MASTER_SENHA e, se o e-mail não batesse com nenhum Master, trocava o e-mail do
// Master mais antigo. Quem pusesse a senha nova numa variável de ambiente "resetava" uma conta
// sem passar por nenhuma tela, e a senha antiga trocada pelo usuário voltava no deploy seguinte.
//
// Agora: só CRIA o Master quando não existe nenhum (instalação nova). Havendo qualquer Master,
// não lê a senha, não calcula hash e não toca em linha alguma — nunca altera conta existente.
// Trocar senha de Master existente é pela tela do AM ou, em emergência, pelo reset-senha.js com --confirmo.
export async function garantirMasterInicial({ db, hashSenha, env = process.env, log = console.log }) {
  const existente = await db.queryOne(`SELECT id FROM usuarios WHERE perfil = 'master' LIMIT 1`);
  if (existente) {
    log('[migrate] ℹ️  Master já cadastrado — nenhuma ação');
    return 'existente';
  }

  const nome  = env.MASTER_NOME || 'Ramona';
  const email = env.MASTER_EMAIL;
  const senha = env.MASTER_SENHA;
  if (!email || !senha) {
    log('[migrate] ⚠️  Nenhum Master cadastrado e MASTER_EMAIL/MASTER_SENHA não configurados — nenhum usuário criado');
    return 'sem_variaveis';
  }

  const hash = await hashSenha(senha);
  await db.execute(
    `INSERT INTO usuarios (nome, email, senha_hash, perfil, pode_marcar_restrito)
     VALUES ($1, $2, $3, 'master', true)`,
    [nome, email.toLowerCase().trim(), hash]
  );
  log(`[migrate] ✅ Usuário master criado: ${email}`);
  return 'criado';
}
