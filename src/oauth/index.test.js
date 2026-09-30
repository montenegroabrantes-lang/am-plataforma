// Servidor OAuth do conector (S-02, S-07, S-19 servidor) e o fluxo inteiro do conector:
// register → GET authorize → POST authorize → token com PKCE → /mcp com Bearer.
// Sem banco real: db.queryOne devolve usuários de mentira e a auditoria é capturada.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';

process.env.JWT_SECRET = 'segredo-de-teste';

const { db } = await import('../db/index.js');
const { criarOauthRouter } = await import('./index.js');
const { lerRedirectsPermitidos } = await import('./redirects.js');
const { CONTA_SERVICO_EMAIL } = await import('./escopos.js');
const { criarTentativasLogin } = await import('../utils/tentativasLogin.js');
const { limiteLoginPorEmail } = await import('../middleware/limiteLogin.js');
const { autenticar } = await import('../middleware/auth.js');
const { mcpRouter } = await import('../mcp/index.js');

// ── banco de mentira ──
const SENHA = 'SenhaBoa-123';
const HASH_RAPIDO = bcrypt.hashSync(SENHA, 4); // custo 4: o teste não espera 250 ms por tentativa
const SEGREDO_2FA = authenticator.generateSecret();
const mestre = (extra = {}) => ({ id: 'u-mestre', nome: 'Master Teste', email: 'master@exemplo.com', perfil: 'master', ativo: true, senha_hash: HASH_RAPIDO, senha_temporaria: false, totp_ativo: false, master_id: null, pode_marcar_restrito: false, ...extra });
const USUARIOS = {
  'master@exemplo.com': mestre(),
  'junior@exemplo.com': mestre({ id: 'u-junior', email: 'junior@exemplo.com', perfil: 'junior' }),
  'provisoria@exemplo.com': mestre({ id: 'u-prov', email: 'provisoria@exemplo.com', senha_temporaria: true }),
  'dois-fatores@exemplo.com': mestre({ id: 'u-2fa', email: 'dois-fatores@exemplo.com', totp_ativo: true, totp_secret: SEGREDO_2FA }),
  [CONTA_SERVICO_EMAIL]: mestre({ id: 'u-servico', nome: 'Integração Claude', email: CONTA_SERVICO_EMAIL, senha_hash: null }),
};
db.queryOne = async (sql, params) => {
  if (!/FROM usuarios WHERE email = \$1 AND ativo = true/.test(sql)) throw new Error(`consulta inesperada: ${sql}`);
  const email = params[0];
  if (/^u\d+@exemplo\.com$/.test(email)) return mestre({ id: `u-${email}`, email }); // usuários "u1@…", "u2@…" para variar o e-mail
  return USUARIOS[email] ?? null;
};
for (const metodo of ['query', 'execute']) db[metodo] = async () => { throw new Error('banco real proibido nos testes'); };

// Conta as chamadas ao bcrypt (para provar que o bloqueio vem ANTES da verificação de senha).
let chamadasBcrypt = 0;
const compararOriginal = bcrypt.compare;
bcrypt.compare = (...args) => { chamadasBcrypt += 1; return compararOriginal.apply(bcrypt, args); };

// ── servidores de teste ──
const servidores = [];
after(() => servidores.forEach(s => s.close()));

async function subir(opcoes = {}, { comLogin = false, globalUrlencoded = false } = {}) {
  const auditoria = [];
  const tentativas = opcoes.tentativas ?? criarTentativasLogin();
  const app = express();
  app.set('trust proxy', 1); // como em produção: o IP do cliente vem do X-Forwarded-For
  app.use(express.json());
  if (globalUrlencoded) app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  if (comLogin) {
    // Rota de login de mentira, com o mesmo middleware de limite que o index.js monta.
    app.use('/api/auth/login', limiteLoginPorEmail({ tentativas, porIpAtivo: opcoes.porIpAtivo }));
    app.post('/api/auth/login', async (req, res) => {
      const u = USUARIOS[String(req.body?.email ?? '').toLowerCase().trim()];
      if (!u || !(await bcrypt.compare(String(req.body?.senha ?? ''), u.senha_hash || ''))) return res.status(401).json({ ok: false, erro: 'Credenciais inválidas.' });
      res.json({ ok: true });
    });
  }
  app.use(criarOauthRouter({ auditar: async (r) => { auditoria.push(r); }, tentativas, ...opcoes }));
  // Recursos protegidos, como no index.js
  app.use('/mcp', mcpRouter);
  // montados por `app.use(prefixo, autenticar, ...)`, como no index.js (o confinamento lê req.baseUrl)
  app.use('/api/usuarios', autenticar, (_req, res) => res.json({ ok: true }));
  app.use('/api/acervo', autenticar, (_req, res) => res.json({ ok: true, teses: [] }));
  const servidor = app.listen(0);
  servidores.push(servidor);
  return { base: `http://127.0.0.1:${servidor.address().port}`, auditoria, tentativas };
}

const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const PKCE = () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
};
const form = (obj) => new URLSearchParams(Object.entries(obj).flatMap(([k, v]) => (Array.isArray(v) ? v.map(x => [k, x]) : [[k, String(v)]])));

