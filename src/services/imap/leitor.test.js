import test from 'node:test';
import assert from 'node:assert/strict';
import { listarMensagens, converterMensagem, htmlParaTexto, imapConfigurado, testarConexao } from './leitor.js';
import { fontePush, remetentePush } from '../pushTJ/fonte.js';

const PJE = 'pje@tjpb.jus.br';

function mime({ de = `PJe TJPB <${PJE}>`, assunto, messageId, data, texto, html }) {
  const cab = [
    `From: ${de}`, 'To: advogado@exemplo.com', `Subject: ${assunto}`,
    messageId ? `Message-ID: ${messageId}` : null,
    `Date: ${new Date(data).toUTCString()}`,
    html ? 'Content-Type: text/html; charset=utf-8' : 'Content-Type: text/plain; charset=utf-8',
  ].filter(Boolean).join('\r\n');
  return Buffer.from(`${cab}\r\n\r\n${html || texto}`);
}

// Servidor IMAP falso: devolve o que o leitor pede, na ordem em que o servidor devolveria.
function clienteFalso(mensagens, { uidValidity = 777n, chamadas = [] } = {}) {
  return () => ({
    mailbox: { uidValidity, exists: mensagens.length },
    async connect() { chamadas.push('connect'); },
    async logout() { chamadas.push('logout'); },
    async getMailboxLock(pasta) { chamadas.push(`lock:${pasta}`); return { path: pasta, release: () => chamadas.push('release') }; },
    async search(q, opts) {
      chamadas.push(`search:${q.from}:${q.since instanceof Date}`);
      assert.equal(opts.uid, true);
      return mensagens.map(m => m.uid);
    },
    async *fetch(range, query) {
      chamadas.push(`fetch:${Object.keys(query).filter(k => query[k]).join(',')}`);
      for (const m of mensagens) {
        if (!range.includes(m.uid)) continue;
        yield {
          uid: m.uid, internalDate: new Date(m.data),
          envelope: { subject: m.assunto, messageId: m.messageId, from: [{ address: m.de || PJE }] },
          source: query.source ? mime(m) : undefined,
        };
      }
    },
  });
}

test('listarMensagens: filtra por hora exata e remetente, ordena da mais antiga, devolve o formato do Graph', async () => {
  const chamadas = [];
  const criarCliente = clienteFalso([
    { uid: 3, data: '2026-10-01T12:00:00Z', assunto: 'Nova', messageId: '<nova@tjpb>', texto: 'Processo 0801815-11.2026.8.15.2001 teve movimento.' },
    { uid: 1, data: '2026-10-01T08:00:00Z', assunto: 'Antiga', messageId: '<antiga@tjpb>', texto: 'ja lida' },   // antes do corte
    { uid: 2, data: '2026-10-01T10:00:00Z', assunto: 'Meio', messageId: '<meio@tjpb>', texto: 'meio' },
    { uid: 4, data: '2026-10-01T13:00:00Z', assunto: 'Encaminhada', messageId: '<fwd@x>', de: 'outro@exemplo.com', texto: 'nao e do pje' },
  ], { chamadas });

  const lista = await listarMensagens(PJE, '2026-10-01T09:00:00Z', 50, { criarCliente, env: {} });

  assert.deepEqual(lista.map(m => m.id), ['<meio@tjpb>', '<nova@tjpb>']);
  const nova = lista[1];
  assert.equal(nova.subject, 'Nova');
  assert.equal(nova.receivedDateTime, '2026-10-01T12:00:00.000Z');
  assert.equal(nova.from.emailAddress.address, PJE);
  assert.match(nova.body.content, /0801815-11\.2026\.8\.15\.2001/);
  assert.equal(nova.bodyPreview, nova.body.content.slice(0, 255));
  // Conecta, trava INBOX, busca, duas passadas de fetch (leve e com fonte), solta e sai.
  assert.deepEqual(chamadas, ['connect', 'lock:INBOX', `search:${PJE}:true`, 'fetch:uid,envelope,internalDate', 'fetch:uid,internalDate,source', 'release', 'logout']);
});

test('listarMensagens: respeita o limite pegando as mais antigas e lê a pasta configurada', async () => {
  const chamadas = [];
  const criarCliente = clienteFalso([
    { uid: 1, data: '2026-10-01T10:00:00Z', assunto: 'a', messageId: '<a@t>', texto: 'a' },
    { uid: 2, data: '2026-10-01T11:00:00Z', assunto: 'b', messageId: '<b@t>', texto: 'b' },
    { uid: 3, data: '2026-10-01T12:00:00Z', assunto: 'c', messageId: '<c@t>', texto: 'c' },
  ], { chamadas });
  const lista = await listarMensagens(PJE, '2026-09-30T00:00:00Z', 2, { criarCliente, env: { PUSH_TJ_IMAP_PASTA: 'PJe' } });
  assert.deepEqual(lista.map(m => m.subject), ['a', 'b']);
  assert.ok(chamadas.includes('lock:PJe'));
});

