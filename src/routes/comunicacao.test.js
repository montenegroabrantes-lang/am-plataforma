import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'segredo-de-teste';

const { db } = await import('../db/index.js');
for (const metodo of ['query', 'queryOne', 'execute']) {
  db[metodo] = async () => { throw new Error('banco real proibido nos testes'); };
}

const { autenticar } = await import('../middleware/auth.js');
const { definirCarregador, carregadorEcoDoToken } = await import('../middleware/sessao.js');
definirCarregador(carregadorEcoDoToken);
const { criarComunicacaoRouter, SQL_CLIENTES_POR_NOME, SQL_CLIENTE, SQL_ENVIO_RECENTE, SQL_VINCULAR_CONTATO, ACAO_ENVIO } = await import('./comunicacao.js');
const { CONTA_SERVICO_EMAIL } = await import('../oauth/escopos.js');
const { buscarContatosPorNome, enviarMensagemCliente } = await import('../services/digisac/index.js');

const CLIENTE = '11111111-1111-4111-8111-111111111111';
const SEM_ZAP = '22222222-2222-4222-8222-222222222222';
const PROCESSO = '33333333-3333-4333-8333-333333333333';
const CONTATO = '44444444-4444-4444-8444-444444444444';
const VINCULADO = '55555555-5555-4555-8555-555555555555';
const OUTRO_CONTATO = '66666666-6666-4666-8666-666666666666';

let envioRecente = false;
let processoVisibilidade = 'normal';
const consultas = [];
const execucoes = [];
const bancoFalso = {
  async execute(sql, params) {
    if (sql !== SQL_VINCULAR_CONTATO) throw new Error(`inesperado: ${sql}`);
    execucoes.push(params);
  },
  async query(sql, params) {
    consultas.push({ sql, params });
    if (sql.includes('FROM processos p')) {
      if (params[0] !== '08090171020248152001') return [];
      return [{ processo_id: PROCESSO, numero: '0809017-10.2024.8.15.2001', status: 'ativo', cliente_id: CLIENTE, cliente_nome: 'JOSEANE DIAS SANTOS', whatsapp: '83999991234' }];
    }
    if (sql === SQL_CLIENTES_POR_NOME) {
      if (params[0] === '%Maria%Gicele%') return [{ cliente_id: VINCULADO, cliente_nome: 'MARIA GICELE', whatsapp: null, digisac_contact_id: CONTATO }];
      return params[0] === '%Severina%Luiz%' ? [{ cliente_id: SEM_ZAP, cliente_nome: 'SEVERINA DO RAMO DAMASCENA LUIZ', whatsapp: null, digisac_contact_id: null }] : [];
    }
    throw new Error(`inesperado: ${sql}`);
  },
  async queryOne(sql, params) {
    if (sql === SQL_CLIENTE) {
      if (params[0] === CLIENTE) return { id: CLIENTE, nome: 'JOSEANE DIAS SANTOS', whatsapp: '(83) 99999-1234' };
      if (params[0] === SEM_ZAP) return { id: SEM_ZAP, nome: 'SEVERINA', whatsapp: null, digisac_contact_id: null };
      if (params[0] === VINCULADO) return { id: VINCULADO, nome: 'MARIA GICELE', whatsapp: null, digisac_contact_id: CONTATO };
      return null;
    }
    if (sql === SQL_ENVIO_RECENTE) return envioRecente ? { existe: 1 } : null;
    if (sql.startsWith('SELECT visibilidade, cliente_id FROM processos')) return { visibilidade: processoVisibilidade, cliente_id: CLIENTE };
    throw new Error(`inesperado: ${sql}`);
  },
};

const auditoria = [];
const envios = [];
let respostaEnvio = { ok: true, messageId: 'msg-1', destino: '+55 83 9****-1234' };

