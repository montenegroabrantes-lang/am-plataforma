// Script de uso único: reautoriza a conta Google (Drive e Agenda) e gera um novo GOOGLE_REFRESH_TOKEN.
//
// O mesmo token serve o Drive (pastas de cliente, backup) e o Calendar (prazos e audiências), por
// isso o script pede os DOIS escopos (lista em src/services/google/escopos.js; o Sheets não é
// usado e não é pedido). Até 30/09/2026 pedia só `drive` e o Calendar ficava sem permissão.
// Na tela de consentimento do Google, NÃO desmarque nenhuma das permissões — o script confere
// no fim se as duas vieram e avisa se faltar. Depois de trocar a variável no Railway, o teste
// diário do token (verificar-token-google) passa a acusar se algo ainda estiver errado.
//
// Como usar:
//   1. node obter-novo-refresh-token.mjs
//   2. Abra a URL que aparecer no terminal, faça login com a conta Google que deve ter acesso
//      à pasta do Drive (GOOGLE_DRIVE_PASTA_RAIZ) e clique em "Permitir".
//   3. O navegador vai tentar voltar para http://localhost:8765/callback — este script
//      já está escutando nessa porta e vai capturar o código automaticamente.
//   4. O terminal mostra o novo GOOGLE_REFRESH_TOKEN. Copie e substitua a variável de
//      ambiente GOOGLE_REFRESH_TOKEN no Railway (projeto am-plataforma, serviço do backend).
//
// Se o Google mostrar "Erro 400: redirect_uri_mismatch", é porque http://localhost:8765/callback
// não está na lista de "URIs de redirecionamento autorizados" deste client OAuth no Google
// Cloud Console — nesse caso, adicione essa URI lá (Credenciais → o OAuth client em uso →
// URIs de redirecionamento autorizados) e rode o script de novo.
import 'dotenv/config';
import http from 'node:http';
import { google } from 'googleapis';
import { ESCOPOS_GOOGLE, escoposFaltando } from './src/services/google/escopos.js';

const PORT = 8765;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  REDIRECT_URI
);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent', // força o Google a emitir um refresh_token novo, mesmo se já tiver autorizado antes
  scope: ESCOPOS_GOOGLE,
});

console.log('\nAbra esta URL no navegador e autorize com a conta Google certa:\n');
console.log(authUrl);
console.log('\nAguardando você autorizar...\n');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  if (url.pathname !== '/callback') { res.writeHead(404); res.end(); return; }

  const erro = url.searchParams.get('error');
  if (erro) {
    res.end('Autorização recusada ou cancelada. Pode fechar esta aba.');
    console.error('\nGoogle retornou um erro:', erro);
    server.close();
    process.exit(1);
  }

  const code = url.searchParams.get('code');
  if (!code) { res.writeHead(400); res.end('Código ausente.'); return; }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    res.end('Autorizado! Pode fechar esta aba e voltar pro terminal.');
    console.log('NOVO GOOGLE_REFRESH_TOKEN:\n');
    console.log(tokens.refresh_token);
    if (!tokens.refresh_token) {
      console.warn('\nO Google não devolveu um refresh_token novo (isso acontece se a conta já tinha uma sessão de consentimento muito recente). Revogue o acesso do app em https://myaccount.google.com/permissions e rode o script de novo.');
    } else {
      console.log('\nCopie o valor acima e atualize GOOGLE_REFRESH_TOKEN no Railway.');
    }
    // A tela de consentimento deixa desmarcar permissões: confere o que o token realmente tem.
    const faltando = tokens.scope ? escoposFaltando(String(tokens.scope).split(/\s+/)) : [];
    if (faltando.length) {
      console.warn('\nATENÇÃO: este token NÃO tem todas as permissões. Faltam: ' + faltando.join(', ') + '\nRefaça a autorização sem desmarcar nada (revogue o acesso em https://myaccount.google.com/permissions se preciso).');
    }
  } catch (e) {
    console.error('\nFalha ao trocar o código pelo token:', e.message);
  } finally {
    server.close();
  }
});

server.listen(PORT);
