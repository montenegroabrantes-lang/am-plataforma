import { google } from 'googleapis';
import { db } from '../../db/index.js';
import { enviarAlerta } from '../digisac/index.js';
import { escoposFaltando } from './escopos.js';

// R-01 (30/09/2026): teste diário do GOOGLE_REFRESH_TOKEN. Em 21/09 o token morreu e ficou 11
// dias assim sem que nada avisasse ninguém (Drive sem pasta de cliente, backup sem destino);
// em 29/09 morreu de novo (invalid_grant). O retry de 30 em 30 minutos do Drive bate no erro
// pra sempre em silêncio. Aqui o token é renovado de verdade uma vez por dia e o resultado
// vira alerta por WhatsApp (via enviarAlerta, R-05) — com o escopo conferido, porque token
// vivo sem `calendar` também deixa a Agenda muda (A4-02, hipótese ii).

const ausente = v => !v || v === 'configurar_no_railway';

// Erros do Google que dizem "a credencial não presta" (refazer a autorização). Qualquer outro
// (rede, 5xx) é "não deu pra testar" — não se afirma que o token morreu.
const CODIGOS_DEFINITIVOS = ['invalid_grant', 'invalid_client', 'unauthorized_client'];

export function codigoErroGoogle(err) {
  const codigo = err?.response?.data?.error;
  if (typeof codigo === 'string') return codigo;
  const m = String(err?.message || '').match(/invalid_grant|invalid_client|unauthorized_client/i);
  return m ? m[0].toLowerCase() : null;
}

function criarOAuth2Padrao(env) {
  const oauth2 = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: env.GOOGLE_REFRESH_TOKEN });
  return oauth2;
}

// A resposta da renovação já traz `scope`; se por algum motivo não vier, pergunta ao tokeninfo.
// Sem resposta nenhuma devolve null (escopo desconhecido) — nesse caso não se alerta por escopo.
async function escoposConcedidos(oauth2, accessToken) {
  const escopo = oauth2.credentials?.scope;
  if (typeof escopo === 'string' && escopo.trim()) return escopo.trim().split(/\s+/);
  try {
    const info = await oauth2.getTokenInfo(accessToken);
    return Array.isArray(info?.scopes) ? info.scopes : null;
  } catch {
    return null;
  }
}

const NOME_ESCOPO = {
  'https://www.googleapis.com/auth/drive': 'Drive',
  'https://www.googleapis.com/auth/calendar': 'Agenda (Calendar)',
};

const COMO_REFAZER =
  'Como refazer: no repositório do backend, rode "node obter-novo-refresh-token.mjs", autorize com a conta Google do escritório ' +
  '(ele pede Drive e Agenda; não desmarque nenhuma) e troque a variável GOOGLE_REFRESH_TOKEN no Railway.';

// Texto do alerta pra cada resultado; null quando está tudo certo. Sem segredo nenhum:
// só o código de erro do Google e instruções.
export function montarAlertaGoogle({ status, faltando = [], detalhe = '' }) {
  if (status === 'ok') return null;
  if (status === 'sem_escopo') {
    const nomes = faltando.map(e => NOME_ESCOPO[e] || e).join(' e ');
    return `🟠 *Google: autorização sem todas as permissões*\n\nO token do Google está válido, mas não tem permissão para: ${nomes}. ` +
      `Sem isso, o que depende desse serviço não funciona (Agenda: prazos não vão para o calendário; Drive: pastas e backup).\n\n${COMO_REFAZER}`;
  }
  if (status === 'nao_configurado') {
    return '🔴 *Google: credencial ausente no servidor*\n\nGOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET ou GOOGLE_REFRESH_TOKEN não estão definidos. ' +
      'Clientes novos ficam sem pasta no Drive, o backup não chega ao Drive e os prazos não vão para a Agenda.';
  }
  if (status === 'indeterminado') {
    return `🟡 *Google: não foi possível testar a autorização hoje*\n\nO teste diário do token falhou por um erro que não indica, por si só, credencial inválida (${detalhe || 'sem detalhe'}). ` +
      'Pode ser instabilidade passageira; o teste roda de novo amanhã. Se as pastas do Drive ou o backup também falharem, refaça a autorização.';
  }
  // invalid_grant, invalid_client, unauthorized_client
  return `🔴 *Google: autorização do AM recusada (${status})*\n\nO Google recusou o token de acesso. Enquanto isso não for refeito: clientes novos ficam sem pasta no Drive, ` +
    `o backup diário não chega ao Drive e os prazos não vão para a Agenda.\n\n${COMO_REFAZER}\n\n` +
    'Se isso voltar a acontecer em cerca de 7 dias, o app OAuth está em modo "Teste" no Google Cloud: publique-o "Em produção".';
}