const app = express();
app.use(express.json());
app.use('/api/comunicacao', autenticar, criarComunicacaoRouter({
  banco: bancoFalso,
  auditar: async r => { auditoria.push(r); },
  buscarContatos: async nome => [{ contato_id: CONTATO, nome, numero_mascarado: '+55 83 9****-0000' }],
  enviar: async args => { envios.push(args); return respostaEnvio; },
  limitador: (_req, _res, next) => next(),
}));
app.use((err, _req, res, _next) => res.status(500).json({ ok: false, erro: err.message }));
const servidor = app.listen(0);
const base = `http://127.0.0.1:${servidor.address().port}`;
after(() => servidor.close());

const assinar = p => jwt.sign(p, process.env.JWT_SECRET, { expiresIn: '1h' });
const TOKENS = {
  master: assinar({ id: 'm1', perfil: 'master', email: 'master@exemplo.com' }),
  junior: assinar({ id: 'j1', perfil: 'junior', email: 'junior@exemplo.com' }),
  conectorAcervo: assinar({ id: 'svc', perfil: 'master', email: CONTA_SERVICO_EMAIL, escopos: ['acervo'] }),
  conector: assinar({ id: 'svc', perfil: 'master', email: CONTA_SERVICO_EMAIL, escopos: ['comunicacao'] }),
};

