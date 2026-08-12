// Autenticação com o Microsoft Graph (Outlook) via refresh token.
//
// O Graph é REST puro — não precisa de SDK. Usamos fetch nativo (Node 18+).
//
// O access token dura ~1h; guardamos em memória e renovamos sozinho quando falta
// menos de 5 minutos, para não pedir token a cada consulta do worker.
//
// tenant 'common' aceita tanto conta corporativa (Microsoft 365) quanto pessoal
// (outlook.com/hotmail) — não é preciso saber qual antes de configurar.

const TENANT = process.env.OUTLOOK_TENANT || 'common';
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;

// offline_access é o que garante o refresh token; Mail.Read é só leitura —
// o sistema nunca envia, apaga ou move e-mail.
export const ESCOPOS = 'offline_access Mail.Read';

let cache = { token: null, expiraEm: 0 };

export function outlookConfigurado() {
  return Boolean(
    process.env.OUTLOOK_CLIENT_ID &&
    process.env.OUTLOOK_CLIENT_SECRET &&
    process.env.OUTLOOK_REFRESH_TOKEN
  );
}

/**
 * Devolve um access token válido do Graph, renovando se necessário.
 * Lança erro com a mensagem da Microsoft quando a renovação falha — o chamador
 * precisa saber a diferença entre "não respondeu" e "não havia nada"; ver o
 * histórico do DataJud, que ficou 22 dias morto porque a falha era engolida.
 */
export async function obterAccessToken() {
  if (!outlookConfigurado()) {
    throw new Error('Outlook não configurado — faltam OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET ou OUTLOOK_REFRESH_TOKEN.');
  }

  const agora = Date.now();
  if (cache.token && cache.expiraEm - agora > 5 * 60_000) return cache.token;

  const corpo = new URLSearchParams({
    client_id:     process.env.OUTLOOK_CLIENT_ID,
    client_secret: process.env.OUTLOOK_CLIENT_SECRET,
    refresh_token: process.env.OUTLOOK_REFRESH_TOKEN,
    grant_type:    'refresh_token',
    scope:         ESCOPOS,
  });

  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: corpo,
  });

  const dados = await resp.json().catch(() => ({}));

  if (!resp.ok || !dados.access_token) {
    const detalhe = dados.error_description || dados.error || `HTTP ${resp.status}`;
    throw new Error(`Falha ao renovar token do Outlook: ${detalhe}`);
  }

  cache = {
    token:    dados.access_token,
    expiraEm: agora + (Number(dados.expires_in) || 3600) * 1000,
  };

  // A Microsoft pode rotacionar o refresh token. Quando isso acontece, o valor
  // antigo para de funcionar — avisamos alto para o token novo ir para o .env/Railway.
  if (dados.refresh_token && dados.refresh_token !== process.env.OUTLOOK_REFRESH_TOKEN) {
    console.warn('[Outlook] A Microsoft rotacionou o refresh token. Atualize OUTLOOK_REFRESH_TOKEN com:\n' + dados.refresh_token);
  }

  return cache.token;
}