// Avisa os masters ativos com WhatsApp (mesmo público do alerta de backup). Nunca lança.
export async function notificarMasters(texto, { banco = db, enviar = enviarAlerta } = {}) {
  const masters = await banco.query(
    `SELECT id, whatsapp FROM usuarios
      WHERE perfil = 'master' AND ativo = true AND whatsapp IS NOT NULL AND whatsapp <> ''`
  ).catch(() => []);
  let entregues = 0;
  for (const m of masters) {
    const r = await enviar(m.whatsapp, texto, { origem: 'google_token', usuarioId: m.id });
    if (r.ok) entregues++;
  }
  return { destinatarios: masters.length, entregues };
}

// Heartbeat em `configuracoes` (categoria google_token) pra a Sentinela (R-10) e pra qualquer
// conferência: quando foi o último teste, o resultado e o último sucesso.
async function gravarVerificacao({ status }, banco = db) {
  const agora = new Date().toISOString();
  const linhas = [['ultima_verificacao', agora], ['ultimo_status', status]];
  if (status === 'ok') linhas.push(['ultimo_ok', agora]);
  for (const [chave, valor] of linhas) {
    try {
      await banco.execute(
        `INSERT INTO configuracoes (categoria, chave, valor) VALUES ('google_token', $1, $2)
         ON CONFLICT (categoria, chave) DO UPDATE SET valor = $2, atualizado_em = NOW()`,
        [chave, valor]
      );
    } catch (err) {
      console.warn('[Google] Não deu pra gravar o resultado do teste do token:', err.message);
    }
  }
}

// Renova o token de verdade (o mesmo caminho que Drive e Calendar usam), confere os escopos e
// alerta os masters se algo estiver errado. Nunca lança — é um job de vigilância.
// Retorna { status, faltando, destinatarios, entregues }; status: ok | sem_escopo |
// invalid_grant | invalid_client | unauthorized_client | nao_configurado | indeterminado.
// Tudo injetável pra teste (nada de rede nem banco).
export async function verificarTokenGoogle({
  env = process.env,
  criarOAuth2 = criarOAuth2Padrao,
  notificar = notificarMasters,
  registrar = gravarVerificacao,
} = {}) {
  let resultado;
  if (ausente(env.GOOGLE_CLIENT_ID) || ausente(env.GOOGLE_CLIENT_SECRET) || ausente(env.GOOGLE_REFRESH_TOKEN)) {
    resultado = { status: 'nao_configurado', faltando: [] };
  } else {
    try {
      const oauth2 = criarOAuth2(env);
      const { token } = await oauth2.getAccessToken();
      if (!token) throw new Error('O Google não devolveu access token.');
      const concedidos = await escoposConcedidos(oauth2, token);
      const faltando = concedidos ? escoposFaltando(concedidos) : [];
      resultado = faltando.length ? { status: 'sem_escopo', faltando } : { status: 'ok', faltando: [] };
    } catch (err) {
      const codigo = codigoErroGoogle(err);
      resultado = CODIGOS_DEFINITIVOS.includes(codigo)
        ? { status: codigo, faltando: [] }
        : { status: 'indeterminado', faltando: [], detalhe: String(err?.message || err).slice(0, 200) };
    }
  }

  try { await registrar(resultado); } catch (err) { console.warn('[Google] Falha ao registrar o teste do token:', err.message); }

  const texto = montarAlertaGoogle(resultado);
  if (!texto) {
    console.log('[Google] Teste diário do token: ok (Drive e Agenda autorizados).');
    return { ...resultado, destinatarios: 0, entregues: 0 };
  }

  console.error(`[Google] Teste diário do token: ${resultado.status}${resultado.faltando.length ? ` (faltam: ${resultado.faltando.join(', ')})` : ''}.`);
  let envio = { destinatarios: 0, entregues: 0 };
  try {
    envio = await notificar(texto);
  } catch (err) {
    console.error('[Google] Não deu pra alertar sobre o token:', err.message);
  }
  if (envio.entregues === 0) console.error('[Google] ATENÇÃO: nenhum master recebeu o alerta do token (sem WhatsApp cadastrado ou envio falhou).');
  return { ...resultado, ...envio };
}
