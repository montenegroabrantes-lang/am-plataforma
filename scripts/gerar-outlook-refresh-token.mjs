// Gera o OUTLOOK_REFRESH_TOKEN a partir do Client ID/Secret criados no Azure.
//
// Antes de rodar, registre o aplicativo em https://entra.microsoft.com:
//   1. Identidade → Aplicativos → Registros de aplicativo → Novo registro
//   2. Nome: "AM Plataforma — Push TJ"
//   3. Tipos de conta: "Contas em qualquer diretório organizacional e contas Microsoft pessoais"
//   4. URI de redirecionamento: tipo "Web", valor http://localhost:53682/callback
//   5. Depois de criado: Certificados e segredos → Novo segredo do cliente → copie o VALOR
//   6. Permissões de API → Microsoft Graph → Delegadas → Mail.Read → adicionar
//
// Uso:
//   OUTLOOK_CLIENT_ID=xxx OUTLOOK_CLIENT_SECRET=yyy node scripts/gerar-outlook-refresh-token.mjs
//
// O script abre um servidor local só para receber o retorno da autorização —
// nenhuma senha passa por aqui: quem digita a senha é você, na tela da Microsoft.

import http from 'http';
import { URL } from 'url';

const CLIENT_ID     = process.env.OUTLOOK_CLIENT_ID;
const CLIENT_SECRET = process.env.OUTLOOK_CLIENT_SECRET;
const TENANT        = process.env.OUTLOOK_TENANT || 'common';
const PORTA         = 53682;
const REDIRECT_URI  = `http://localhost:${PORTA}/callback`;
const ESCOPOS       = 'offline_access Mail.Read';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Defina OUTLOOK_CLIENT_ID e OUTLOOK_CLIENT_SECRET antes de rodar.');
  console.error('Exemplo: OUTLOOK_CLIENT_ID=xxx OUTLOOK_CLIENT_SECRET=yyy node scripts/gerar-outlook-refresh-token.mjs');
  process.exit(1);
}

const authUrl = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize?` +
  new URLSearchParams({
    client_id:     CLIENT_ID,
    response_type: 'code',
    redirect_uri:  REDIRECT_URI,
    response_mode: 'query',
    scope:         ESCOPOS,
    prompt:        'consent',   // força o consentimento para o refresh token vir
  });

console.log('\n1) Abra esta URL no navegador e entre com a conta do Outlook que recebe o push do TJ:\n');
console.log(authUrl);
console.log('\n2) Autorize o acesso. Você será redirecionado de volta para cá automaticamente.\n');
console.log('Aguardando autorização...');

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORTA}`);
  if (url.pathname !== '/callback') { res.writeHead(404); res.end(); return; }

  const erro = url.searchParams.get('error');
  if (erro) {
    const descricao = url.searchParams.get('error_description') || '';
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h2>Autorização recusada</h2><p>${erro}</p><p>${descricao}</p>`);
    console.error(`\nAutorização recusada: ${erro} — ${descricao}`);
    servidor.close();
    process.exit(1);
  }

  const code = url.searchParams.get('code');
  if (!code) { res.writeHead(400); res.end('Sem código.'); return; }

  try {
    const resp = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        redirect_uri:  REDIRECT_URI,
        grant_type:    'authorization_code',
        scope:         ESCOPOS,
      }),
    });

    const dados = await resp.json();

    if (!resp.ok || !dados.refresh_token) {
      throw new Error(dados.error_description || dados.error || `HTTP ${resp.status} sem refresh_token`);
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h2>Pronto</h2><p>Pode fechar esta aba e voltar ao terminal.</p>');

    console.log('\n✅ Sucesso. Adicione estas variáveis no Railway e no .env local:\n');
    console.log(`OUTLOOK_CLIENT_ID=${CLIENT_ID}`);
    console.log(`OUTLOOK_CLIENT_SECRET=${CLIENT_SECRET}`);
    console.log(`OUTLOOK_REFRESH_TOKEN=${dados.refresh_token}`);
    console.log(`OUTLOOK_PUSH_REMETENTE=pje@tjpb.jus.br`);
    if (TENANT !== 'common') console.log(`OUTLOOK_TENANT=${TENANT}`);
    console.log('\nDepois reinicie o backend: o worker sobe sozinho quando as três primeiras existirem.\n');
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h2>Erro</h2><p>${e.message}</p>`);
    console.error('\nErro ao trocar o código pelo token:', e.message);
  } finally {
    servidor.close();
    setTimeout(() => process.exit(0), 300);
  }
});

servidor.listen(PORTA);
