// JN-01 e JN-02 nas rotas do proxy de Estimativas. A Camila é um servidor local de mentira
// (127.0.0.1, porta sorteada) que só registra o que recebeu; não há banco nem rede externa.
// Os caminhos que gravariam onboarding (fechamento com valor aceito) dependem do banco e não
// são exercitados aqui: só a recusa, que acontece antes de qualquer gravação.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { estimativasRouter } from './estimativas.js';

let camilaFalsa, portaCamila, servidorApp, portaApp;
let recebidas = [];
let detalhe = { estimativa: { id: '7', valor_sugerido: '12403.00', valor_aprovado: null } };

before(async () => {
  camilaFalsa = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', c => { corpo += c; });
    req.on('end', () => {
      recebidas.push({ metodo: req.method, url: req.url, corpo: corpo ? JSON.parse(corpo) : null });
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET' && req.url.startsWith('/api/estimativas/')) {
        if (detalhe === null) { res.statusCode = 500; return res.end('{"ok":false}'); }
        return res.end(JSON.stringify({ ok: true, ...detalhe }));
      }
      res.end(JSON.stringify({ ok: true, entregar_em: 'agora' }));
    });
  });
  await new Promise(r => camilaFalsa.listen(0, '127.0.0.1', r));
  portaCamila = camilaFalsa.address().port;
  process.env.CAMILA_API_URL = `http://127.0.0.1:${portaCamila}`;
  process.env.CAMILA_API_KEY = 'chave-de-teste';

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { id: 'u-teste', perfil: 'master', nome: 'Operador Teste' }; req._ip = '127.0.0.1'; next(); });
  app.use('/api/estimativas', estimativasRouter);
  servidorApp = http.createServer(app);
  await new Promise(r => servidorApp.listen(0, '127.0.0.1', r));
  portaApp = servidorApp.address().port;
});

after(async () => {
  await new Promise(r => servidorApp.close(r));
  await new Promise(r => camilaFalsa.close(r));
});

beforeEach(() => {
  recebidas = [];
  detalhe = { estimativa: { id: '7', valor_sugerido: '12403.00', valor_aprovado: null } };
});