test('listarMensagens: caixa sem nada novo devolve [] e ainda assim solta a pasta e sai', async () => {
  const chamadas = [];
  const lista = await listarMensagens(PJE, '2026-10-01T00:00:00Z', 50, { criarCliente: clienteFalso([], { chamadas }), env: {} });
  assert.deepEqual(lista, []);
  assert.ok(chamadas.includes('release') && chamadas.at(-1) === 'logout');
});

test('listarMensagens: erro no servidor sobe para o worker (não vira "nada novo") e a conexão é encerrada', async () => {
  const chamadas = [];
  const criarCliente = () => ({
    async connect() { chamadas.push('connect'); },
    async logout() { chamadas.push('logout'); },
    async getMailboxLock() { throw new Error('AUTHENTICATIONFAILED'); },
  });
  await assert.rejects(() => listarMensagens(PJE, '2026-10-01T00:00:00Z', 50, { criarCliente, env: {} }), /AUTHENTICATIONFAILED/);
  assert.deepEqual(chamadas, ['connect', 'logout']);
});

test('converterMensagem: e-mail em HTML vira texto puro; sem Message-ID o id é UIDVALIDITY:UID', async () => {
  const msg = await converterMensagem({
    uid: 9, uidValidity: '777',
    envelope: { subject: 'Intimação', from: [{ address: PJE }] },
    internalDate: new Date('2026-10-01T15:30:00Z'),
    source: mime({ assunto: 'Intimação', data: '2026-10-01T15:30:00Z', html: '<html><body><p>Processo <b>0801815-11.2026.8.15.2001</b></p><p>Prazo: 15 dias &amp; contagem</p></body></html>' }),
  });
  assert.equal(msg.id, 'imap:777:9');
  assert.equal(msg.subject, 'Intimação');
  assert.doesNotMatch(msg.body.content, /<[a-z]+>/i);
  assert.match(msg.body.content, /Processo 0801815-11\.2026\.8\.15\.2001\s*\n\s*Prazo: 15 dias & contagem/);
});

test('htmlParaTexto: remove tags, estilos e entidades, preservando quebras de parágrafo', () => {
  assert.equal(htmlParaTexto('<style>p{}</style><div>Um&nbsp;dois</div><p>tr&ecirc;s &lt;4&gt;</p>'), 'Um dois\ntr&ecirc;s <4>');
});

test('imapConfigurado / fontePush / remetentePush: IMAP exige host, usuário e senha; IMAP vence o Outlook; remetente tem padrão', () => {
  assert.equal(imapConfigurado({}), false);
  assert.equal(imapConfigurado({ PUSH_TJ_IMAP_HOST: 'imap.gmail.com', PUSH_TJ_IMAP_USER: 'x@gmail.com' }), false);
  const imap = { PUSH_TJ_IMAP_HOST: 'imap.gmail.com', PUSH_TJ_IMAP_USER: 'x@gmail.com', PUSH_TJ_IMAP_SENHA: 's' };
  const outlook = { OUTLOOK_CLIENT_ID: 'a', OUTLOOK_CLIENT_SECRET: 'b', OUTLOOK_REFRESH_TOKEN: 'c' };
  assert.equal(fontePush({}), null);
  assert.equal(fontePush(outlook), 'outlook');
  assert.equal(fontePush(imap), 'imap');
  assert.equal(fontePush({ ...imap, ...outlook }), 'imap');
  assert.equal(remetentePush({}), 'pje@tjpb.jus.br');
  assert.equal(remetentePush({ OUTLOOK_PUSH_REMETENTE: 'a@b' }), 'a@b');
  assert.equal(remetentePush({ OUTLOOK_PUSH_REMETENTE: 'a@b', PUSH_TJ_REMETENTE: 'c@d' }), 'c@d');
});

test('testarConexao: abre a pasta e devolve a caixa lida', async () => {
  const chamadas = [];
  const r = await testarConexao({ criarCliente: clienteFalso([{ uid: 1, data: '2026-10-01T10:00:00Z', assunto: 'a', texto: 'a' }], { chamadas }), env: { PUSH_TJ_IMAP_USER: 'x@gmail.com' } });
  assert.deepEqual(r, { email: 'x@gmail.com', pasta: 'INBOX', mensagens: 1 });
  assert.deepEqual(chamadas, ['connect', 'lock:INBOX', 'release', 'logout']);
});
