// Limite de senhas erradas do login do AM por e-mail + IP (S-02), como o index.js o monta.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

const { limiteLoginPorEmail } = await import('./limiteLogin.js');
const { criarTentativasLogin } = await import('../utils/tentativasLogin.js');

const SENHA_CERTA = 'certa';
const servidores = [];
after(() => servidores.forEach(s => s.close()));

function subir(opcoes = {}) {
  const tentativas = opcoes.tentativas ?? criarTentativasLogin();
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api/auth/login', limiteLoginPorEmail({ tentativas, ...opcoes }));
  let chamadas = 0;
  app.post('/api/auth/login', (req, res) => {
    chamadas += 1;
    if (!req.body?.email || !req.body?.senha) return res.status(400).json({ ok: false, erro: 'Email e senha obrigatórios.' });
    if (req.body.senha === 'provisoria') return res.status(200).json({ ok: false, primeiro_acesso: true });
    if (req.body.senha !== SENHA_CERTA) return res.status(401).json({ ok: false, erro: 'Credenciais inválidas.' });
    res.json({ ok: true });
  });
  app.get('/api/auth/login', (_req, res) => res.json({ ok: true, metodo: 'GET' }));
  const s = app.listen(0);
  servidores.push(s);
  return { base: `http://127.0.0.1:${s.address().port}`, tentativas, chamadas: () => chamadas };
}
const login = (s, corpo, ip = '203.0.113.1') => fetch(`${s.base}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: JSON.stringify(corpo),
});

test('10 senhas erradas do mesmo e-mail e IP passam (401); a 11ª → 429 sem chegar à rota, mesmo com a senha certa', async () => {
  const s = subir();
  for (let i = 0; i < 10; i++) assert.equal((await login(s, { email: 'a@x.com', senha: 'errada' })).status, 401);
  assert.equal(s.chamadas(), 10);
  const r = await login(s, { email: 'a@x.com', senha: SENHA_CERTA });
  assert.equal(r.status, 429);
  assert.deepEqual(await r.json(), { ok: false, erro: 'Muitas tentativas. Aguarde 15 minutos.' });
  assert.ok(Number(r.headers.get('retry-after')) > 0);
  assert.equal(s.chamadas(), 10, 'a rota nem foi chamada');
});

test('e-mail com outra grafia (maiúsculas, espaços) conta no mesmo contador', async () => {
  const s = subir();
  for (let i = 0; i < 10; i++) await login(s, { email: i % 2 ? ' A@X.com ' : 'a@x.COM', senha: 'errada' });
  assert.equal((await login(s, { email: 'a@x.com', senha: SENHA_CERTA })).status, 429);
});

test('quem erra de fora não tranca quem está no escritório: outro IP e outro e-mail seguem livres', async () => {
  const s = subir();
  for (let i = 0; i < 10; i++) await login(s, { email: 'master@x.com', senha: 'errada' }, `198.51.100.${i + 1}`);
  for (let i = 0; i < 10; i++) await login(s, { email: 'master@x.com', senha: 'errada' }, '198.51.100.99');
  assert.equal((await login(s, { email: 'master@x.com', senha: 'errada' }, '198.51.100.99')).status, 429, 'o IP que errou 10 vezes espera');
  assert.equal((await login(s, { email: 'master@x.com', senha: SENHA_CERTA }, '203.0.113.7')).status, 200, 'o escritório entra');
  assert.equal((await login(s, { email: 'outro@x.com', senha: SENHA_CERTA }, '198.51.100.99')).status, 200, 'outro e-mail no IP que errou');
});

test('só 401 conta: login certo, primeiro acesso (200) e corpo incompleto (400) não consomem o limite', async () => {
  const s = subir();
  for (let i = 0; i < 9; i++) await login(s, { email: 'a@x.com', senha: 'errada' });
  for (let i = 0; i < 30; i++) assert.equal((await login(s, { email: 'a@x.com', senha: SENHA_CERTA })).status, 200);
  for (let i = 0; i < 30; i++) assert.equal((await login(s, { email: 'a@x.com', senha: 'provisoria' })).status, 200);
  for (let i = 0; i < 30; i++) assert.equal((await login(s, { email: 'a@x.com' })).status, 400);
  assert.equal((await login(s, { email: 'a@x.com', senha: 'errada' })).status, 401, 'a 10ª falha ainda passa');
  assert.equal((await login(s, { email: 'a@x.com', senha: 'errada' })).status, 429);
});

test('rajada em paralelo não escapa do limite', async () => {
  const s = subir();
  const respostas = await Promise.all(Array.from({ length: 40 }, () => login(s, { email: 'a@x.com', senha: 'errada' })));
  const status = respostas.map(r => r.status);
  assert.equal(status.filter(c => c === 401).length, 10);
  assert.equal(status.filter(c => c === 429).length, 30);
});

test('e-mail ausente ou que não é texto não derruba nem conta; GET passa', async () => {
  const s = subir();
  assert.equal((await login(s, { senha: 'x' })).status, 400);
  assert.equal((await login(s, { email: { $ne: '' }, senha: 'x' })).status, 401);
  assert.equal((await login(s, { email: 12345, senha: 'x' })).status, 401);
  assert.equal((await fetch(`${s.base}/api/auth/login`)).status, 200);
});

test('sem limite por IP (LIMITES_POR_IP=desligado): o login nunca é bloqueado, mas as falhas alimentam o teto por e-mail do OAuth', async () => {
  const s = subir({ porIpAtivo: () => false });
  for (let i = 0; i < 55; i++) assert.equal((await login(s, { email: 'a@x.com', senha: 'errada' })).status, 401);
  assert.equal((await login(s, { email: 'a@x.com', senha: SENHA_CERTA })).status, 200, 'login segue livre');
  // o OAuth (com teto) vê as 55 falhas do login
  assert.equal(s.tentativas.iniciar('a@x.com', '203.0.113.9', { comTeto: true, porIp: false }).bloqueio, 'email');
});
