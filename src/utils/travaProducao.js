// Trava dos scripts manuais que mexem em usuário (reset-senha.js, src/db/seed.js) — S-06.
// Eles leem MASTER_EMAIL/MASTER_SENHA e, rodados por engano (ou por `railway run`) contra o
// banco de produção, trocariam a senha de um Master sem ninguém decidir isso. Em produção
// só rodam com o argumento explícito --confirmo.
//
// "Produção" = NODE_ENV=production OU um DATABASE_URL que não aponta para a própria máquina:
// `railway run` injeta as variáveis do serviço, mas nem sempre o NODE_ENV.
const HOSTS_LOCAIS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function ambienteDeProducao(env = process.env) {
  if (env.NODE_ENV === 'production') return true;
  const url = env.DATABASE_URL;
  if (!url) return false;
  try {
    return !HOSTS_LOCAIS.has(new URL(url).hostname.toLowerCase());
  } catch {
    // URL ilegível: na dúvida, trata como produção (só custa digitar --confirmo).
    return true;
  }
}

// Devolve true se pode seguir. Em produção sem --confirmo, avisa e devolve false
// (o script chama process.exit(1)).
export function confirmacaoEmProducaoOk({ argv = process.argv, env = process.env, aviso = console.error } = {}) {
  if (!ambienteDeProducao(env)) return true;
  if (argv.slice(2).includes('--confirmo')) return true;
  aviso('Recusado: este script altera usuários e o ambiente parece ser de PRODUÇÃO.');
  aviso('Se é isso mesmo que você quer, rode de novo acrescentando --confirmo ao comando.');
  return false;
}
