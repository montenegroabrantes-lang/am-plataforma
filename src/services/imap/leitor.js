// Leitor IMAP do push do TJPB — alternativa ao Outlook/Graph quando a caixa que
// recebe os e-mails do PJe é um Gmail (ou qualquer provedor com IMAP), sem precisar
// registrar aplicativo na Microsoft (contas pessoais Hotmail não podem mais registrar).
//
// Devolve as mensagens no MESMO formato do Graph
// ({ id, subject, receivedDateTime, bodyPreview, body.content, from.emailAddress.address })
// para o worker e o parser do push não saberem de onde o e-mail veio.
//
// Gmail: IMAP está sempre ligado; a autenticação é por "senha de app" (exige verificação
// em duas etapas na conta). A senha só existe no Railway. Somente leitura: nada é marcado
// como lido, movido ou apagado.

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

export function imapConfigurado(env = process.env) {
  return Boolean(env.PUSH_TJ_IMAP_HOST && env.PUSH_TJ_IMAP_USER && env.PUSH_TJ_IMAP_SENHA);
}

export function pastaPush(env = process.env) {
  return env.PUSH_TJ_IMAP_PASTA || 'INBOX';
}

function configuracao(env = process.env) {
  return {
    host:   env.PUSH_TJ_IMAP_HOST,
    port:   Number(env.PUSH_TJ_IMAP_PORT) || 993,
    secure: true,
    auth:   { user: env.PUSH_TJ_IMAP_USER, pass: env.PUSH_TJ_IMAP_SENHA },
    logger: false,
    connectionTimeout: 20_000,
    greetingTimeout:   20_000,
    socketTimeout:     90_000,
  };
}

function criarClientePadrao(env) {
  return new ImapFlow(configuracao(env));
}

// O e-mail do PJe vem em HTML; o parser do push trabalha melhor em texto puro
// (o Graph já entregava texto porque pedíamos `Prefer: body-content-type="text"`).
export function htmlParaTexto(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>|<\/li>|<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// Converte uma mensagem baixada (fonte MIME) para o formato do Graph.
// O id é o Message-ID do cabeçalho (estável entre caixas e restarts); sem ele,
// UIDVALIDITY:UID, que o servidor garante único enquanto a pasta não for recriada.
export async function converterMensagem({ uid, uidValidity, envelope, internalDate, source }) {
  const parsed = source ? await simpleParser(source) : {};
  const texto = (parsed.text || htmlParaTexto(parsed.html) || '').trim();
  const remetente = parsed.from?.value?.[0]?.address || envelope?.from?.[0]?.address || '';
  const messageId = parsed.messageId || envelope?.messageId || null;
  const recebido = internalDate ? new Date(internalDate) : (parsed.date ? new Date(parsed.date) : new Date());

  return {
    id: messageId || `imap:${uidValidity}:${uid}`,
    subject: parsed.subject || envelope?.subject || '',
    receivedDateTime: recebido.toISOString(),
    bodyPreview: texto.slice(0, 255),
    body: { contentType: 'text', content: texto },
    from: { emailAddress: { address: remetente } },
  };
}

/**
 * Lista mensagens de `remetente` recebidas depois de `desdeISO`, da mais antiga
 * para a mais nova, até `limite` (mesmo contrato de services/outlook/graph.js).
 *
 * A busca IMAP por data (SINCE) só tem precisão de dia e usa o fuso do servidor,
 * então o corte exato é refeito aqui pela data interna de cada mensagem — e o
 * remetente é conferido de novo, como no Graph, para encaminhamento não passar.
 *
 * `criarCliente` existe para os testes injetarem um servidor falso.
 */
export async function listarMensagens(remetente, desdeISO, limite = 50, { criarCliente = criarClientePadrao, env = process.env } = {}) {
  const desde = new Date(desdeISO);
  const alvo  = String(remetente).toLowerCase();
  const client = criarCliente(env);

  await client.connect();
  try {
    const lock = await client.getMailboxLock(pastaPush(env));
    try {
      const uidValidity = String(client.mailbox?.uidValidity ?? '');
      const uids = await client.search({ from: remetente, since: desde }, { uid: true });
      if (!Array.isArray(uids) || uids.length === 0) return [];

      // 1ª passada: só data e envelope (barato) para cortar pela hora e ordenar.
      const candidatos = [];
      for await (const m of client.fetch(uids, { uid: true, envelope: true, internalDate: true }, { uid: true })) {
        const data = m.internalDate ? new Date(m.internalDate) : null;
        if (!data || !(data > desde)) continue;
        const de = (m.envelope?.from?.[0]?.address || '').toLowerCase();
        if (de !== alvo) continue;
        candidatos.push({ uid: m.uid, data, envelope: m.envelope });
      }
      candidatos.sort((a, b) => a.data - b.data);
      const lote = candidatos.slice(0, Math.min(Number(limite) || 50, 100));
      if (lote.length === 0) return [];

      // 2ª passada: a fonte MIME só das que vão ser processadas nesta rodada.
      const porUid = new Map(lote.map(c => [c.uid, c]));
      const mensagens = [];
      for await (const m of client.fetch(lote.map(c => c.uid), { uid: true, internalDate: true, source: true }, { uid: true })) {
        const c = porUid.get(m.uid);
        if (!c) continue;
        mensagens.push(await converterMensagem({
          uid: m.uid, uidValidity, envelope: c.envelope,
          internalDate: m.internalDate || c.data, source: m.source,
        }));
      }
      mensagens.sort((a, b) => new Date(a.receivedDateTime) - new Date(b.receivedDateTime));
      return mensagens;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

/** Confirma que host/usuário/senha funcionam e que a pasta abre. */
export async function testarConexao({ criarCliente = criarClientePadrao, env = process.env } = {}) {
  const client = criarCliente(env);
  await client.connect();
  try {
    const lock = await client.getMailboxLock(pastaPush(env));
    try {
      return { email: env.PUSH_TJ_IMAP_USER, pasta: pastaPush(env), mensagens: client.mailbox?.exists ?? null };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}