async function registrar(s, corpo = { redirect_uris: [CALLBACK], client_name: 'Claude' }, ip = '198.51.100.1') {
  const r = await fetch(`${s.base}/oauth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: JSON.stringify(corpo) });
  return { status: r.status, corpo: await r.json() };
}

async function autorizar(s, cliente, { email = 'master@exemplo.com', senha = SENHA, ip = '203.0.113.10', escopos = ['acervo'], totp, pkce = PKCE(), redirect_uri = CALLBACK, state = 'estado-1' } = {}) {
  const corpo = { client_id: cliente.client_id, redirect_uri, response_type: 'code', code_challenge: pkce.challenge, code_challenge_method: 'S256', state, email, senha, escopos };
  if (totp) corpo.totp = totp;
  const r = await fetch(`${s.base}/oauth/authorize`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': ip }, body: form(corpo) });
  return { status: r.status, headers: r.headers, texto: await r.text(), pkce };
}
const erroDaPagina = (texto) => /<p class="erro">([^<]*)<\/p>/.exec(texto)?.[1] ?? null;

async function novoCliente(s) {
  const { corpo } = await registrar(s);
  return corpo;
}

// ── S-02: limites, registro e mensagem única ──

test('S-02: 20 senhas erradas do mesmo IP → 401 nas 20 e 429 na 21ª; cada falha grava login_falhou (origem oauth)', async () => {
  const s = await subir();
  const cliente = await novoCliente(s);
  const antesBcrypt = chamadasBcrypt;
  for (let i = 1; i <= 20; i++) {
    const r = await autorizar(s, cliente, { email: ` U${i}@Exemplo.com `, senha: 'errada', ip: '203.0.113.20' });
    assert.equal(r.status, 401, `tentativa ${i}`);
  }
  assert.equal(s.auditoria.length, 20);
  for (const [i, reg] of s.auditoria.entries()) {
    assert.equal(reg.acao, 'login_falhou');
    assert.equal(reg.entidade, 'usuario');
    assert.equal(reg.valorDepois.origem, 'oauth');
    assert.equal(reg.valorDepois.email_tentado, `u${i + 1}@exemplo.com`, 'e-mail normalizado');
    assert.equal(reg.ip, '203.0.113.20');
  }
  const bloqueada = await autorizar(s, cliente, { email: 'u21@exemplo.com', senha: SENHA, ip: '203.0.113.20' }); // até a senha certa
  assert.equal(bloqueada.status, 429);
  assert.match(erroDaPagina(bloqueada.texto), /^Muitas tentativas\. Aguarde (1[0-5]|[1-9]) minutos? e tente de novo\.$/);
  assert.equal(chamadasBcrypt - antesBcrypt, 20, 'a 21ª não chegou ao bcrypt');
  assert.equal(s.auditoria.length, 20, 'a tentativa bloqueada não vira login_falhou');
  assert.ok(bloqueada.headers.get('retry-after'));
  assert.ok(bloqueada.headers.get('ratelimit-policy') && bloqueada.headers.get('ratelimit'), 'cabeçalhos RateLimit-Policy e RateLimit');

  const outroIp = await autorizar(s, cliente, { email: 'master@exemplo.com', ip: '203.0.113.21' });
  assert.equal(outroIp.status, 302, 'outro IP não é afetado');
});

test('S-02: os cabeçalhos RateLimit-Policy e RateLimit vêm em toda resposta do POST /oauth/authorize', async () => {
  const s = await subir();
  const cliente = await novoCliente(s);
  const r = await autorizar(s, cliente, { senha: 'errada', ip: '203.0.113.30' });
  assert.equal(r.status, 401);
  assert.match(r.headers.get('ratelimit-policy'), /^20;w=900$/);
  assert.match(r.headers.get('ratelimit'), /limit=20, remaining=19, reset=\d+/);
});

test('S-02: 11ª falha do mesmo e-mail e IP → 429 antes do bcrypt, mesmo com a senha certa; outro IP e outro e-mail seguem livres', async () => {
  const s = await subir();
  const cliente = await novoCliente(s);
  for (let i = 1; i <= 10; i++) assert.equal((await autorizar(s, cliente, { senha: 'errada', ip: '203.0.113.40' })).status, 401);
  const antes = chamadasBcrypt;
  const r = await autorizar(s, cliente, { senha: SENHA, ip: '203.0.113.40' });
  assert.equal(r.status, 429);
  assert.equal(chamadasBcrypt, antes, 'bloqueado antes do bcrypt');
  assert.equal((await autorizar(s, cliente, { senha: SENHA, ip: '203.0.113.41' })).status, 302, 'mesmo e-mail, outro IP');
  assert.equal((await autorizar(s, cliente, { email: 'u1@exemplo.com', senha: SENHA, ip: '203.0.113.40' })).status, 302, 'outro e-mail, mesmo IP');
});

test('S-02: 11 falhas do mesmo e-mail vindas de IPs diferentes NÃO trancam o /api/auth/login desse e-mail a partir de um IP novo', async () => {
  const s = await subir({}, { comLogin: true });
  const cliente = await novoCliente(s);
  for (let i = 1; i <= 11; i++) {
    assert.equal((await autorizar(s, cliente, { senha: 'errada', ip: `198.51.100.${i}` })).status, 401);
  }
  const login = await fetch(`${s.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.99' }, body: JSON.stringify({ email: 'master@exemplo.com', senha: SENHA }) });
  assert.equal(login.status, 200, 'o login do escritório não é trancado por quem erra de fora');
  const oauth = await autorizar(s, cliente, { senha: SENHA, ip: '203.0.113.99' });
  assert.equal(oauth.status, 302, 'nem o OAuth a partir do IP novo');
});

test('S-02: o contador é dividido entre o login do AM e o conector (5 erros em cada = bloqueia os dois)', async () => {
  const s = await subir({}, { comLogin: true });
  const cliente = await novoCliente(s);
  const login = (senha) => fetch(`${s.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.60' }, body: JSON.stringify({ email: 'master@exemplo.com', senha }) });
  for (let i = 0; i < 5; i++) assert.equal((await login('errada')).status, 401);
  for (let i = 0; i < 5; i++) assert.equal((await autorizar(s, cliente, { senha: 'errada', ip: '203.0.113.60' })).status, 401);
  const l = await login(SENHA);
  assert.equal(l.status, 429, 'login bloqueado');
  assert.equal((await l.json()).ok, false);
  assert.equal((await autorizar(s, cliente, { senha: SENHA, ip: '203.0.113.60' })).status, 429, 'conector bloqueado');
});

test('S-02: teto de 50 falhas por hora por e-mail (de qualquer IP) → 429 só em /oauth/authorize, com limite_email_oauth auditado uma vez', async () => {
  const s = await subir({}, { comLogin: true });
  const cliente = await novoCliente(s);
  for (let ip = 1; ip <= 6; ip++) {
    for (let i = 0; i < (ip < 6 ? 9 : 5); i++) { // 5 × 9 + 5 = 50 falhas, no máximo 9 por IP
      assert.equal((await autorizar(s, cliente, { senha: 'errada', ip: `198.51.100.${ip}` })).status, 401);
    }
  }
  const faltas = s.auditoria.filter(r => r.acao === 'login_falhou').length;
  assert.equal(faltas, 50);
  const r51 = await autorizar(s, cliente, { senha: SENHA, ip: '203.0.113.150' }); // IP novo, senha certa
  assert.equal(r51.status, 429, 'teto por e-mail');
  assert.match(erroDaPagina(r51.texto), /Aguarde (5\d|60) minutos/, 'a espera informada é a do teto (1 hora), não 15 minutos');
  const r52 = await autorizar(s, cliente, { senha: SENHA, ip: '203.0.113.151' });
  assert.equal(r52.status, 429);
  const avisos = s.auditoria.filter(r => r.acao === 'limite_email_oauth');
  assert.equal(avisos.length, 1, 'auditado uma vez por janela');
  assert.equal(avisos[0].valorDepois.email_tentado, 'master@exemplo.com');
  const login = await fetch(`${s.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.152' }, body: JSON.stringify({ email: 'master@exemplo.com', senha: SENHA }) });
  assert.equal(login.status, 200, 'o login do AM nunca é bloqueado pelo teto');
});

test('S-02: conta inexistente, senha errada, júnior, senha provisória e conta de serviço → mesmo status, mesma mensagem, todas auditadas', async () => {
  const s = await subir();
  const cliente = await novoCliente(s);
  const casos = [
    { email: 'ninguem@exemplo.com', senha: SENHA },
    { email: 'master@exemplo.com', senha: 'errada' },
    { email: 'junior@exemplo.com', senha: SENHA },
    { email: 'provisoria@exemplo.com', senha: SENHA },
    { email: CONTA_SERVICO_EMAIL, senha: SENHA },
    { email: 'master@exemplo.com', senha: '' },
    { email: '', senha: SENHA },
  ];
  const mensagens = new Set();
  for (const [i, c] of casos.entries()) {
    const r = await autorizar(s, cliente, { ...c, ip: `203.0.113.${70 + i}` });
    assert.equal(r.status, 401, JSON.stringify(c));
    mensagens.add(erroDaPagina(r.texto));
  }
  assert.deepEqual([...mensagens], ['E-mail, senha ou código inválidos.']);
  assert.equal(s.auditoria.filter(r => r.acao === 'login_falhou').length, casos.length);
  assert.equal(s.auditoria.filter(r => r.acao === 'autorizar_conector_claude').length, 0);
});

test('S-02: o bcrypt roda também quando o e-mail não existe (o tempo não revela quais e-mails existem)', async () => {
  const s = await subir();
  const cliente = await novoCliente(s);
  const antes = chamadasBcrypt;
  await autorizar(s, cliente, { email: 'ninguem@exemplo.com', senha: 'qualquer', ip: '203.0.113.80' });
  assert.equal(chamadasBcrypt - antes, 1);
});

test('S-02: senha que não é texto (JSON) ou gigante não derruba o servidor nem autoriza', async () => {
  const s = await subir();
  const cliente = await novoCliente(s);
  const corpo = { client_id: cliente.client_id, redirect_uri: CALLBACK, response_type: 'code', code_challenge: PKCE().challenge, code_challenge_method: 'S256', email: 'master@exemplo.com', escopos: ['acervo'] };
  for (const senha of [{ $ne: '' }, 12345, ['a'], 'x'.repeat(5000)]) {
    const r = await fetch(`${s.base}/oauth/authorize`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.81' }, body: JSON.stringify({ ...corpo, senha }) });
    assert.equal(r.status, 401);
  }
});

test('S-02: a conta de serviço nunca autoriza o conector, nem se tivesse senha válida; senha acima de 512 caracteres não autoriza (bcrypt só lê 72 bytes)', async () => {
  const s = await subir();
  const cliente = await novoCliente(s);
  const emailComHash = 'hash-longo@exemplo.com';
  const base72 = 'a'.repeat(72);
  const original = { servico: USUARIOS[CONTA_SERVICO_EMAIL], longo: USUARIOS[emailComHash] };
  USUARIOS[CONTA_SERVICO_EMAIL] = mestre({ id: 'u-servico', email: CONTA_SERVICO_EMAIL, senha_hash: HASH_RAPIDO });
  USUARIOS[emailComHash] = mestre({ id: 'u-longo', email: emailComHash, senha_hash: bcrypt.hashSync(base72, 4) });
  try {
    const servico = await autorizar(s, cliente, { email: CONTA_SERVICO_EMAIL, senha: SENHA, ip: '203.0.113.82' });
    assert.equal(servico.status, 401, 'conta de serviço com senha certa');
    const certa = await autorizar(s, cliente, { email: emailComHash, senha: base72, ip: '203.0.113.83' });
    assert.equal(certa.status, 302, 'controle: a senha de 72 caracteres entra');
    const gigante = await autorizar(s, cliente, { email: emailComHash, senha: base72 + 'b'.repeat(600), ip: '203.0.113.84' });
    assert.equal(gigante.status, 401, 'o resto além de 72 bytes não pode ser ignorado em silêncio');
  } finally {
    if (original.servico) USUARIOS[CONTA_SERVICO_EMAIL] = original.servico; else delete USUARIOS[CONTA_SERVICO_EMAIL];
    delete USUARIOS[emailComHash];
  }
});

test('S-02: 2FA — quem ativou é solicitado a informar o código; sem código a página pede e não conta; código errado → 401; certo → 302', async () => {
  const s = await subir();
  const cliente = await novoCliente(s);
  const email = 'dois-fatores@exemplo.com';

  // senha errada não revela que existe 2FA
  const errada = await autorizar(s, cliente, { email, senha: 'errada', ip: '203.0.113.90' });
  assert.equal(errada.status, 401);
  assert.doesNotMatch(errada.texto, /name="totp"/);

  // senha certa e sem código: a página pede o código (12 vezes: não consome o limite de 10)
  for (let i = 0; i < 12; i++) {
    const pede = await autorizar(s, cliente, { email, ip: '203.0.113.90', escopos: ['acervo', 'reprotocolo'] });
    assert.equal(pede.status, 200);
    assert.match(pede.texto, /name="totp"/);
    assert.match(erroDaPagina(pede.texto), /código de verificação/i);
    assert.match(pede.texto, /value="reprotocolo" checked/, 'mantém as permissões marcadas');
    assert.match(pede.texto, /value="dois-fatores@exemplo.com"/, 'mantém o e-mail preenchido');
  }
  assert.equal(s.auditoria.filter(r => r.acao === 'login_falhou').length, 1, 'só a senha errada foi falha');

  const codigoErrado = await autorizar(s, cliente, { email, ip: '203.0.113.90', totp: '000000' });
  assert.equal(codigoErrado.status, 401);
  assert.equal(erroDaPagina(codigoErrado.texto), 'E-mail, senha ou código inválidos.');
  assert.equal(s.auditoria.filter(r => r.acao === 'login_falhou').length, 2);

  const certo = await autorizar(s, cliente, { email, ip: '203.0.113.90', totp: authenticator.generate(SEGREDO_2FA) });
  assert.equal(certo.status, 302);
});

test('S-02: quem não ativou o 2FA entra sem código (2FA continua opcional)', async () => {
  const s = await subir();
  const cliente = await novoCliente(s);
  const r = await autorizar(s, cliente, { totp: '123456', ip: '203.0.113.91' });
  assert.equal(r.status, 302);
});

test('S-02: acertos não consomem os limites (25 autorizações certas seguidas do mesmo e-mail e IP)', async () => {
  const s = await subir();
  const cliente = await novoCliente(s);
  for (let i = 0; i < 25; i++) assert.equal((await autorizar(s, cliente, { ip: '203.0.113.95' })).status, 302, `autorização ${i + 1}`);
  assert.equal(s.auditoria.filter(r => r.acao === 'login_falhou').length, 0);
});

test('S-02: X-Forwarded-For forjado não vale — o IP é o que o proxy acrescentou (req.ip), na auditoria e no limite', async () => {
  const s = await subir();
  const cliente = await novoCliente(s);
  await autorizar(s, cliente, { senha: 'errada', ip: '1.1.1.1, 203.0.113.99' });
  assert.equal(s.auditoria[0].ip, '203.0.113.99', 'não é o primeiro valor do cabeçalho');
  // 20 erros mudando o valor escrito pelo cliente (o primeiro) continuam sendo do mesmo IP real
  for (let i = 0; i < 19; i++) await autorizar(s, cliente, { email: `u${i}@exemplo.com`, senha: 'errada', ip: `10.0.0.${i}, 203.0.113.99` });
  const r = await autorizar(s, cliente, { email: 'u99@exemplo.com', senha: 'errada', ip: '10.9.9.9, 203.0.113.99' });
  assert.equal(r.status, 429);
});

test('S-02: LIMITES_POR_IP=desligado (IP não confiável) — sem limite por IP nem por e-mail + IP, mas o teto de 50 por e-mail continua', async () => {
  const s = await subir({ porIpAtivo: () => false });
  const cliente = await novoCliente(s);
  for (let i = 1; i <= 50; i++) assert.equal((await autorizar(s, cliente, { senha: 'errada', ip: '203.0.113.5' })).status, 401, `falha ${i}`);
  assert.equal((await autorizar(s, cliente, { senha: SENHA, ip: '203.0.113.5' })).status, 429, 'teto por e-mail');
  // com e-mails diferentes, o mesmo IP passa de 20 sem 429
  for (let i = 1; i <= 25; i++) assert.equal((await autorizar(s, cliente, { email: `u${i}@exemplo.com`, senha: 'errada', ip: '203.0.113.6' })).status, 401);
});

test('S-02: /oauth/token e /oauth/register têm limite por IP (30 erros por 15 min e 10 registros por hora)', async () => {
  const s = await subir();
  const token = (ip) => fetch(`${s.base}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': ip }, body: form({ grant_type: 'authorization_code', code: 'nao-existe' }) });
  for (let i = 0; i < 30; i++) assert.equal((await token('203.0.113.110')).status, 400);
  const bloqueado = await token('203.0.113.110');
  assert.equal(bloqueado.status, 429);
  assert.equal((await bloqueado.json()).error, 'too_many_requests');
  assert.equal((await token('203.0.113.111')).status, 400, 'outro IP');

  for (let i = 0; i < 10; i++) assert.equal((await registrar(s, undefined, '203.0.113.112')).status, 201);
  assert.equal((await registrar(s, undefined, '203.0.113.112')).status, 429);
  assert.equal((await registrar(s, undefined, '203.0.113.113')).status, 201, 'outro IP');
});

// ── S-07: registro dinâmico ──

test('S-07: registro só com retornos da lista — host estranho, http em claude.ai e retorno com fragmento → 400 invalid_redirect_uri', async () => {
  const s = await subir();
  for (const uri of ['https://exemplo.invalid/cb', 'http://claude.ai/api/mcp/auth_callback', `${CALLBACK}#x`, 'https://claude.ai.exemplo.invalid/api/mcp/auth_callback']) {
    const r = await registrar(s, { redirect_uris: [uri] });
    assert.equal(r.status, 400, uri);
    assert.equal(r.corpo.error, 'invalid_redirect_uri');
  }
  // um retorno ruim no meio da lista recusa o registro inteiro
  assert.equal((await registrar(s, { redirect_uris: [CALLBACK, 'https://exemplo.invalid/cb'] })).status, 400);
});

test('S-07: claude.ai e claude.com → 201; localhost e 127.0.0.1 (Claude Code, D-S2) → 201', async () => {
  const s = await subir();
  assert.equal((await registrar(s, { redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] })).status, 201);
  assert.equal((await registrar(s, { redirect_uris: ['https://claude.com/api/mcp/auth_callback'] })).status, 201);
  assert.equal((await registrar(s, { redirect_uris: ['http://localhost:53421/callback'] })).status, 201);
  assert.equal((await registrar(s, { redirect_uris: ['http://127.0.0.1:53421/callback'] })).status, 201);
});

test('S-07: sem redirect_uris, mais de 5 URIs ou URIs que não são texto → 400', async () => {
  const s = await subir();
  assert.equal((await registrar(s, {})).status, 400);
  assert.equal((await registrar(s, { redirect_uris: [] })).status, 400);
  assert.equal((await registrar(s, { redirect_uris: 'https://claude.ai/api/mcp/auth_callback' })).status, 400);
  assert.equal((await registrar(s, { redirect_uris: Array(5).fill(CALLBACK) })).status, 201, '5 é o máximo');
  assert.equal((await registrar(s, { redirect_uris: Array(6).fill(CALLBACK) })).status, 400, '6 passa do máximo');
  assert.equal((await registrar(s, { redirect_uris: [42] })).status, 400);
  assert.equal((await registrar(s, { redirect_uris: [{ toString: () => CALLBACK }] })).status, 400);
  assert.equal((await registrar(s, { redirect_uris: [`${CALLBACK}?x=${'a'.repeat(600)}`] })).status, 400, 'mais de 512 caracteres');
});

test('S-07: o Map guarda no máximo 200 clientes — o 201º descarta o mais antigo', async () => {
  const s = await subir({ porIpAtivo: () => false }); // sem o limite de 10 registros por hora
  const primeiro = await novoCliente(s);
  const segundo = await novoCliente(s);
  for (let i = 0; i < 198; i++) await novoCliente(s); // 200 no total
  const get = async (c) => (await fetch(`${s.base}/oauth/authorize?${form({ client_id: c.client_id, redirect_uri: CALLBACK, response_type: 'code', code_challenge: 'x'.repeat(43), code_challenge_method: 'S256' })}`)).status;
  assert.equal(await get(primeiro), 200, 'com 200 clientes o primeiro ainda existe');
  await novoCliente(s); // o 201º
  // o GET acima usou o `primeiro` (reinicia a idade dele), então quem sai é o segundo, o mais antigo sem uso
  assert.equal(await get(segundo), 400, 'o mais antigo sem uso saiu');
  assert.equal(await get(primeiro), 200, 'o que estava em uso ficou');
});

test('S-07: cliente registrado há 30 dias sem uso expira; o uso reinicia o prazo', async () => {
  let agora = 1_000_000_000_000;
  const s = await subir({ agora: () => agora });
  const usado = await novoCliente(s);
  const parado = await novoCliente(s);
  const get = async (c) => (await fetch(`${s.base}/oauth/authorize?${form({ client_id: c.client_id, redirect_uri: CALLBACK, response_type: 'code', code_challenge: 'x'.repeat(43), code_challenge_method: 'S256' })}`)).status;
  agora += 20 * 24 * 3600 * 1000;
  assert.equal(await get(usado), 200); // reinicia os 30 dias do "usado"
  agora += 15 * 24 * 3600 * 1000;      // 35 dias desde o registro, 15 desde o uso
  assert.equal(await get(usado), 200);
  assert.equal(await get(parado), 400, 'parado há 35 dias');
});

test('S-07: a tela mostra "Aplicativo" e "Retorno para: host", com o texto escapado', async () => {
  const s = await subir();
  const { corpo } = await registrar(s, { redirect_uris: [CALLBACK], client_name: '<script>alert(1)</script>"&x' });
  const q = form({ client_id: corpo.client_id, redirect_uri: CALLBACK, response_type: 'code', code_challenge: 'x'.repeat(43), code_challenge_method: 'S256', state: '"><script>alert(2)</script>&amp;', scope: 'acervo' });
  const r = await fetch(`${s.base}/oauth/authorize?${q}`);
  const html = await r.text();
  assert.equal(r.status, 200);
  assert.match(html, /Retorno para: <strong>claude\.ai<\/strong>/);
  assert.match(html, /Aplicativo: <strong>&lt;script&gt;alert\(1\)&lt;\/script&gt;&quot;&amp;x<\/strong>/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /name="state" value="&quot;&gt;&lt;script&gt;alert\(2\)&lt;\/script&gt;&amp;amp;"/, 'campo oculto escapado');
});

test('S-07: client_name é cortado em 100 caracteres, sem caracteres de controle; sem nome vira "Cliente MCP"', async () => {
  const s = await subir();
  const longo = await registrar(s, { redirect_uris: [CALLBACK], client_name: `A${'B'.repeat(200)}` });
  const controle = await registrar(s, { redirect_uris: [CALLBACK], client_name: 'Nome\r\nInjetado' });
  const semNome = await registrar(s, { redirect_uris: [CALLBACK] });
  const pagina = async (c) => (await fetch(`${s.base}/oauth/authorize?${form({ client_id: c.client_id, redirect_uri: CALLBACK, response_type: 'code', code_challenge: 'x'.repeat(43), code_challenge_method: 'S256' })}`)).text();
  assert.match(await pagina(longo.corpo), new RegExp(`Aplicativo: <strong>A${'B'.repeat(99)}</strong>`));
  assert.match(await pagina(controle.corpo), /Aplicativo: <strong>Nome Injetado<\/strong>/);
  assert.match(await pagina(semNome.corpo), /Aplicativo: <strong>Cliente MCP<\/strong>/);
});

test('S-07: retorno diferente do registrado, ou cliente desconhecido, → página de erro 400 (sem formulário de senha útil)', async () => {
  const s = await subir();
  const cliente = await novoCliente(s);
  const r1 = await autorizar(s, cliente, { redirect_uri: 'https://exemplo.invalid/cb' });
  assert.equal(r1.status, 400);
  assert.match(erroDaPagina(r1.texto), /redirect_uri/);
  const r2 = await autorizar(s, { client_id: 'inexistente' });
  assert.equal(r2.status, 400);
  assert.match(erroDaPagina(r2.texto), /client_id desconhecido/);
  assert.equal(s.auditoria.length, 0);
});

test('S-07: a lista vem de OAUTH_REDIRECTS_PERMITIDOS — só claude.ai deixa o Claude Code de fora, e a CSP acompanha', async () => {
  const s = await subir({ redirectsPermitidos: lerRedirectsPermitidos('https://claude.ai/api/mcp/auth_callback') });
  assert.equal((await registrar(s, { redirect_uris: ['http://localhost:53421/callback'] })).status, 400);
  assert.equal((await registrar(s, { redirect_uris: ['https://claude.com/api/mcp/auth_callback'] })).status, 400);
  const cliente = await novoCliente(s);
  const r = await fetch(`${s.base}/oauth/authorize?${form({ client_id: cliente.client_id, redirect_uri: CALLBACK, response_type: 'code', code_challenge: 'x'.repeat(43), code_challenge_method: 'S256' })}`);
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /form-action 'self' https:\/\/claude\.ai(;|$)/);
  assert.doesNotMatch(csp, /localhost|claude\.com/);
});

// ── S-19: CSP da tela ──

test('S-19: a tela de autorização tem CSP com form-action do Claude e frame-ancestors none; sem cache', async () => {
  const s = await subir();
  const cliente = await novoCliente(s);
  const url = `${s.base}/oauth/authorize?${form({ client_id: cliente.client_id, redirect_uri: CALLBACK, response_type: 'code', code_challenge: 'x'.repeat(43), code_challenge_method: 'S256' })}`;
  for (const r of [await fetch(url), await fetch(`${s.base}/oauth/authorize?client_id=x`)]) { // a boa e a de erro
    const csp = r.headers.get('content-security-policy');
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /style-src 'unsafe-inline'/);
    assert.match(csp, /form-action 'self' https:\/\/claude\.ai https:\/\/claude\.com http:\/\/localhost:\* http:\/\/127\.0\.0\.1:\*/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /base-uri 'none'/);
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.match(r.headers.get('content-type'), /text\/html/);
  }
  // a tela não tem script nem recurso externo: a CSP `default-src 'none'` não quebra nada
  const html = await (await fetch(url)).text();
  assert.doesNotMatch(html, /<script|<link|<img|<iframe|src=/i);
  // a página do POST (erro e 429) também leva a CSP
  const erro = await autorizar(s, cliente, { senha: 'errada', ip: '203.0.113.120' });
  assert.equal(erro.status, 401);
  assert.match(erro.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

// ── Fluxo legítimo do conector ──

async function lerMcp(resposta) {
  const texto = await resposta.text();
  return texto.includes('data:') ? JSON.parse(texto.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5)).join('')) : JSON.parse(texto);
}
const chamarMcp = (s, token, method = 'tools/list') => fetch(`${s.base}/mcp`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: {} }),
});

