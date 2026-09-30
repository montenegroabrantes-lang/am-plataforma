// S-13 — toda escrita do proxy de Estimativas que terminar com sucesso vira uma linha de auditoria com
// o autor; leitura, recusa e erro não; e nada do que o lead digitou nem o texto de mensagem vai para o log.
// A Camila é um servidor local de mentira (127.0.0.1); o banco é uma dublê que só recolhe os INSERTs.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import 'express-async-errors'; // igual ao index.js: erro de rota async vai para o tratador global (senão a requisição pendura)

// Banco: dublê sem dados (nenhum onboarding existe); nada aqui alcança o banco real.
const { db } = await import('../db/index.js');
db.query = async () => [];
db.queryOne = async () => null;
let auditoria = [];
db.execute = async (sql, params) => {
  if (/INSERT INTO logs_auditoria/.test(sql)) auditoria.push({ usuarioId: params[0], acao: params[1], entidade: params[2], entidadeId: params[3], antes: params[4] && JSON.parse(params[4]), depois: params[5] && JSON.parse(params[5]), ip: params[6] });
  return { rowCount: 1 };
};

const { estimativasRouter } = await import('./estimativas.js');
const { auditarEscritasProxy } = await import('../middleware/auditoriaEscrita.js');
const { tratadorGlobalDeErros } = await import('../middleware/erros.js');

const MASTER = { id: '11111111-1111-4111-8111-111111111111', perfil: 'master', nome: 'Operador Teste' };
const JUNIOR = { id: '22222222-2222-4222-8222-222222222222', perfil: 'junior', nome: 'Estagiário Teste' };
const CONTACT_ID = '89e1802c-0000-4000-8000-000000000123';

let camilaFalsa, servidorApp, portaApp, usuario, respostaCamila;

before(async () => {
  camilaFalsa = http.createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (respostaCamila) { res.statusCode = respostaCamila.status; return res.end(JSON.stringify(respostaCamila.corpo)); }
      if (req.method === 'GET' && req.url.startsWith('/api/estimativas/')) return res.end(JSON.stringify({ ok: true, estimativa: { id: '7', valor_sugerido: '12403.00' } }));
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise(r => camilaFalsa.listen(0, '127.0.0.1', r));
  process.env.CAMILA_API_URL = `http://127.0.0.1:${camilaFalsa.address().port}`;
  process.env.CAMILA_API_KEY = 'chave-de-teste';

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = usuario; req._ip = '203.0.113.9'; next(); });
  app.use('/api/estimativas', estimativasRouter);
  // rota que a tabela de auditoria não conhece (prova da ação genérica) — num router à parte
  const extra = express.Router();
  extra.use(auditarEscritasProxy({}));
  extra.post('/novidade/:id', (req, res) => res.json({ ok: true }));
  app.use('/api/extra', extra);
  app.use(tratadorGlobalDeErros);
  servidorApp = http.createServer(app);
  await new Promise(r => servidorApp.listen(0, '127.0.0.1', r));
  portaApp = servidorApp.address().port;
});

after(async () => {
  await new Promise(r => servidorApp.close(r));
  await new Promise(r => camilaFalsa.close(r));
});

beforeEach(() => { auditoria = []; usuario = MASTER; respostaCamila = null; });

const chamar = async (metodo, caminho, corpo, prefixo = '/api/estimativas') => {
  const r = await fetch(`http://127.0.0.1:${portaApp}${prefixo}${caminho}`, {
    method: metodo, headers: { 'content-type': 'application/json' }, ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
  });
  return { status: r.status, corpo: await r.json().catch(() => null) };
};
// A gravação acontece quando a resposta termina; espera o INSERT da dublê chegar.
const esperar = async (n = 1) => {
  for (let i = 0; i < 100 && auditoria.length < n; i++) await new Promise(r => setTimeout(r, 5));
  await new Promise(r => setTimeout(r, 15)); // dá tempo a uma gravação indevida aparecer
};

test('aprovar estimativa: grava quem aprovou e o valor; id que não é UUID vai para entidade_ref', async () => {
  const r = await chamar('POST', '/7/aprovar', {
    valor: '12.000,00',
    vinculos: [{ cargo: 'Professor', orgao: 'Prefeitura Fictícia', mesesInicio: '01/2021', mesesFim: '' }],
    conduzir_ate: 'documentos',
  });
  assert.equal(r.status, 200);
  await esperar();
  assert.equal(auditoria.length, 1);
  const [linha] = auditoria;
  assert.equal(linha.usuarioId, MASTER.id);
  assert.equal(linha.acao, 'aprovar_estimativa');
  assert.equal(linha.entidade, 'estimativa');
  assert.equal(linha.entidadeId, null, 'coluna UUID vazia: o id "7" não é UUID');
  assert.equal(linha.depois.entidade_ref, '7');
  assert.equal(linha.depois.valor, '12.000,00');
  assert.equal(linha.depois.n_vinculos, 1);
  assert.equal(linha.depois.http, 200);
  assert.equal(linha.ip, '203.0.113.9');
  // nada do que o lead digitou (cargo, órgão) nem o texto solto do corpo
  const texto = JSON.stringify(linha);
  for (const proibido of ['Professor', 'Prefeitura Fictícia']) assert.equal(texto.includes(proibido), false, proibido);
});

