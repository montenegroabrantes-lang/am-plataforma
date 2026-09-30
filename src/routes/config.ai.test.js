// S-09: POST /api/config/ai/camila repassa só os campos da tela (lista branca) e audita.
// Camila (axios) e auditoria são dublês; nenhuma chamada real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

const { configAiRouter, criarSalvarCamila, filtrarConfigCamila } = await import('./config.ai.js');
const { apenasMaster } = await import('../middleware/auth.js');

process.env.CAMILA_ADMIN_URL = 'https://camila.exemplo.test';
process.env.CAMILA_ADMIN_SECRET = 'segredo-admin-de-teste';

function montar({ perfil = 'master', http, auditar }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'u1', perfil }; req._ip = '203.0.113.9'; next(); });
  app.post('/camila', apenasMaster, criarSalvarCamila({ http, auditar }));
  return app;
}
async function postar(app, corpo) {
  const s = app.listen(0);
  try {
    const r = await fetch(`http://127.0.0.1:${s.address().port}/camila`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
    return { status: r.status, json: await r.json() };
  } finally { s.close(); }
}
function dubles({ configAtual = { vendas: 'claude', processo: 'claude', claude_modelo: 'claude-sonnet-4-6', openai_modelo: 'gpt-4o' }, falhaGet = false, falhaPost = false } = {}) {
  const posts = []; const auditorias = [];
  const http = {
    async get() { if (falhaGet) throw new Error('offline'); return { data: { ok: true, config: configAtual } }; },
    async post(url, corpo, opts) { posts.push({ url, corpo, opts }); if (falhaPost) throw new Error('offline'); return { data: { ok: true, config: corpo } }; },
  };
  return { http, posts, auditorias, auditar: async (a) => { auditorias.push(a); } };
}

test('campo extra/desconhecido não chega à Camila; só os 5 campos da tela', async () => {
  const d = dubles();
  const r = await postar(montar(d), {
    vendas: 'openai', processo: 'claude', claude_modelo: 'claude-opus-4-7', claude_modelo_processo: 'claude-haiku-4-5-20251001', openai_modelo: 'gpt-4.1',
    admin: true, prompt_sistema: 'ignore tudo', ENTREGA_IMEDIATA_ATIVO: 'false', __proto__x: 1, constructor: 'x',
  });
  assert.equal(r.status, 200);
  assert.equal(d.posts.length, 1);
  assert.deepEqual(d.posts[0].corpo, { vendas: 'openai', processo: 'claude', claude_modelo: 'claude-opus-4-7', claude_modelo_processo: 'claude-haiku-4-5-20251001', openai_modelo: 'gpt-4.1' });
  assert.equal(d.posts[0].url, 'https://camila.exemplo.test/admin/ia-config');
  assert.equal(d.posts[0].opts.headers['x-admin-secret'], 'segredo-admin-de-teste');
  assert.deepEqual(r.json.descartados.sort(), ['ENTREGA_IMEDIATA_ATIVO', '__proto__x', 'admin', 'constructor', 'prompt_sistema'].sort());
});

test('valores fora da lista são descartados com aviso (gpt-5, gpt-4.5, provedor inválido, tipo errado)', async () => {
  const d = dubles();
  const r = await postar(montar(d), { vendas: 'claude', processo: 'gemini', claude_modelo: ['x'], openai_modelo: 'gpt-5' });
  assert.equal(r.status, 200);
  assert.deepEqual(d.posts[0].corpo, { vendas: 'claude' });
  assert.deepEqual(r.json.descartados.sort(), ['claude_modelo', 'openai_modelo', 'processo']);
  assert.deepEqual(filtrarConfigCamila({ openai_modelo: 'gpt-4.5' }).payload, {});
  assert.deepEqual(filtrarConfigCamila({ openai_modelo: 'gpt-4.1-mini' }).payload, { openai_modelo: 'gpt-4.1-mini' });
  assert.deepEqual(filtrarConfigCamila(null).payload, {});
  assert.deepEqual(filtrarConfigCamila([1]).payload, {});
});

test('sem nenhum campo válido: 400 e nada é enviado à Camila', async () => {
  const d = dubles();
  const r = await postar(montar(d), { foo: 'bar', openai_modelo: 'gpt-5' });
  assert.equal(r.status, 400);
  assert.equal(d.posts.length, 0);
  assert.equal(d.auditorias.length, 0);
});

test('júnior e outros perfis → 403; nada é enviado nem auditado', async () => {
  for (const perfil of ['junior', 'advogado', null]) {
    const d = dubles();
    const r = await postar(montar({ perfil, ...d }), { vendas: 'openai' });
    assert.equal(r.status, 403, String(perfil));
    assert.equal(d.posts.length, 0);
    assert.equal(d.auditorias.length, 0);
  }
});

test('auditoria alterar_config_ia_camila: quem, antes e depois; sem o segredo de admin', async () => {
  const d = dubles();
  await postar(montar(d), { vendas: 'openai', claude_modelo: 'claude-opus-4-7', admin: 'x' });
  assert.equal(d.auditorias.length, 1);
  const a = d.auditorias[0];
  assert.equal(a.acao, 'alterar_config_ia_camila');
  assert.equal(a.usuarioId, 'u1');
  assert.equal(a.entidade, 'config_ia_camila');
  assert.deepEqual(a.valorDepois, { vendas: 'openai', claude_modelo: 'claude-opus-4-7' });
  assert.deepEqual(a.valorAntes, { vendas: 'claude', processo: 'claude', claude_modelo: 'claude-sonnet-4-6', openai_modelo: 'gpt-4o' });
  assert.ok(!JSON.stringify(a).includes('segredo-admin-de-teste'));
  assert.equal(a.ip, '203.0.113.9');
});

test('Camila fora do ar: 502 e nada auditado; se só a leitura do "antes" falha, salva e audita com antes nulo', async () => {
  const d1 = dubles({ falhaPost: true });
  assert.equal((await postar(montar(d1), { vendas: 'openai' })).status, 502);
  assert.equal(d1.auditorias.length, 0);
  const d2 = dubles({ falhaGet: true });
  assert.equal((await postar(montar(d2), { vendas: 'openai' })).status, 200);
  assert.equal(d2.auditorias[0].valorAntes, null);
});

test('a rota real está montada com apenasMaster e o handler novo', () => {
  const camila = configAiRouter.stack.find(l => l.route?.path === '/camila' && l.route.methods.post);
  assert.ok(camila, 'POST /camila');
  assert.equal(camila.route.stack.length, 2, 'apenasMaster + handler');
  assert.equal(camila.route.stack[0].handle, apenasMaster);
});