test('fluxo do conector: register → GET authorize → POST authorize → token (PKCE) → /mcp com Bearer; escopos e limites de área valem', async () => {
  const s = await subir();
  const cliente = await novoCliente(s);
  assert.match(cliente.client_id, /^[0-9a-f]{32}$/);
  assert.deepEqual(cliente.redirect_uris, [CALLBACK]);
  assert.equal(cliente.token_endpoint_auth_method, 'none');

  const pkce = PKCE();
  const get = await fetch(`${s.base}/oauth/authorize?${form({ client_id: cliente.client_id, redirect_uri: CALLBACK, response_type: 'code', code_challenge: pkce.challenge, code_challenge_method: 'S256', state: 'abc', scope: 'reprotocolo' })}`);
  const pagina = await get.text();
  assert.equal(get.status, 200);
  assert.match(pagina, /Retorno para: <strong>claude\.ai<\/strong>/);
  assert.match(pagina, /value="reprotocolo" checked/, 'o escopo pedido vem marcado');
  assert.match(pagina, /name="client_id" value="[0-9a-f]{32}"/, 'a tela leva os campos do pedido adiante');

  const post = await autorizar(s, cliente, { pkce, state: 'abc', escopos: ['acervo', 'reprotocolo'], ip: '203.0.113.130' });
  assert.equal(post.status, 302);
  const destino = new URL(post.headers.get('location'));
  assert.equal(destino.origin + destino.pathname, CALLBACK);
  assert.equal(destino.searchParams.get('state'), 'abc');
  const code = destino.searchParams.get('code');
  assert.match(code, /^[0-9a-f]{48}$/);
  const aut = s.auditoria.find(r => r.acao === 'autorizar_conector_claude');
  assert.deepEqual(aut.valorDepois.escopos, ['acervo', 'reprotocolo']);
  assert.equal(aut.usuarioId, 'u-mestre');

  const tokenReq = (extra = {}) => fetch(`${s.base}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'authorization_code', code, client_id: cliente.client_id, redirect_uri: CALLBACK, code_verifier: pkce.verifier, ...extra }) });
  // PKCE errado não passa — e queima o código
  const ruim = await tokenReq({ code_verifier: 'outro-verificador' });
  assert.equal(ruim.status, 400);
  assert.equal((await ruim.json()).error, 'invalid_grant');
  assert.equal((await tokenReq()).status, 400, 'o código é de uso único');

  // de novo, agora certo
  const pkce2 = PKCE();
  const post2 = await autorizar(s, cliente, { pkce: pkce2, escopos: ['acervo', 'reprotocolo'], ip: '203.0.113.130' });
  const code2 = new URL(post2.headers.get('location')).searchParams.get('code');
  const ok = await fetch(`${s.base}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'authorization_code', code: code2, client_id: cliente.client_id, redirect_uri: CALLBACK, code_verifier: pkce2.verifier }) });
  assert.equal(ok.status, 200);
  const resposta = await ok.json();
  assert.equal(resposta.token_type, 'Bearer');
  assert.equal(resposta.scope, 'acervo reprotocolo');
  const claims = jwt.verify(resposta.access_token, process.env.JWT_SECRET);
  assert.equal(claims.email, CONTA_SERVICO_EMAIL);
  assert.deepEqual(claims.escopos, ['acervo', 'reprotocolo']);
  assert.equal(claims.autorizado_por, 'u-mestre');

  // o token vale no /mcp e no acervo; fora dos escopos, 403
  const mcp = await chamarMcp(s, resposta.access_token);
  assert.equal(mcp.status, 200);
  assert.ok((await lerMcp(mcp)).result.tools.some(t => t.name === 'listar_teses'));
  const auth = { headers: { Authorization: `Bearer ${resposta.access_token}` } };
  assert.equal((await fetch(`${s.base}/api/acervo/teses`, auth)).status, 200);
  assert.equal((await fetch(`${s.base}/api/usuarios`, auth)).status, 403);
  assert.equal((await chamarMcp(s, undefined)).status, 401, '/mcp sem token');
});

