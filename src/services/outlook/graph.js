// Cliente mínimo do Microsoft Graph — só o que o push do TJ precisa: listar
// mensagens de um remetente a partir de uma data. Somente leitura.

import { obterAccessToken } from './auth.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';

async function graphGet(caminho) {
  const token = await obterAccessToken();
  const resp = await fetch(`${GRAPH}${caminho}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      // Pede o corpo em texto puro em vez de HTML — o parser trabalha melhor
      // sem tags, e o e-mail do PJe vem em HTML por padrão.
      Prefer: 'outlook.body-content-type="text"',
    },
  });

  if (!resp.ok) {
    const erro = await resp.text().catch(() => '');
    throw new Error(`Graph ${resp.status}: ${erro.slice(0, 300)}`);
  }
  return resp.json();
}

/**
 * Lista mensagens de um remetente recebidas depois de `desdeISO`.
 * Ordena da mais antiga para a mais nova para processar em ordem cronológica —
 * assim o histórico do processo é montado na sequência correta.
 *
 * @param {string} remetente  ex: 'pje@tjpb.jus.br'
 * @param {string} desdeISO   ISO 8601 (ex: '2026-08-12T00:00:00Z')
 * @param {number} limite     máximo de mensagens por rodada
 */
export async function listarMensagens(remetente, desdeISO, limite = 50) {
  const filtro = [
    `receivedDateTime gt ${desdeISO}`,
    `from/emailAddress/address eq '${remetente.replace(/'/g, "''")}'`,
  ].join(' and ');

  const query = [
    `$filter=${encodeURIComponent(filtro)}`,
    `$select=${encodeURIComponent('id,subject,receivedDateTime,bodyPreview,body,from')}`,
    `$orderby=${encodeURIComponent('receivedDateTime asc')}`,
    `$top=${Math.min(Number(limite) || 50, 100)}`,
  ].join('&');

  const dados = await graphGet(`/me/messages?${query}`);
  const itens = dados.value || [];

  // Confere o remetente também do lado de cá: o $filter do Graph já restringe,
  // mas um e-mail encaminhado ou com display name parecido não deve passar por engano.
  const alvo = remetente.toLowerCase();
  return itens.filter(m => (m.from?.emailAddress?.address || '').toLowerCase() === alvo);
}

/** Confirma que as credenciais funcionam e devolve o endereço da caixa lida. */
export async function testarConexao() {
  const eu = await graphGet('/me?$select=mail,userPrincipalName,displayName');
  return { email: eu.mail || eu.userPrincipalName, nome: eu.displayName };
}