async function postar(caminho, corpo) {
  const r = await fetch(`http://127.0.0.1:${portaApp}/api/estimativas${caminho}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo),
  });
  return { status: r.status, corpo: await r.json() };
}
const postsParaCamila = () => recebidas.filter(r => r.metodo === 'POST');

// ── JN-01: aprovação completa o período do vínculo ───────────────────────────

test('aprovar completa mesesFim e numMeses antes de repassar à Camila', async () => {
  const r = await postar('/7/aprovar', {
    valor: '12.000,00',
    vinculos: [{ cargo: 'Professor', orgao: 'Prefeitura', mesesInicio: '01/2021', mesesFim: '', valorEstimado: '12.000,00' }],
    conduzir_ate: 'documentos',
  });
  assert.equal(r.status, 200);
  const [post] = postsParaCamila();
  assert.equal(post.url, '/api/estimativas/7/aprovar');
  const v = post.corpo.vinculos[0];
  assert.match(v.mesesFim, /^(0[1-9]|1[0-2])\/20\d{2}$/);
  assert.equal(v.numMeses, 60); // 01/2021 até hoje passa de 60 meses
  assert.equal(post.corpo.valor, '12.000,00');
  assert.equal(post.corpo.aprovado_por, 'Operador Teste');
  assert.equal('valor_fora_da_faixa_ciente' in post.corpo, false);
});

test('aprovar barra período fora de MM/AAAA com 400 e não chama a Camila', async () => {
  const r = await postar('/7/aprovar', {
    valor: '12.000,00', vinculos: [{ mesesInicio: 'janeiro/2021', mesesFim: '' }],
  });
  assert.equal(r.status, 400);
  assert.match(r.corpo.erro, /início do período.*MM\/AAAA/);
  assert.equal(recebidas.length, 0);
});

test('aprovar sem vínculos segue como antes (só o valor)', async () => {
  const r = await postar('/7/aprovar', { valor: 12000, vinculos: [] });
  assert.equal(r.status, 200);
  assert.deepEqual(postsParaCamila()[0].corpo.vinculos, []);
});

// ── JN-02: trava de faixa na aprovação ───────────────────────────────────────

test('aprovar com erro de vírgula (100× a sugestão) responde 409 e não aprova', async () => {
  const r = await postar('/7/aprovar', { valor: '1.240.335,00', vinculos: [] });
  assert.equal(r.status, 409);
  assert.equal(r.corpo.motivo, 'valor_fora_da_faixa');
  assert.equal(r.corpo.referencia, 12403);
  assert.equal(r.corpo.valor, 1240335);
  assert.equal(postsParaCamila().length, 0);
});

test('aprovar valor de R$ 12,32 contra sugestão de R$ 12.403 responde 409', async () => {
  const r = await postar('/7/aprovar', { valor: '12.32', vinculos: [] });
  assert.equal(r.status, 409);
  assert.equal(r.corpo.razao, 'abaixo_da_faixa');
  assert.equal(postsParaCamila().length, 0);
});

test('aprovar fora da faixa com confirmação do operador repassa e não leva o campo à Camila', async () => {
  const r = await postar('/7/aprovar', { valor: '1.240.335,00', vinculos: [], valor_fora_da_faixa_ciente: true });
  assert.equal(r.status, 200);
  const [post] = postsParaCamila();
  assert.equal(post.corpo.valor, '1.240.335,00');
  assert.equal('valor_fora_da_faixa_ciente' in post.corpo, false);
});

test('só valor_fora_da_faixa_ciente === true confirma ("true" em texto e 1 não valem)', async () => {
  for (const ciente of ['true', 1, 'sim']) {
    const r = await postar('/7/aprovar', { valor: '1.240.335,00', vinculos: [], valor_fora_da_faixa_ciente: ciente });
    assert.equal(r.status, 409, `ciente=${JSON.stringify(ciente)}`);
  }
  assert.equal(postsParaCamila().length, 0);
});

test('aprovar dentro da faixa não pede confirmação', async () => {
  const r = await postar('/7/aprovar', { valor: '32.000,00', vinculos: [] }); // 2,6× a sugestão
  assert.equal(r.status, 200);
  assert.equal(postsParaCamila().length, 1);
});

test('sem sugestão, a referência é a soma do valor dos vínculos', async () => {
  detalhe = { estimativa: { id: '7', valor_sugerido: null, valor_aprovado: null } };
  const vinculos = [{ mesesInicio: '01/2025', mesesFim: '06/2025', valorEstimado: '8.000,00' }];
  const fora = await postar('/7/aprovar', { valor: '800.000,00', vinculos });
  assert.equal(fora.status, 409);
  assert.equal(fora.corpo.referencia, 8000);
  const dentro = await postar('/7/aprovar', { valor: '9.000,00', vinculos });
  assert.equal(dentro.status, 200);
});

test('sem nenhuma referência vale só o teto de R$ 100 mil', async () => {
  detalhe = { estimativa: { id: '7', valor_sugerido: null } };
  assert.equal((await postar('/7/aprovar', { valor: '12,32', vinculos: [] })).status, 200);
  const acima = await postar('/7/aprovar', { valor: '100.000,01', vinculos: [] });
  assert.equal(acima.status, 409);
  assert.equal(acima.corpo.razao, 'acima_do_teto');
});

test('se a Camila não devolve o detalhe, o teto continua valendo', async () => {
  detalhe = null;
  const acima = await postar('/7/aprovar', { valor: '1.240.335,00', vinculos: [] });
  assert.equal(acima.status, 409);
  assert.equal(acima.corpo.razao, 'acima_do_teto');
});

// ── JN-02: entrega manual ────────────────────────────────────────────────────

test('entrega manual: valor 100× a estimativa responde 409 e nada é enviado', async () => {
  const r = await postar('/leads/89e1802c/entrega-manual', { estimativaId: '7', valor: 1240335, texto: 'Olá' });
  assert.equal(r.status, 409);
  assert.equal(r.corpo.motivo, 'valor_fora_da_faixa');
  assert.equal(postsParaCamila().length, 0);
});

test('entrega manual: valor dentro da faixa segue; fora da faixa segue com confirmação', async () => {
  const dentro = await postar('/leads/89e1802c/entrega-manual', { estimativaId: '7', valor: 12403, texto: 'Olá' });
  assert.equal(dentro.status, 200);
  const confirmada = await postar('/leads/89e1802c/entrega-manual', {
    estimativaId: '7', valor: 1240335, texto: 'Olá', valor_fora_da_faixa_ciente: true,
  });
  assert.equal(confirmada.status, 200);
  const posts = postsParaCamila();
  assert.equal(posts.length, 2);
  assert.equal(posts[1].corpo.valor, 1240335);
  assert.equal(posts[1].corpo.registradoPor, 'Operador Teste');
  assert.equal('valor_fora_da_faixa_ciente' in posts[1].corpo, false);
});

test('entrega manual usa a sugestão como régua mesmo se a estimativa já foi aprovada com valor errado', async () => {
  // Aprovada por engano a 100× a sugestão (caso real): reenviar o mesmo valor não pode passar.
  detalhe = { estimativa: { id: '7', valor_sugerido: '12403.00', valor_aprovado: '1240335.00' } };
  const r = await postar('/leads/89e1802c/entrega-manual', { estimativaId: '7', valor: 1240335, texto: 'Olá' });
  assert.equal(r.status, 409);
  assert.equal(r.corpo.referencia, 12403);
  assert.equal(postsParaCamila().length, 0);
});

test('entrega manual sem sugestão (candidato não confiável) usa o valor já apresentado', async () => {
  detalhe = { estimativa: { id: '7', valor_sugerido: null, valor_aprovado: '30000.00' } };
  assert.equal((await postar('/leads/89e1802c/entrega-manual', { estimativaId: '7', valor: 100000, texto: 'Olá' })).status, 200);
  assert.equal((await postar('/leads/89e1802c/entrega-manual', { estimativaId: '7', valor: 5000, texto: 'Olá' })).status, 409);
});

// ── JN-02: fechamento (valor_fechado) ────────────────────────────────────────

test('fechamento acima de R$ 100 mil responde 409 antes de gravar qualquer onboarding', async () => {
  const r = await postar('/leads/89e1802c/desfecho', {
    desfecho: 'fechado', valorFechado: 856598, onboarding: { estimativa_id: null },
  });
  assert.equal(r.status, 409);
  assert.equal(r.corpo.razao, 'acima_do_teto');
  assert.equal(recebidas.length, 0);
});

test('fechamento fora da faixa da estimativa responde 409 antes de gravar', async () => {
  const r = await postar('/leads/89e1802c/desfecho', {
    desfecho: 'fechado', valorFechado: 9.57, onboarding: { estimativa_id: '7' },
  });
  assert.equal(r.status, 409);
  assert.equal(r.corpo.razao, 'abaixo_da_faixa');
  assert.equal(r.corpo.referencia, 12403);
  assert.equal(postsParaCamila().length, 0);
});

test('fechamento sem estimativa usa o valor do lead informado pelo formulário como referência', async () => {
  const r = await postar('/leads/89e1802c/desfecho', {
    desfecho: 'fechado', valorFechado: 9.57, onboarding: { valor_referencia: 9565 },
  });
  assert.equal(r.status, 409);
  assert.equal(r.corpo.referencia, 9565);
});

test('cadastro manual (sem lead) acima de R$ 100 mil responde 409', async () => {
  const r = await postar('/onboarding-manual', { onboarding: {}, valorFechado: 250000 });
  assert.equal(r.status, 409);
  assert.equal(r.corpo.motivo, 'valor_fora_da_faixa');
});