const get = async (caminho, token) => {
  const r = await fetch(`${base}${caminho}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: r.status, corpo: await r.json() };
};
const post = async (corpo, token = TOKENS.conector) => {
  const r = await fetch(`${base}/api/comunicacao/enviar`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(corpo),
  });
  return { status: r.status, corpo: await r.json() };
};

beforeEach(() => {
  auditoria.length = 0; envios.length = 0; consultas.length = 0; execucoes.length = 0;
  envioRecente = false; processoVisibilidade = 'normal';
  respostaEnvio = { ok: true, messageId: 'msg-1', destino: '+55 83 9****-1234' };
});

test('acesso: júnior e conector sem o escopo "comunicacao" → 403', async () => {
  assert.equal((await get('/api/comunicacao/localizar?nome=x', TOKENS.junior)).status, 403);
  const r = await get('/api/comunicacao/localizar?nome=x', TOKENS.conectorAcervo);
  assert.equal(r.status, 403);
  assert.equal((await post({ cliente_id: CLIENTE, texto: 'oi' }, TOKENS.conectorAcervo)).status, 403);
  assert.equal(envios.length, 0);
});

test('localizar por processo com pontuação: casa pelos 20 dígitos e devolve WhatsApp só mascarado', async () => {
  const { status, corpo } = await get('/api/comunicacao/localizar?processo=0809017-10.2024.8.15.2001', TOKENS.conector);
  assert.equal(status, 200);
  assert.equal(corpo.processos[0].cliente_id, CLIENTE);
  assert.equal(corpo.processos[0].whatsapp_cadastro, '+55 83 9****-1234');
  assert.ok(!JSON.stringify(corpo).includes('99999'), 'número inteiro nunca sai');
  assert.equal(corpo.processos[0].contatos_digisac, undefined, 'com número no AM não consulta o Digisac');
  assert.match(consultas[0].sql, /visibilidade = 'normal'/, 'Master comum não vê processo restrito');
  assert.equal(auditoria[0].acao, 'localizar_cliente_comunicacao');
  assert.equal(auditoria[0].valorDepois.via_conector, true);
});

test('localizar: processo fora do AM avisa; número incompleto → 400', async () => {
  const r = await get('/api/comunicacao/localizar?processo=0842112-65.2023.8.15.2001', TOKENS.conector);
  assert.equal(r.status, 200);
  assert.match(r.corpo.aviso, /não cadastrado/);
  assert.equal((await get('/api/comunicacao/localizar?processo=123', TOKENS.conector)).status, 400);
  assert.equal((await get('/api/comunicacao/localizar', TOKENS.conector)).status, 400);
});

test('localizar por nome: cliente sem WhatsApp no AM traz os candidatos do Digisac', async () => {
  const { corpo } = await get(`/api/comunicacao/localizar?nome=${encodeURIComponent('Severina Luiz')}`, TOKENS.master);
  assert.equal(corpo.clientes[0].cliente_id, SEM_ZAP);
  assert.equal(corpo.clientes[0].whatsapp_cadastro, null);
  assert.equal(corpo.clientes[0].contatos_digisac[0].contato_id, CONTATO);
});

test('enviar: usa o WhatsApp do cadastro e audita sem guardar o texto', async () => {
  const texto = 'Olá, senhora Joseane. Valor R$ 750,00.';
  const { status, corpo } = await post({ cliente_id: CLIENTE, processo_id: PROCESSO, texto });
  assert.equal(status, 200);
  assert.equal(corpo.status, 'enviado');
  assert.equal(envios[0].numero, '(83) 99999-1234');
  assert.equal(envios[0].contatoId, null);
  assert.equal(envios[0].texto, texto);
  const a = auditoria[0];
  assert.equal(a.acao, ACAO_ENVIO);
  assert.equal(a.entidadeId, CLIENTE);
  assert.equal(a.valorDepois.status, 'enviado');
  assert.equal(a.valorDepois.caracteres, texto.length);
  assert.ok(!JSON.stringify(a).includes('Joseane'), 'texto não vai para a auditoria');
});

test('enviar: cliente sem WhatsApp exige contato do Digisac; com ele, envia pelo contato e o vincula ao cliente', async () => {
  const sem = await post({ cliente_id: SEM_ZAP, texto: 'oi' });
  assert.equal(sem.status, 422);
  assert.equal(envios.length, 0);
  const com = await post({ cliente_id: SEM_ZAP, contato_digisac_id: CONTATO, texto: 'oi' });
  assert.equal(com.status, 200);
  assert.deepEqual([envios[0].numero, envios[0].contatoId], [null, CONTATO]);
  assert.deepEqual(execucoes, [[CONTATO, SEM_ZAP]]);
  assert.equal(com.corpo.contato_digisac_vinculado, CONTATO);
  assert.equal(auditoria[0].valorDepois.contato_vinculado_ao_cliente, true);
});

test('enviar: envio que não saiu não vincula o contato', async () => {
  respostaEnvio = { ok: false, messageId: null, erro: 'HTTP 400', antesEnvio: true, destino: 'x' };
  const r = await post({ cliente_id: SEM_ZAP, contato_digisac_id: CONTATO, texto: 'oi' });
  assert.equal(r.status, 502);
  assert.equal(execucoes.length, 0);
});

test('enviar: cliente já vinculado usa o contato do cadastro e recusa outro contato', async () => {
  const r = await post({ cliente_id: VINCULADO, texto: 'oi' });
  assert.equal(r.status, 200);
  assert.equal(envios[0].contatoId, CONTATO);
  assert.equal(execucoes.length, 0, 'vínculo existente não é regravado');
  assert.equal(r.corpo.contato_digisac_vinculado, CONTATO);
  const outro = await post({ cliente_id: VINCULADO, contato_digisac_id: OUTRO_CONTATO, texto: 'oi' });
  assert.equal(outro.status, 422);
  assert.equal(envios.length, 1);
});

test('localizar: cliente já vinculado mostra o contato e não busca por nome no Digisac', async () => {
  const { corpo } = await get(`/api/comunicacao/localizar?nome=${encodeURIComponent('Maria Gicele')}`, TOKENS.conector);
  assert.equal(corpo.clientes[0].contato_digisac_vinculado, CONTATO);
  assert.equal(corpo.clientes[0].contatos_digisac, undefined);
});

test('enviar: mesma mensagem nas últimas 24h → 409, salvo reenviar:true', async () => {
  envioRecente = true;
  assert.equal((await post({ cliente_id: CLIENTE, texto: 'oi' })).status, 409);
  assert.equal(envios.length, 0);
  assert.equal((await post({ cliente_id: CLIENTE, texto: 'oi', reenviar: true })).status, 200);
});

test('enviar: validações e processo restrito/de outro cliente', async () => {
  assert.equal((await post({ cliente_id: CLIENTE, texto: '   ' })).status, 400);
  assert.equal((await post({ texto: 'oi' })).status, 400);
  assert.equal((await post({ cliente_id: 'abc', texto: 'oi' })).status, 400);
  assert.equal((await post({ cliente_id: CLIENTE, texto: 'x'.repeat(4001) })).status, 400);
  processoVisibilidade = 'restrito';
  assert.equal((await post({ cliente_id: CLIENTE, processo_id: PROCESSO, texto: 'oi' })).status, 404);
  processoVisibilidade = 'normal';
  assert.equal((await post({ cliente_id: SEM_ZAP, contato_digisac_id: CONTATO, processo_id: PROCESSO, texto: 'oi' })).status, 422);
  assert.equal(envios.length, 0);
});

test('enviar: resultado incerto → 504 e não convida a tentar de novo', async () => {
  respostaEnvio = { ok: false, messageId: null, erro: 'timeout', antesEnvio: false, destino: 'x' };
  const { status, corpo } = await post({ cliente_id: CLIENTE, texto: 'oi' });
  assert.equal(status, 504);
  assert.equal(corpo.status, 'incerto');
  assert.equal(corpo.pode_tentar_de_novo, false);
  assert.equal(auditoria[0].valorDepois.status, 'incerto');
});

// ── Serviço do Digisac (API simulada) ──

test('buscarContatosPorNome: confere todas as palavras e mascara o número', async () => {
  process.env.DIGISAC_SERVICE_ID = 'svc-1';
  const pedidos = [];
  const api = {
    async get(caminho, { params }) {
      pedidos.push({ caminho, params });
      return { data: { data: [
        { id: CONTATO, name: 'Severina Luiz', internalName: 'SEVERINA DO RAMO DAMASCENA LUIZ', data: { number: '5583988887777' } },
        { id: 'outro', name: 'Severina Souza', data: { number: '5583911112222' } },
      ] } };
    },
  };
  const r = await buscarContatosPorNome('Severina do Ramo Damascena Luiz', { api });
  assert.equal(pedidos[0].params['where[name][$iLike]'], '%severina%luiz%');
  assert.equal(pedidos[1].params['where[internalName][$iLike]'], '%severina%luiz%');
  assert.deepEqual(r.map(c => c.contato_id), [CONTATO]);
  assert.equal(r[0].numero_mascarado, '+55 83 9****-7777');
});

test('enviarMensagemCliente: por número leva serviceId+number; por contato leva contactId; nunca dontOpenTicket', async () => {
  process.env.DIGISAC_SERVICE_ID = 'svc-1';
  const corpos = [];
  const registros = [];
  const api = { async post(_c, corpo) { corpos.push(corpo); return { data: { id: 'm-9' } }; } };
  const registrar = async r => { registros.push(r); };
  const a = await enviarMensagemCliente({ numero: '83 99999-1234', texto: 'oi' }, { api, registrar });
  assert.equal(a.ok, true);
  assert.deepEqual(corpos[0], { type: 'text', text: 'oi', origin: 'bot', serviceId: 'svc-1', number: '5583999991234' });
  const b = await enviarMensagemCliente({ contatoId: CONTATO, texto: 'oi' }, { api, registrar });
  assert.equal(b.ok, true);
  assert.equal(corpos[1].contactId, CONTATO);
  assert.equal(corpos[1].dontOpenTicket, undefined);
  assert.equal(registros[0].tipo, 'mensagem_cliente');
  assert.ok(!JSON.stringify(registros).includes('oi'), 'registro não guarda texto');
  const c = await enviarMensagemCliente({ texto: 'oi' }, { api, registrar });
  assert.equal(c.ok, false);
  assert.equal(corpos.length, 2);
});
