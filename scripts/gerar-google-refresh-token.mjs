// Gera o GOOGLE_REFRESH_TOKEN a partir do Client ID/Secret criados no Google Cloud Console.
// Uso:
//   GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy node scripts/gerar-google-refresh-token.mjs
//
// O script abre uma URL de autorização — abra no navegador, faça login com a conta
// Google que vai hospedar o calendário do escritório, autorize o acesso, e cole
// o código exibido de volta aqui no terminal.

import { google } from 'googleapis';
import readline from 'readline';

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI  = 'urn:ietf:wg:oauth:2.0:oob'; // fluxo "app para computador" — sem servidor web

if (!CLIENT_ID || CLIENT_ID === 'configurar_no_railway' || !CLIENT_SECRET || CLIENT_SECRET === 'configurar_no_railway') {
  console.error('Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET (valores reais do Google Cloud Console) antes de rodar.');
  console.error('Exemplo: GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy node scripts/gerar-google-refresh-token.mjs');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',   // obrigatório para receber o refresh_token
  prompt: 'consent',        // força reenvio do refresh_token mesmo se já autorizado antes
  scope: ['https://www.googleapis.com/auth/calendar'],
});

console.log('\n1) Abra esta URL no navegador (faça login com a conta Google do calendário do escritório):\n');
console.log(authUrl);
console.log('\n2) Depois de autorizar, o Google vai mostrar um código na tela. Cole ele aqui e pressione Enter:\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Código: ', async (code) => {
  rl.close();
  try {
    const { tokens } = await oauth2Client.getToken(code.trim());
    console.log('\n✅ Sucesso! Adicione estas variáveis no Railway e no .env local:\n');
    console.log(`GOOGLE_CLIENT_ID=${CLIENT_ID}`);
    console.log(`GOOGLE_CLIENT_SECRET=${CLIENT_SECRET}`);
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    if (!tokens.refresh_token) {
      console.warn('\n⚠ Nenhum refresh_token retornado. Revogue o acesso do app em https://myaccount.google.com/permissions e rode o script de novo.');
    }
  } catch (e) {
    console.error('\nErro ao trocar o código pelo token:', e.message);
    process.exit(1);
  }
});