test('fluxo do conector no Claude Code: retorno local em localhost autoriza e devolve o código na própria máquina', async () => {
  const s = await subir();
  const local = 'http://localhost:53421/callback';
  const { corpo: cliente } = await registrar(s, { redirect_uris: [local], client_name: 'Claude Code' });
  const r = await autorizar(s, cliente, { redirect_uri: local, ip: '203.0.113.131' });
  assert.equal(r.status, 302);
  const destino = new URL(r.headers.get('location'));
  assert.equal(destino.origin, 'http://localhost:53421');
  assert.ok(destino.searchParams.get('code'));
  // a tela mostra o host local
  const pagina = await (await fetch(`${s.base}/oauth/authorize?${form({ client_id: cliente.client_id, redirect_uri: local, response_type: 'code', code_challenge: 'x'.repeat(43), code_challenge_method: 'S256' })}`)).text();
  assert.match(pagina, /Retorno para: <strong>localhost:53421<\/strong>/);
});

test('fluxo do conector: o formulário é lido pelo próprio roteador (com ou sem urlencoded global no index.js — S-01)', async () => {
  for (const globalUrlencoded of [false, true]) {
    const s = await subir({}, { globalUrlencoded });
    const cliente = await novoCliente(s);
    const r = await autorizar(s, cliente, { ip: '203.0.113.132' });
    assert.equal(r.status, 302, `globalUrlencoded=${globalUrlencoded}`);
    const code = new URL(r.headers.get('location')).searchParams.get('code');
    const t = await fetch(`${s.base}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'authorization_code', code, client_id: cliente.client_id, redirect_uri: CALLBACK, code_verifier: r.pkce.verifier }) });
    assert.equal(t.status, 200, `token, globalUrlencoded=${globalUrlencoded}`);
  }
});

test('fluxo do conector: refresh_token nunca é aceito; grant desconhecido → 400; metadados sem refresh_token', async () => {
  const s = await subir();
  const r = await fetch(`${s.base}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'refresh_token', refresh_token: 'qualquer' }) });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, 'invalid_grant');
  const g = await fetch(`${s.base}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'password' }) });
  assert.equal((await g.json()).error, 'unsupported_grant_type');
  const meta = await (await fetch(`${s.base}/.well-known/oauth-authorization-server`)).json();
  assert.deepEqual(meta.grant_types_supported, ['authorization_code']);
  assert.deepEqual(meta.code_challenge_methods_supported, ['S256']);
  const recurso = await (await fetch(`${s.base}/.well-known/oauth-protected-resource`)).json();
  assert.deepEqual(recurso.scopes_supported, ['acervo', 'reprotocolo']);
});

test('sem "marcar ao menos uma permissão" nenhum código é emitido, e o pedido sem PKCE S256 é recusado', async () => {
  const s = await subir();
  const cliente = await novoCliente(s);
  const semEscopo = await autorizar(s, cliente, { escopos: [], ip: '203.0.113.133' });
  assert.equal(semEscopo.status, 400);
  assert.match(erroDaPagina(semEscopo.texto), /ao menos uma permissão/);
  const corpo = { client_id: cliente.client_id, redirect_uri: CALLBACK, response_type: 'code', code_challenge: 'abc', code_challenge_method: 'plain', email: 'master@exemplo.com', senha: SENHA, escopos: 'acervo' };
  const r = await fetch(`${s.base}/oauth/authorize`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': '203.0.113.134' }, body: form(corpo) });
  assert.equal(r.status, 400);
});