test('mensagem a lead: só o tamanho e o contactId truncado, NUNCA o texto', async () => {
  const mensagem = 'Olá Maria da Silva, o seu valor estimado é R$ 12.000,00. Posso enviar o contrato?';
  const r = await chamar('POST', `/leads/${CONTACT_ID}/mensagem`, { mensagem });
  assert.equal(r.status, 200);
  await esperar();
  const [linha] = auditoria;
  assert.equal(linha.acao, 'enviar_mensagem_lead');
  assert.equal(linha.entidade, 'lead');
  assert.equal(linha.depois.contato, '89e1802c');
  assert.equal(linha.depois.tamanhos.mensagem, mensagem.length);
  const texto = JSON.stringify(linha);
  for (const proibido of ['Maria', '12.000', 'contrato', CONTACT_ID]) assert.equal(texto.includes(proibido), false, `o log não pode conter "${proibido}"`);
});

test('entrega manual: valor entra (é o que o operador decidiu), o texto não', async () => {
  const r = await chamar('POST', `/leads/${CONTACT_ID}/entrega-manual`, { valor: 12000, estimativaId: '7', mensagem: 'texto livre para o lead' });
  assert.equal(r.status, 200);
  await esperar();
  const [linha] = auditoria;
  assert.equal(linha.acao, 'entrega_manual_estimativa');
  assert.equal(linha.depois.valor, 12000);
  assert.equal(linha.depois.estimativaId, '7');
  assert.equal(JSON.stringify(linha).includes('texto livre'), false);
});

test('desfecho de lead, passar ao atendente e recusa entram na trilha', async () => {
  await chamar('POST', `/leads/${CONTACT_ID}/desfecho`, { desfecho: 'perdido', motivo: 'desistiu' });
  await chamar('POST', `/leads/${CONTACT_ID}/passar-atendente`, {});
  await chamar('POST', '/7/recusar', { motivo: 'cliente já é da casa' });
  await esperar(3);
  assert.deepEqual(auditoria.map(a => a.acao).sort(), ['passar_lead_atendente', 'recusar_estimativa', 'registrar_desfecho_lead']);
  const desfecho = auditoria.find(a => a.acao === 'registrar_desfecho_lead');
  assert.equal(desfecho.depois.desfecho, 'perdido');
});

test('rotas do laço do proxy (PATCH pendência, decidir síntese) também são auditadas, com booleanos', async () => {
  await chamar('PATCH', `/pendencias-processuais/${CONTACT_ID}`, { resolvida: true, observacao: 'texto livre' });
  await chamar('POST', '/sinteses-aprendizado/abc123/decidir', { decisao: 'aprovar' });
  await esperar(2);
  const pendencia = auditoria.find(a => a.acao === 'atualizar_pendencia_processual');
  assert.equal(pendencia.depois.resolvida, true);
  assert.equal(pendencia.depois.contato, '89e1802c');
  assert.equal(JSON.stringify(pendencia).includes('texto livre'), false);
  const sintese = auditoria.find(a => a.acao === 'decidir_sintese_aprendizado');
  assert.equal(sintese.depois.decisao, 'aprovar');
  assert.equal(sintese.depois.entidade_ref, 'abc123');
});

test('leitura (GET) nunca grava auditoria', async () => {
  await chamar('GET', '/7');
  await chamar('GET', '/');
  await esperar(0);
  assert.equal(auditoria.length, 0);
});

test('escrita recusada não grava: júnior (403), validação (400) e falha da Camila (500)', async () => {
  usuario = JUNIOR;
  assert.equal((await chamar('POST', '/7/aprovar', { valor: '12.000,00' })).status, 403);
  usuario = MASTER;
  assert.equal((await chamar('POST', '/7/aprovar', { valor: '12.000,00', vinculos: [{ mesesInicio: 'janeiro/2021' }] })).status, 400);
  respostaCamila = { status: 500, corpo: { ok: false } };
  assert.equal((await chamar('POST', `/leads/${CONTACT_ID}/reabordar`, {})).status, 500);
  await esperar(0);
  assert.equal(auditoria.length, 0, 'só ação concluída com sucesso vira registro');
});

test('rota nova que a tabela não conhece cai na ação genérica camila_<método>', async () => {
  const r = await chamar('POST', '/novidade/9', { x: 1 }, '/api/extra');
  assert.equal(r.status, 200);
  await esperar();
  const [linha] = auditoria;
  assert.equal(linha.acao, 'camila_post');
  assert.equal(linha.depois.rota, '/novidade/:id');
  assert.equal(linha.depois.entidade_ref, '9');
});

test('falha ao gravar o log não muda a resposta da rota', async () => {
  const original = db.execute;
  db.execute = async () => { throw new Error('banco fora do ar'); };
  const consoleErro = console.error; console.error = () => {};
  try {
    const r = await chamar('POST', `/leads/${CONTACT_ID}/passar-atendente`, {});
    assert.equal(r.status, 200);
    await new Promise(r2 => setTimeout(r2, 30));
  } finally { db.execute = original; console.error = consoleErro; }
});
