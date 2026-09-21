// Script de uso único: reautoriza a conta Google do Drive e gera um novo GOOGLE_REFRESH_TOKEN.
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
  scope: ['https://www.googleapis.com/auth/drive'],
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
  } catch (e) {
    console.error('\nFalha ao trocar o código pelo token:', e.message);
  } finally {
    server.close();
  }
});

server.listen(PORT);
