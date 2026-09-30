import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import 'express-async-errors';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

// S-03 (sessão revogável) e S-04 (primeiro acesso e troca de senha) — fluxos de login, refresh, revogação,
// hierarquia de tokens e compatibilidade com o formato ANTIGO de sessão (D-S1: as sessões abertas no deploy
// continuam valendo). Sem banco real: banco em memória que só reconhece os SQL do próprio código
// (src/test-suporte/bancoSessaoFalso.js).
process.env.JWT_SECRET = 'segredo-de-teste';
process.env.JWT_REFRESH_SECRET = 'refresh-de-teste';

const { db } = await import('../db/index.js');
const { criarBancoFalso } = await import('../test-suporte/bancoSessaoFalso.js');
const banco = criarBancoFalso();
banco.instalar(db);

const { authRouter } = await import('./auth.js');
const { usuariosRouter } = await import('./usuarios.js');
const { autenticar, apenasMaster } = await import('../middleware/auth.js');
const { auditar } = await import('../middleware/auditoria.js');
const { definirCarregador, invalidarSessao } = await import('../middleware/sessao.js');
const { CONTA_SERVICO_EMAIL } = await import('../oauth/escopos.js');
const { SQL_MIGRACAO_SESSAO, migrarSessaoRevogavel } = await import('../db/migracaoSessao.js');

const JWT_SECRET = process.env.JWT_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

const app = express();
app.use(cookieParser());
app.use(express.json());
app.use(auditar);
app.use('/api/auth', authRouter);
app.use('/api/usuarios', autenticar, usuariosRouter);
app.get('/api/probe', autenticar, (req, res) => res.json({ ok: true, user: req.user }));
app.get('/api/probe-master', autenticar, apenasMaster, (_req, res) => res.json({ ok: true }));
app.use('/api/acervo', autenticar, (req, res) => res.json({ ok: true, user: req.user }));
app.use((err, _req, res, _next) => res.status(500).json({ ok: false, erro: err.message }));

const servidor = app.listen(0);
const base = `http://127.0.0.1:${servidor.address().port}`;
after(() => servidor.close());

// ── dados fictícios ──
const SENHA = 'SenhaAtual#2026';
const PROVISORIA = 'Provisoria#123';
const HASH_SENHA = bcrypt.hashSync(SENHA, 4);
const HASH_PROV = bcrypt.hashSync(PROVISORIA, 4);
const ID = {
  master: '11111111-1111-4111-8111-111111111111',
  master2: '22222222-2222-4222-8222-222222222222',
  junior: '33333333-3333-4333-8333-333333333333',
  novo: '44444444-4444-4444-8444-444444444444',
  servico: '55555555-5555-4555-8555-555555555555',
};

function semear() {
  banco.usuarios.clear();
  banco.sessoes = [];
  banco.logs = [];
  banco.consultas = [];
  banco.fora = false;
  banco.adicionarUsuario({ id: ID.master, nome: 'Ana Master', email: 'ana@exemplo.com', perfil: 'master', pode_marcar_restrito: true, senha_hash: HASH_SENHA });
  banco.adicionarUsuario({ id: ID.master2, nome: 'Bruno Master', email: 'bruno@exemplo.com', perfil: 'master', senha_hash: HASH_SENHA });
  banco.adicionarUsuario({ id: ID.junior, nome: 'Carla Junior', email: 'carla@exemplo.com', perfil: 'junior', master_id: ID.master2, senha_hash: HASH_SENHA });
  banco.adicionarUsuario({ id: ID.novo, nome: 'Davi Novo', email: 'davi@exemplo.com', perfil: 'junior', master_id: ID.master2, senha_hash: HASH_PROV, senha_temporaria: true });
  banco.adicionarUsuario({ id: ID.servico, nome: 'Integração Claude', email: CONTA_SERVICO_EMAIL, perfil: 'master', senha_hash: HASH_SENHA });
  definirCarregador(); // volta ao carregador do banco e zera o cache
}
beforeEach(semear);

// Cliente HTTP com "jar" de cookies (como o navegador).
function cliente() {
  const jar = {};
  async function chamar(metodo, caminho, corpo, { bearer } = {}) {
    const cookie = Object.entries(jar).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await fetch(`${base}${caminho}`, {
      method: metodo,
      headers: {
        ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    });
    const setCookies = r.headers.getSetCookie();
    for (const sc of setCookies) {
      const [par] = sc.split(';');
      const i = par.indexOf('=');
      jar[par.slice(0, i)] = decodeURIComponent(par.slice(i + 1));
    }
    return { status: r.status, corpo: await r.json().catch(() => null), setCookies };
  }
  return { jar, chamar };
}
async function logar(email = 'ana@exemplo.com', senha = SENHA) {
  const c = cliente();
  const r = await c.chamar('POST', '/api/auth/login', { email, senha });
  return { c, r };
}
const agora = () => Date.now();
const assinarAcesso = (payload, opcoes = { expiresIn: '1h' }) => jwt.sign(payload, JWT_SECRET, opcoes);
const assinarRefreshAntigo = (u) => jwt.sign(
  { id: u.id, nome: u.nome, email: u.email, perfil: u.perfil, master_id: u.master_id, pode_marcar_restrito: u.pode_marcar_restrito },
  REFRESH_SECRET, { expiresIn: '7d' },
);
const TOKEN_ANTIGO_DA_ANA = () => assinarAcesso({ id: ID.master, nome: 'Ana Master', email: 'ana@exemplo.com', perfil: 'master', master_id: null, pode_marcar_restrito: true }, { expiresIn: '1d' });

// ─────────────────────────── login ───────────────────────────

test('login: sucesso → cookies, corpo com os mesmos campos de sempre e linha de refresh gravada', async () => {
  const { c, r } = await logar();
  assert.equal(r.status, 200);
  assert.equal(r.corpo.ok, true);
  assert.deepEqual(Object.keys(r.corpo.user).sort(), ['email', 'id', 'master_id', 'nome', 'perfil', 'pode_marcar_restrito']);
  assert.ok(c.jar.am_token && c.jar.am_refresh);
  const acesso = jwt.verify(c.jar.am_token, JWT_SECRET);
  assert.equal(acesso.sv, 0);
  assert.ok(acesso.fam);
  assert.equal(acesso.exp - acesso.iat, 3600, 'acesso dura 1 hora');
  const refresh = jwt.verify(c.jar.am_refresh, REFRESH_SECRET);
  // o refresh novo mantém os campos antigos e acrescenta rid/fam/sv
  assert.equal(refresh.perfil, 'master');
  assert.equal(refresh.email, 'ana@exemplo.com');
  assert.equal(refresh.pode_marcar_restrito, true);
  assert.ok(refresh.rid && refresh.fam === acesso.fam && refresh.sv === 0);
  assert.equal(banco.sessoesDo(ID.master).length, 1);
  assert.notEqual(banco.sessoes[0].token_hash, c.jar.am_refresh, 'só o hash é guardado, nunca o token');
  assert.ok(banco.acoes().includes('login'));
});

test('login: senha errada e e-mail inexistente → mesmo status e mesmo corpo; bcrypt roda nos dois casos', async () => {
  const original = bcrypt.compare;
  const chamadas = [];
  bcrypt.compare = async (...a) => { chamadas.push(a); return original(...a); };
  try {
    const errada = await cliente().chamar('POST', '/api/auth/login', { email: 'ana@exemplo.com', senha: 'errada-errada' });
    const inexistente = await cliente().chamar('POST', '/api/auth/login', { email: 'ninguem@exemplo.com', senha: 'errada-errada' });
    assert.equal(errada.status, 401);
    assert.equal(inexistente.status, 401);
    assert.deepEqual(errada.corpo, inexistente.corpo);
    assert.equal(chamadas.length, 2, 'o bcrypt precisa rodar mesmo sem usuário (tempo igual)');
    const hashFalso = chamadas[1][1];
    assert.match(hashFalso, /^\$2b\$12\$/);
    assert.equal(hashFalso.length, 60);
    assert.equal(await original('qualquer-coisa', hashFalso), false);
  } finally {
    bcrypt.compare = original;
  }
  assert.equal(banco.acoes().filter((a) => a === 'login_falhou').length, 2);
  assert.equal(banco.sessoes.length, 0);
});

test('login: conta desativada e corpo malformado', async () => {
  banco.usuarios.get(ID.master).ativo = false;
  assert.equal((await logar()).r.status, 401);
  const c = cliente();
  assert.equal((await c.chamar('POST', '/api/auth/login', { email: 'ana@exemplo.com' })).status, 400);
  assert.equal((await c.chamar('POST', '/api/auth/login', { email: { $ne: 1 }, senha: 'x' })).status, 400);
});

test('login: 2FA ativo sem código → pede o código e NÃO abre sessão', async () => {
  Object.assign(banco.usuarios.get(ID.master), { totp_ativo: true, totp_secret: 'JBSWY3DPEHPK3PXP' });
  const { c, r } = await logar();
  assert.equal(r.status, 200);
  assert.equal(r.corpo.requer_totp, true);
  assert.equal(c.jar.am_token, undefined);
  assert.equal(banco.sessoes.length, 0);
});

// ─────────────────────────── primeiro acesso (S-04) ───────────────────────────

test('primeiro acesso: login com senha provisória → token de finalidade única, sem cookie, sem userId, sem sessão', async () => {
  const { c, r } = await logar('davi@exemplo.com', PROVISORIA);
  assert.equal(r.status, 200);
  assert.equal(r.corpo.ok, false);
  assert.equal(r.corpo.primeiro_acesso, true);
  assert.ok(r.corpo.token_primeiro_acesso);
  assert.equal('userId' in r.corpo, false);
  assert.equal(c.jar.am_token, undefined);
  assert.equal(c.jar.am_refresh, undefined);
  assert.equal(r.setCookies.length, 0);
  assert.equal(banco.sessoes.length, 0);
  const dados = jwt.decode(r.corpo.token_primeiro_acesso);
  assert.equal(dados.fin, 'primeiro_acesso');
  assert.equal(dados.aud, 'am-primeiro-acesso');
  assert.equal(dados.exp - dados.iat, 300, 'vale 5 minutos');
  // assinado com chave derivada: o JWT_SECRET puro não o verifica
  assert.throws(() => jwt.verify(r.corpo.token_primeiro_acesso, JWT_SECRET));
});

test('primeiro acesso: o token NÃO vale como sessão (Bearer em /api/usuarios, /api/auth/me e demais áreas → 401)', async () => {
  const { r } = await logar('davi@exemplo.com', PROVISORIA);
  const token = r.corpo.token_primeiro_acesso;
  const c = cliente();
  for (const caminho of ['/api/usuarios', '/api/auth/me', '/api/probe', '/api/probe-master']) {
    const resp = await c.chamar('GET', caminho, undefined, { bearer: token });
    assert.equal(resp.status, 401, caminho);
  }
  // mesmo que alguém assine um token de finalidade única com o JWT_SECRET puro (fin/aud): o autenticar recusa
  const comFin = assinarAcesso({ id: ID.master, perfil: 'master', pode_marcar_restrito: true, fin: 'primeiro_acesso', sv: 0 });
  assert.equal((await c.chamar('GET', '/api/usuarios', undefined, { bearer: comFin })).status, 401);
  const comAud = assinarAcesso({ id: ID.master, perfil: 'master', sv: 0 }, { expiresIn: '5m', audience: 'am-primeiro-acesso' });
  assert.equal((await c.chamar('GET', '/api/usuarios', undefined, { bearer: comAud })).status, 401);
  const audQualquer = assinarAcesso({ id: ID.master, perfil: 'master', sv: 0, aud: 'outra-coisa' });
  assert.equal((await c.chamar('GET', '/api/probe', undefined, { bearer: audQualquer })).status, 401);
  // `aud` de sessão e ausência de `aud` valem
  const audSessao = assinarAcesso({ id: ID.master, perfil: 'master', sv: 0, aud: 'am-sessao' });
  assert.equal((await c.chamar('GET', '/api/probe', undefined, { bearer: audSessao })).status, 200);
});

test('trocar-senha: validações do pedido (sem token, sem provisória, userId, token de outra finalidade, vencido)', async () => {
  const c = cliente();
  const { r } = await logar('davi@exemplo.com', PROVISORIA);
  const token = r.corpo.token_primeiro_acesso;
  const nova = 'NovaSenhaForte#9';

  assert.equal((await c.chamar('POST', '/api/auth/trocar-senha', { novaSenha: nova, senha_provisoria: PROVISORIA })).status, 400, 'sem token');
  assert.equal((await c.chamar('POST', '/api/auth/trocar-senha', { token, novaSenha: nova })).status, 400, 'sem a senha provisória no mesmo pedido');
  assert.equal((await c.chamar('POST', '/api/auth/trocar-senha', { userId: ID.novo, novaSenha: nova, senha_provisoria: PROVISORIA })).status, 400, 'formato antigo (userId)');
  assert.equal((await c.chamar('POST', '/api/auth/trocar-senha', { token, userId: ID.novo, novaSenha: nova, senha_provisoria: PROVISORIA })).status, 400, 'userId junto com token');

  const acesso = assinarAcesso({ id: ID.novo, sv: 0 });
  assert.equal((await c.chamar('POST', '/api/auth/trocar-senha', { token: acesso, novaSenha: nova, senha_provisoria: PROVISORIA })).status, 401, 'token de sessão não serve');
  const vencido = jwt.sign({ fin: 'primeiro_acesso', id: ID.novo, sv: 0 }, 'x', { expiresIn: -10 });
  assert.equal((await c.chamar('POST', '/api/auth/trocar-senha', { token: vencido, novaSenha: nova, senha_provisoria: PROVISORIA })).status, 401);
  assert.equal((await c.chamar('POST', '/api/auth/trocar-senha', { token: 'lixo', novaSenha: nova, senha_provisoria: PROVISORIA })).status, 401);
  // token de finalidade única VENCIDO de verdade (assinado com a chave certa)
  const derivado = (await import('node:crypto')).createHmac('sha256', JWT_SECRET).update('am-primeiro-acesso').digest('hex');
  const vencidoDeVerdade = jwt.sign({ fin: 'primeiro_acesso', id: ID.novo, sv: 0 }, derivado, { expiresIn: -10, audience: 'am-primeiro-acesso' });
  assert.equal((await c.chamar('POST', '/api/auth/trocar-senha', { token: vencidoDeVerdade, novaSenha: nova, senha_provisoria: PROVISORIA })).status, 401);
  // nada mudou
  assert.equal(banco.usuarios.get(ID.novo).senha_temporaria, true);
  assert.equal(banco.usuarios.get(ID.novo).sessao_versao, 0);
});

test('trocar-senha: regras da senha nova (mínimo 10, diferente da provisória) e provisória incorreta', async () => {
  const c = cliente();
  const { r } = await logar('davi@exemplo.com', PROVISORIA);
  const token = r.corpo.token_primeiro_acesso;
  assert.equal((await c.chamar('POST', '/api/auth/trocar-senha', { token, novaSenha: '123456789', senha_provisoria: PROVISORIA })).status, 400, '9 caracteres');
  assert.equal((await c.chamar('POST', '/api/auth/trocar-senha', { token, novaSenha: PROVISORIA, senha_provisoria: PROVISORIA })).status, 400, 'igual à provisória');
  assert.equal((await c.chamar('POST', '/api/auth/trocar-senha', { token, novaSenha: 'NovaSenhaForte#9', senha_provisoria: 'Outra#Senha#1' })).status, 400, 'provisória incorreta');
  assert.equal((await c.chamar('POST', '/api/auth/trocar-senha', { token, novaSenha: 'x'.repeat(200), senha_provisoria: PROVISORIA })).status, 400, 'senha enorme');
  assert.equal(banco.usuarios.get(ID.novo).senha_temporaria, true, 'nada mudou');
  assert.ok(!banco.acoes().includes('primeiro_acesso_senha'));
});

test('trocar-senha: fluxo completo — provisória desligada, versão +1, auditado sem senha, entra com a nova; reuso → 403', async () => {
  const c = cliente();
  const { r } = await logar('davi@exemplo.com', PROVISORIA);
  const token = r.corpo.token_primeiro_acesso;
  const nova = 'NovaSenhaForte#9';
  const ok = await c.chamar('POST', '/api/auth/trocar-senha', { token, novaSenha: nova, senha_provisoria: PROVISORIA });
  assert.equal(ok.status, 200);
  const davi = banco.usuarios.get(ID.novo);
  assert.equal(davi.senha_temporaria, false);
  assert.equal(davi.sessao_versao, 1);
  assert.ok(await bcrypt.compare(nova, davi.senha_hash));
  const log = banco.logs.find((l) => l.acao === 'primeiro_acesso_senha');
  assert.ok(log);
  assert.ok(!JSON.stringify(banco.logs).includes(nova) && !JSON.stringify(banco.logs).includes(PROVISORIA));

  // reuso do mesmo token → 403 (a conta já não está com senha provisória)
  assert.equal((await c.chamar('POST', '/api/auth/trocar-senha', { token, novaSenha: 'OutraSenhaForte#1', senha_provisoria: PROVISORIA })).status, 403);
  // a provisória não entra mais; a nova entra, com sessão completa
  assert.equal((await logar('davi@exemplo.com', PROVISORIA)).r.status, 401);
  const entrou = await logar('davi@exemplo.com', nova);
  assert.equal(entrou.r.status, 200);
  assert.equal(entrou.r.corpo.ok, true);
  assert.equal(jwt.verify(entrou.c.jar.am_token, JWT_SECRET).sv, 1);
  assert.equal((await entrou.c.chamar('GET', '/api/probe')).status, 200);
});

test('trocar-senha: token de um login anterior à redefinição pelo Master (versão mudou) → 401', async () => {
  const c = cliente();
  const { r } = await logar('davi@exemplo.com', PROVISORIA);
  banco.usuarios.get(ID.novo).sessao_versao = 1; // um Master redefiniu a provisória depois
  invalidarSessao(ID.novo);
  const resp = await c.chamar('POST', '/api/auth/trocar-senha', { token: r.corpo.token_primeiro_acesso, novaSenha: 'NovaSenhaForte#9', senha_provisoria: PROVISORIA });
  assert.equal(resp.status, 401);
});

test('trocar-senha: dois pedidos simultâneos com o mesmo token → só um grava', async () => {
  const { r } = await logar('davi@exemplo.com', PROVISORIA);
  const token = r.corpo.token_primeiro_acesso;
  const pedidos = ['NovaSenhaForte#9', 'OutraSenhaForte#8'].map((novaSenha) =>
    cliente().chamar('POST', '/api/auth/trocar-senha', { token, novaSenha, senha_provisoria: PROVISORIA }));
  const respostas = await Promise.all(pedidos);
  assert.deepEqual(respostas.map((x) => x.status).sort(), [200, 403]);
  assert.equal(banco.usuarios.get(ID.novo).sessao_versao, 1);
});

// ─────────────────────────── autenticar (sessão revogável) ───────────────────────────

test('autenticar: conta desativada → 401', async () => {
  const { c } = await logar();
  assert.equal((await c.chamar('GET', '/api/probe')).status, 200);
  banco.usuarios.get(ID.master).ativo = false;
  invalidarSessao(ID.master);
  assert.equal((await c.chamar('GET', '/api/probe')).status, 401);
});

test('autenticar: versão de sessão diferente → 401; token sem `sv` só vale com versão 0', async () => {
  const c = cliente();
  const semSv = TOKEN_ANTIGO_DA_ANA();
  assert.equal((await c.chamar('GET', '/api/probe', undefined, { bearer: semSv })).status, 200, 'token do formato antigo, versão 0 → passa');
  const comSv0 = assinarAcesso({ id: ID.master, perfil: 'master', sv: 0 });
  assert.equal((await c.chamar('GET', '/api/probe', undefined, { bearer: comSv0 })).status, 200);

  banco.usuarios.get(ID.master).sessao_versao = 1;
  invalidarSessao(ID.master);
  assert.equal((await c.chamar('GET', '/api/probe', undefined, { bearer: semSv })).status, 401, 'sem sv com versão 1');
  assert.equal((await c.chamar('GET', '/api/probe', undefined, { bearer: comSv0 })).status, 401, 'sv 0 com versão 1');
  const comSv1 = assinarAcesso({ id: ID.master, perfil: 'master', sv: 1 });
  assert.equal((await c.chamar('GET', '/api/probe', undefined, { bearer: comSv1 })).status, 200);
  const comSv2 = assinarAcesso({ id: ID.master, perfil: 'master', sv: 2 });
  assert.equal((await c.chamar('GET', '/api/probe', undefined, { bearer: comSv2 })).status, 401, 'versão futura também não vale');
});

test('autenticar: o perfil vem do BANCO — token de Master de quem hoje é júnior → apenasMaster responde 403', async () => {
  const c = cliente();
  const tokenMaster = assinarAcesso({ id: ID.junior, nome: 'Carla', email: 'carla@exemplo.com', perfil: 'master', pode_marcar_restrito: true, sv: 0 });
  const r = await c.chamar('GET', '/api/probe-master', undefined, { bearer: tokenMaster });
  assert.equal(r.status, 403);
  const sonda = await c.chamar('GET', '/api/probe', undefined, { bearer: tokenMaster });
  assert.equal(sonda.corpo.user.perfil, 'junior');
  assert.equal(sonda.corpo.user.pode_marcar_restrito, false, 'pode_marcar_restrito também vem do banco');
  assert.equal(sonda.corpo.user.master_id, ID.master2);
  // e o inverso continua funcionando: Master no banco, Master no token
  const tokenOk = assinarAcesso({ id: ID.master, perfil: 'junior', sv: 0 });
  assert.equal((await c.chamar('GET', '/api/probe-master', undefined, { bearer: tokenOk })).status, 200, 'promoção também vale');
});

test('autenticar: desativado passa a receber 401 em até 30 s mesmo sem nenhuma invalidação (cache de 30 s)', async () => {
  const { c } = await logar();
  const t0 = agora();
  assert.equal((await c.chamar('GET', '/api/probe')).status, 200);
  banco.usuarios.get(ID.master).ativo = false; // mudança vinda de fora deste processo: ninguém chamou invalidarSessao
  let relogio = t0 + 10_000;
  const original = Date.now;
  try {
    Date.now = () => relogio;
    assert.equal((await c.chamar('GET', '/api/probe')).status, 200, 'dentro da janela do cache ainda vale');
    relogio = t0 + 31_000;
    assert.equal((await c.chamar('GET', '/api/probe')).status, 401, 'depois de 30 s, 401');
  } finally {
    Date.now = original;
  }
});

test('autenticar: cache velho nunca recusa sozinho (versão nova no banco já vale na primeira requisição)', async () => {
  const c = cliente();
  const sv0 = assinarAcesso({ id: ID.master, perfil: 'master', sv: 0 });
  assert.equal((await c.chamar('GET', '/api/probe', undefined, { bearer: sv0 })).status, 200); // cacheia versão 0
  banco.usuarios.get(ID.master).sessao_versao = 1;     // ex.: alterar-senha em outra instância
  const sv1 = assinarAcesso({ id: ID.master, perfil: 'master', sv: 1 });
  assert.equal((await c.chamar('GET', '/api/probe', undefined, { bearer: sv1 })).status, 200, 'token novo passa mesmo com cache velho');
});

test('autenticar: banco fora → 503 (nunca 401: não desloga ninguém por falha nossa)', async () => {
  const { c } = await logar();
  invalidarSessao(ID.master);
  banco.fora = true;
  const r = await c.chamar('GET', '/api/probe');
  assert.equal(r.status, 503);
  banco.fora = false;
  assert.equal((await c.chamar('GET', '/api/probe')).status, 200);
});

test('autenticar: id de token que não é UUID (assinado, mas inválido) → 401, sem consultar o banco', async () => {
  const c = cliente();
  const t = assinarAcesso({ id: "1'; DROP TABLE usuarios;--", perfil: 'master', sv: 0 });
  const antes = banco.consultas.length;
  assert.equal((await c.chamar('GET', '/api/probe', undefined, { bearer: t })).status, 401);
  assert.equal(banco.consultas.length, antes);
});

// ─────────────────────────── conector (token com escopos) ───────────────────────────

const tokenConector = (extra = {}) => assinarAcesso({
  id: ID.servico, nome: 'Integração Claude', email: CONTA_SERVICO_EMAIL, perfil: 'master',
  escopos: ['acervo'], autorizado_por: ID.master, sv: 0, ...extra,
}, { expiresIn: '30d' });

test('conector: autorizador ativo e Master → passa; desativado → 401; júnior → 401; reativado → volta', async () => {
  const c = cliente();
  assert.equal((await c.chamar('GET', '/api/acervo/teses', undefined, { bearer: tokenConector() })).status, 200);

  banco.usuarios.get(ID.master).ativo = false;
  invalidarSessao(ID.master);
  assert.equal((await c.chamar('GET', '/api/acervo/teses', undefined, { bearer: tokenConector() })).status, 401);

  banco.usuarios.get(ID.master).ativo = true;
  banco.usuarios.get(ID.master).perfil = 'junior';
  invalidarSessao(ID.master);
  assert.equal((await c.chamar('GET', '/api/acervo/teses', undefined, { bearer: tokenConector() })).status, 401, 'autorizador rebaixado');

  banco.usuarios.get(ID.master).perfil = 'master';
  invalidarSessao(ID.master);
  assert.equal((await c.chamar('GET', '/api/acervo/teses', undefined, { bearer: tokenConector() })).status, 200);
});

test('conector: versão da conta de serviço derruba os tokens antigos; token de antes do S-03 (sem sv) segue valendo na versão 0', async () => {
  const c = cliente();
  const antigo = assinarAcesso({ id: ID.servico, nome: 'Integração Claude', email: CONTA_SERVICO_EMAIL, perfil: 'master' }, { expiresIn: '30d' });
  assert.equal((await c.chamar('GET', '/api/acervo/teses', undefined, { bearer: antigo })).status, 200, 'conector já conectado antes do deploy continua funcionando');
  const semSv = tokenConector({ sv: undefined });
  assert.equal((await c.chamar('GET', '/api/acervo/teses', undefined, { bearer: semSv })).status, 200);

  banco.usuarios.get(ID.servico).sessao_versao = 1; // roteiro de incidente: conector comprometido
  invalidarSessao(ID.servico);
  assert.equal((await c.chamar('GET', '/api/acervo/teses', undefined, { bearer: antigo })).status, 401);
  assert.equal((await c.chamar('GET', '/api/acervo/teses', undefined, { bearer: tokenConector() })).status, 401);
  assert.equal((await c.chamar('GET', '/api/acervo/teses', undefined, { bearer: tokenConector({ sv: 1 }) })).status, 200, 'token emitido depois carrega a versão nova');
});

test('conector: continua confinado às áreas dos escopos e NÃO troca senha nem encerra sessões', async () => {
  const c = cliente();
  assert.equal((await c.chamar('GET', '/api/probe', undefined, { bearer: tokenConector() })).status, 403);
  assert.equal((await c.chamar('POST', '/api/auth/alterar-senha', { senha_atual: SENHA, senha_nova: 'NovaSenhaForte#9' }, { bearer: tokenConector() })).status, 403);
  assert.equal((await c.chamar('POST', '/api/auth/sair-de-todos', {}, { bearer: tokenConector() })).status, 403);
  // token da conta de serviço sem escopos (formato antigo) também não passa pelo apenasSessao
  const antigo = assinarAcesso({ id: ID.servico, email: CONTA_SERVICO_EMAIL, perfil: 'master' }, { expiresIn: '30d' });
  assert.equal((await c.chamar('POST', '/api/auth/alterar-senha', { senha_atual: SENHA, senha_nova: 'NovaSenhaForte#9' }, { bearer: antigo })).status, 403);
  assert.equal(banco.usuarios.get(ID.servico).sessao_versao, 0);
});

// ─────────────────────────── refresh ───────────────────────────

test('refresh: válido → cookies novos, linha anterior marcada como usada, nova linha na MESMA família', async () => {
  const { c } = await logar();
  const antes = { ...c.jar };
  const famAntes = jwt.decode(antes.am_token).fam;
  const r = await c.chamar('POST', '/api/auth/refresh', {});
  assert.equal(r.status, 200);
  assert.notEqual(c.jar.am_refresh, antes.am_refresh);
  assert.equal(jwt.decode(c.jar.am_token).fam, famAntes);
  assert.equal(jwt.decode(c.jar.am_refresh).fam, famAntes);
  assert.equal(banco.sessoes.length, 2);
  assert.ok(banco.sessoes[0].usado_em, 'a linha antiga ficou "usada"');
  assert.equal(banco.sessoes[1].usado_em, null);
  assert.equal(banco.sessoes[1].familia, banco.sessoes[0].familia);
  assert.equal((await c.chamar('GET', '/api/probe')).status, 200);
});

test('refresh: perfil e campos são montados a partir do BANCO (rebaixado → token novo já vem como júnior)', async () => {
  const { c } = await logar('ana@exemplo.com');
  Object.assign(banco.usuarios.get(ID.master), { perfil: 'junior', pode_marcar_restrito: false, nome: 'Ana Renomeada' });
  invalidarSessao(ID.master);
  assert.equal((await c.chamar('POST', '/api/auth/refresh', {})).status, 200);
  const novo = jwt.decode(c.jar.am_token);
  assert.equal(novo.perfil, 'junior');
  assert.equal(novo.pode_marcar_restrito, false);
  assert.equal(novo.nome, 'Ana Renomeada');
  assert.equal(jwt.decode(c.jar.am_refresh).perfil, 'junior');
});

test('refresh: reuso depois de 60 s → 401, família INTEIRA revogada (inclusive o refresh mais novo)', async () => {
  const { c } = await logar();
  const antigo = c.jar.am_refresh;
  assert.equal((await c.chamar('POST', '/api/auth/refresh', {})).status, 200);
  const maisNovo = c.jar.am_refresh;
  banco.sessoes[0].usado_em = new Date(agora() - 120_000); // foi usado há 2 minutos

  const ladrao = cliente();
  ladrao.jar.am_refresh = antigo;
  const r = await ladrao.chamar('POST', '/api/auth/refresh', {});
  assert.equal(r.status, 401);
  assert.ok(banco.sessoes.every((s) => s.revogado_em), 'todas as linhas da família ficaram revogadas');
  assert.ok(r.setCookies.some((x) => x.startsWith('am_refresh=;')), 'cookies limpos');

  const legitimo = cliente();
  legitimo.jar.am_refresh = maisNovo;
  assert.equal((await legitimo.chamar('POST', '/api/auth/refresh', {})).status, 401, 'o refresh mais novo da família também caiu');
});

test('refresh: reuso dentro de 60 s (concorrência) → 200 e a família segue viva', async () => {
  const { c } = await logar();
  const antigo = c.jar.am_refresh;
  assert.equal((await c.chamar('POST', '/api/auth/refresh', {})).status, 200);
  const outra = cliente();
  outra.jar.am_refresh = antigo; // outra aba ainda com o cookie anterior
  assert.equal((await outra.chamar('POST', '/api/auth/refresh', {})).status, 200);
  assert.ok(banco.sessoes.every((s) => !s.revogado_em));
  assert.equal((await c.chamar('POST', '/api/auth/refresh', {})).status, 200);
});

test('refresh: 3 pedidos em paralelo com o mesmo cookie → todos 200, cada um com sessão utilizável', async () => {
  const { c } = await logar();
  const cookie = c.jar.am_refresh;
  const clientes = [cliente(), cliente(), cliente()];
  clientes.forEach((x) => { x.jar.am_refresh = cookie; });
  const respostas = await Promise.all(clientes.map((x) => x.chamar('POST', '/api/auth/refresh', {})));
  assert.deepEqual(respostas.map((r) => r.status), [200, 200, 200]);
  for (const x of clientes) assert.equal((await x.chamar('GET', '/api/probe')).status, 200);
  const familias = new Set(banco.sessoes.map((s) => s.familia));
  assert.equal(familias.size, 1, 'todos continuam na mesma família');
  assert.ok(banco.sessoes.every((s) => !s.revogado_em));
  // e qualquer um dos refresh novos ainda renova
  assert.equal((await clientes[1].chamar('POST', '/api/auth/refresh', {})).status, 200);
});

test('refresh: sem cookie → 400; lixo → 401 com cookies limpos', async () => {
  const c = cliente();
  assert.equal((await c.chamar('POST', '/api/auth/refresh', {})).status, 400);
  c.jar.am_refresh = 'lixo.invalido.token';
  const r = await c.chamar('POST', '/api/auth/refresh', {});
  assert.equal(r.status, 401);
  assert.ok(r.setCookies.length >= 1);
  // access token no lugar do refresh (segredo diferente) → 401
  const c2 = cliente();
  c2.jar.am_refresh = assinarAcesso({ id: ID.master, perfil: 'master', sv: 0 });
  assert.equal((await c2.chamar('POST', '/api/auth/refresh', {})).status, 401);
});

test('refresh: conta desativada → 401 (e a sessão não volta na reativação)', async () => {
  const { c } = await logar();
  const refreshOriginal = c.jar.am_refresh;
  banco.usuarios.get(ID.master).ativo = false;
  assert.equal((await c.chamar('POST', '/api/auth/refresh', {})).status, 401);
  banco.usuarios.get(ID.master).ativo = true;
  // o Master reativa pela tela: PATCH /api/usuarios sobe a versão; aqui simulamos o resultado dela
  banco.usuarios.get(ID.master).sessao_versao = 1;
  invalidarSessao(ID.master);
  const c2 = cliente();
  c2.jar.am_refresh = refreshOriginal;
  assert.equal((await c2.chamar('POST', '/api/auth/refresh', {})).status, 401, 'versão mudou: o refresh antigo não ressuscita');
});

test('refresh: versão de sessão diferente → 401', async () => {
  const { c } = await logar();
  banco.usuarios.get(ID.master).sessao_versao = 3;
  invalidarSessao(ID.master);
  assert.equal((await c.chamar('POST', '/api/auth/refresh', {})).status, 401);
});

test('refresh: banco fora → 503 e os cookies NÃO são limpos (429/503 nunca deslogam); depois volta ao normal', async () => {
  const { c } = await logar();
  const refresh = c.jar.am_refresh;
  banco.fora = true;
  const r = await c.chamar('POST', '/api/auth/refresh', {});
  assert.equal(r.status, 503);
  assert.equal(r.setCookies.length, 0, 'nenhum Set-Cookie: nada de limpar a sessão');
  assert.equal(c.jar.am_refresh, refresh);
  banco.fora = false;
  assert.equal((await c.chamar('POST', '/api/auth/refresh', {})).status, 200, 'o mesmo refresh ainda serve');
});

test('refresh: validade ABSOLUTA de 30 dias por família (DN-3) — vencida a família, 401 mesmo com refresh novo', async () => {
  const { c } = await logar();
  const familiaExpira = new Date(banco.sessoes[0].familia_expira_em).getTime();
  const dias = (familiaExpira - agora()) / 86_400_000;
  assert.ok(dias > 29.9 && dias <= 30.01, `família vale 30 dias (deu ${dias})`);

  // perto do fim, o refresh novo NÃO passa da data absoluta
  banco.sessoes.forEach((s) => { s.familia_expira_em = new Date(agora() + 2 * 86_400_000); });
  assert.equal((await c.chamar('POST', '/api/auth/refresh', {})).status, 200);
  const limite = new Date(banco.sessoes[0].familia_expira_em).getTime() / 1000;
  assert.ok(jwt.decode(c.jar.am_refresh).exp <= limite + 1, 'o refresh novo respeita o teto absoluto');
  assert.ok(new Date(banco.sessoes.at(-1).expira_em).getTime() / 1000 <= limite + 1);

  // vencida a família: nem o refresh mais novo renova
  banco.sessoes.forEach((s) => { s.familia_expira_em = new Date(agora() - 1000); });
  assert.equal((await c.chamar('POST', '/api/auth/refresh', {})).status, 401);
});

test('refresh: linha vencida ou revogada → 401', async () => {
  const { c } = await logar();
  banco.sessoes[0].expira_em = new Date(agora() - 1000);
  assert.equal((await c.chamar('POST', '/api/auth/refresh', {})).status, 401);
  const { c: c2 } = await logar();
  banco.sessoes.find((s) => s.token_hash && !s.revogado_em && !(s.expira_em < new Date())).revogado_em = new Date();
  assert.equal((await c2.chamar('POST', '/api/auth/refresh', {})).status, 401);
});

test('refresh: apaga só as linhas vencidas há mais de 1 dia DO MESMO usuário', async () => {
  const { c } = await logar();
  banco.sessoes.push(
    { id: 'x1', usuario_id: ID.master, familia: 'f1', token_hash: 'h1', criado_em: new Date(), expira_em: new Date(agora() - 2 * 86_400_000), familia_expira_em: new Date(), usado_em: null, revogado_em: null },
    { id: 'x2', usuario_id: ID.master, familia: 'f2', token_hash: 'h2', criado_em: new Date(), expira_em: new Date(agora() - 3_600_000), familia_expira_em: new Date(), usado_em: null, revogado_em: null },
    { id: 'x3', usuario_id: ID.master2, familia: 'f3', token_hash: 'h3', criado_em: new Date(), expira_em: new Date(agora() - 5 * 86_400_000), familia_expira_em: new Date(), usado_em: null, revogado_em: null },
  );
  assert.equal((await c.chamar('POST', '/api/auth/refresh', {})).status, 200);
  await new Promise((r) => setTimeout(r, 30)); // a limpeza não atrasa a resposta
  const ids = banco.sessoes.map((s) => s.id);
  assert.ok(!ids.includes('x1'), 'vencida há 2 dias, do mesmo usuário → apagada');
  assert.ok(ids.includes('x2'), 'vencida há 1 hora → fica');
  assert.ok(ids.includes('x3'), 'de outro usuário → fica');
});

// ─────────────────────────── compatibilidade (D-S1) ───────────────────────────

test('COMPAT backend novo × frontend antigo: sessão aberta ANTES do deploy (acesso e refresh sem sv/rid/fam) continua valendo', async () => {
  const ana = banco.usuarios.get(ID.master);
  const acessoAntigo = TOKEN_ANTIGO_DA_ANA();
  const c = cliente();
  c.jar.am_token = acessoAntigo;
  c.jar.am_refresh = assinarRefreshAntigo(ana);
  assert.equal((await c.chamar('GET', '/api/probe')).status, 200, 'acesso antigo vale');

  // o frontend antigo, ao expirar o acesso, chama /refresh (em paralelo, uma vez por requisição que recebeu 401)
  const antigos = [cliente(), cliente(), cliente()];
  const legado = c.jar.am_refresh;
  antigos.forEach((x) => { x.jar.am_refresh = legado; });
  const respostas = await Promise.all(antigos.map((x) => x.chamar('POST', '/api/auth/refresh', {})));
  assert.deepEqual(respostas.map((r) => r.status), [200, 200, 200], 'refresh antigo em paralelo → todos 200');
  for (const x of antigos) {
    assert.equal((await x.chamar('GET', '/api/probe')).status, 200);
    const novo = jwt.decode(x.jar.am_token);
    assert.equal(novo.sv, 0);
    assert.ok(novo.fam, 'convertido para o formato novo');
    assert.ok(jwt.decode(x.jar.am_refresh).rid);
  }
  assert.equal(new Set(banco.sessoes.map((s) => s.familia)).size, 1, 'as 3 conversões caíram na mesma família');
  assert.equal(banco.sessoes.filter((s) => s.usado_em).length, 1, 'o refresh antigo virou UMA linha "usada"');
});

test('COMPAT: refresh antigo reusado depois de 60 s → 401 e família revogada (aceito uma vez, não para sempre)', async () => {
  const ana = banco.usuarios.get(ID.master);
  const legado = assinarRefreshAntigo(ana);
  const c = cliente();
  c.jar.am_refresh = legado;
  const primeira = await c.chamar('POST', '/api/auth/refresh', {});
  assert.equal(primeira.status, 200);
  const adotada = banco.sessoes.find((s) => s.usado_em);
  adotada.usado_em = new Date(agora() - 120_000);

  const ladrao = cliente();
  ladrao.jar.am_refresh = legado;
  assert.equal((await ladrao.chamar('POST', '/api/auth/refresh', {})).status, 401);
  assert.ok(banco.sessoes.every((s) => s.revogado_em));
  assert.equal((await c.chamar('POST', '/api/auth/refresh', {})).status, 401, 'o refresh convertido também caiu');
});

test('COMPAT: refresh antigo só vale com a conta ativa e na versão 0', async () => {
  const ana = banco.usuarios.get(ID.master);
  const legado = assinarRefreshAntigo(ana);

  banco.usuarios.get(ID.master).ativo = false;
  let c = cliente(); c.jar.am_refresh = legado;
  assert.equal((await c.chamar('POST', '/api/auth/refresh', {})).status, 401, 'inativa');
  assert.equal(banco.sessoes.length, 0);

  banco.usuarios.get(ID.master).ativo = true;
  banco.usuarios.get(ID.master).sessao_versao = 1;
  invalidarSessao(ID.master);
  c = cliente(); c.jar.am_refresh = legado;
  assert.equal((await c.chamar('POST', '/api/auth/refresh', {})).status, 401, 'versão 1: sessões antigas caíram');
  assert.equal(banco.sessoes.length, 0);
});

test('COMPAT backend novo × código antigo (rollback e nova publicação): refresh re-assinado pelo código antigo é aceito e mantém a família', async () => {
  const { c } = await logar();
  const famOriginal = jwt.decode(c.jar.am_token).fam;
  // o código anterior fazia exatamente isto no refresh: copiava o conteúdo (menos iat/exp) e assinava de novo
  const { iat, exp, ...conteudo } = jwt.decode(c.jar.am_refresh);
  const reassinado = jwt.sign(conteudo, REFRESH_SECRET, { expiresIn: '6d' });
  assert.notEqual(reassinado, c.jar.am_refresh);
  // o código antigo também aceitava o refresh novo (campos antigos preservados)
  assert.equal(conteudo.perfil, 'master');
  assert.equal(conteudo.id, ID.master);

  const depois = cliente();
  depois.jar.am_refresh = reassinado;
  const r = await depois.chamar('POST', '/api/auth/refresh', {});
  assert.equal(r.status, 200);
  assert.equal(jwt.decode(depois.jar.am_token).fam, famOriginal, 'continua na mesma família');

  // se a família foi revogada (ex.: logout) antes de voltar ao código novo, o re-assinado não ressuscita
  banco.sessoes.forEach((s) => { s.revogado_em = new Date(); });
  const outro = cliente();
  outro.jar.am_refresh = jwt.sign(conteudo, REFRESH_SECRET, { expiresIn: '5d' });
  assert.equal((await outro.chamar('POST', '/api/auth/refresh', {})).status, 401);
});

test('COMPAT: /me e login devolvem o formato que o frontend (antigo e novo) lê', async () => {
  const { c, r } = await logar();
  assert.equal(r.corpo.user.email, 'ana@exemplo.com');
  const me = await c.chamar('GET', '/api/auth/me');
  assert.equal(me.status, 200);
  assert.deepEqual(Object.keys(me.corpo.user).sort(), ['email', 'id', 'master_id', 'nome', 'perfil', 'pode_marcar_restrito']);
});

// ─────────────────────────── /me, logout, sair de todos ───────────────────────────

test('/me: devolve o perfil do banco e conta desativada → 401', async () => {
  const { c } = await logar('carla@exemplo.com');
  assert.equal((await c.chamar('GET', '/api/auth/me')).corpo.user.perfil, 'junior');
  banco.usuarios.get(ID.junior).ativo = false;
  invalidarSessao(ID.junior);
  assert.equal((await c.chamar('GET', '/api/auth/me')).status, 401);
});

test('logout: revoga só a família daquele navegador; a outra sessão da mesma conta segue', async () => {
  const { c: a } = await logar();
  const { c: b } = await logar();
  const refreshA = a.jar.am_refresh;
  const r = await a.chamar('POST', '/api/auth/logout', {});
  assert.equal(r.status, 200);
  assert.ok(banco.acoes().includes('logout'));
  const c = cliente(); c.jar.am_refresh = refreshA;
  assert.equal((await c.chamar('POST', '/api/auth/refresh', {})).status, 401, 'refresh da sessão encerrada morreu');
  assert.equal((await b.chamar('POST', '/api/auth/refresh', {})).status, 200, 'a outra sessão continua');
  assert.equal((await b.chamar('GET', '/api/probe')).status, 200);
});

test('logout com token do formato antigo (sem fam) → 200 e cookies limpos', async () => {
  const c = cliente(); c.jar.am_token = TOKEN_ANTIGO_DA_ANA();
  const r = await c.chamar('POST', '/api/auth/logout', {});
  assert.equal(r.status, 200);
  assert.ok(r.setCookies.some((x) => x.startsWith('am_token=;')));
});

test('sair de todos: token e refresh antigos → 401; conta segue ativa e entra de novo; auditado', async () => {
  const { c: a } = await logar();
  const { c: b } = await logar();
  const tokenA = a.jar.am_token;
  const refreshB = b.jar.am_refresh;
  const r = await a.chamar('POST', '/api/auth/sair-de-todos', {});
  assert.equal(r.status, 200);
  assert.equal(banco.usuarios.get(ID.master).sessao_versao, 1);
  assert.ok(banco.sessoes.every((s) => s.revogado_em));
  assert.ok(r.setCookies.some((x) => x.startsWith('am_token=;')));
  assert.ok(banco.acoes().includes('sair_de_todos'));

  const velho = cliente();
  assert.equal((await velho.chamar('GET', '/api/probe', undefined, { bearer: tokenA })).status, 401, 'token de acesso antigo');
  velho.jar.am_refresh = refreshB;
  assert.equal((await velho.chamar('POST', '/api/auth/refresh', {})).status, 401, 'refresh da outra sessão');
  assert.equal((await b.chamar('GET', '/api/probe')).status, 401, 'a outra sessão também caiu');

  const de_novo = await logar();
  assert.equal(de_novo.r.status, 200);
  assert.equal(jwt.decode(de_novo.c.jar.am_token).sv, 1);
  assert.equal((await de_novo.c.chamar('GET', '/api/probe')).status, 200);
});

test('sair de todos: exige sessão (sem login → 401)', async () => {
  assert.equal((await cliente().chamar('POST', '/api/auth/sair-de-todos', {})).status, 401);
});

// ─────────────────────────── alterar-senha (S-04) ───────────────────────────

test('alterar-senha: senha atual errada → 400 (NÃO 401) e nada muda', async () => {
  const { c } = await logar();
  const r = await c.chamar('POST', '/api/auth/alterar-senha', { senha_atual: 'errada-errada', senha_nova: 'NovaSenhaForte#9' });
  assert.equal(r.status, 400);
  assert.notEqual(r.status, 401);
  assert.equal(banco.usuarios.get(ID.master).sessao_versao, 0);
  assert.equal((await c.chamar('GET', '/api/probe')).status, 200, 'segue logado');
});

test('alterar-senha: validações (9 caracteres, igual à atual, campos ausentes, sem sessão)', async () => {
  const { c } = await logar();
  assert.equal((await c.chamar('POST', '/api/auth/alterar-senha', { senha_atual: SENHA, senha_nova: '123456789' })).status, 400);
  assert.equal((await c.chamar('POST', '/api/auth/alterar-senha', { senha_atual: SENHA, senha_nova: SENHA })).status, 400);
  assert.equal((await c.chamar('POST', '/api/auth/alterar-senha', { senha_atual: SENHA })).status, 400);
  assert.equal((await c.chamar('POST', '/api/auth/alterar-senha', { senha_atual: SENHA, senha_nova: 'x'.repeat(200) })).status, 400);
  assert.equal((await c.chamar('POST', '/api/auth/alterar-senha', { senha_atual: { a: 1 }, senha_nova: 'NovaSenhaForte#9' })).status, 400);
  assert.equal((await cliente().chamar('POST', '/api/auth/alterar-senha', { senha_atual: SENHA, senha_nova: 'NovaSenhaForte#9' })).status, 401);
  assert.equal(banco.usuarios.get(ID.master).sessao_versao, 0);
});

test('alterar-senha: sucesso → versão +1, a sessão atual continua (cookies novos), as outras caem, auditado sem senha', async () => {
  const { c: atual } = await logar();
  const { c: outro } = await logar();
  const nova = 'NovaSenhaForte#9';
  const antes = atual.jar.am_token;
  const r = await atual.chamar('POST', '/api/auth/alterar-senha', { senha_atual: SENHA, senha_nova: nova });
  assert.equal(r.status, 200);
  assert.equal(banco.usuarios.get(ID.master).sessao_versao, 1);
  assert.ok(await bcrypt.compare(nova, banco.usuarios.get(ID.master).senha_hash));
  assert.notEqual(atual.jar.am_token, antes, 'cookies novos para a sessão atual');
  assert.equal(jwt.decode(atual.jar.am_token).sv, 1);

  assert.equal((await atual.chamar('GET', '/api/probe')).status, 200, 'a sessão atual continua');
  assert.equal((await atual.chamar('POST', '/api/auth/refresh', {})).status, 200, 'e renova');
  assert.equal((await outro.chamar('GET', '/api/probe')).status, 401, 'a outra sessão caiu');
  assert.equal((await outro.chamar('POST', '/api/auth/refresh', {})).status, 401);

  assert.ok(banco.acoes().includes('alterar_senha'));
  assert.ok(!JSON.stringify(banco.logs).includes(nova) && !JSON.stringify(banco.logs).includes(SENHA));
  assert.equal((await logar('ana@exemplo.com', SENHA)).r.status, 401, 'a senha antiga não entra mais');
  assert.equal((await logar('ana@exemplo.com', nova)).r.status, 200);
});

// ─────────────────────────── usuários (derrubar sessões) ───────────────────────────

test('desativar pela tela: a sessão do alvo cai NA HORA (acesso e refresh) e volta a exigir login novo ao reativar', async () => {
  const { c: mestre } = await logar('ana@exemplo.com');
  const { c: alvo } = await logar('carla@exemplo.com');
  assert.equal((await alvo.chamar('GET', '/api/probe')).status, 200);
  const refreshDoAlvo = alvo.jar.am_refresh;

  const r = await mestre.chamar('PATCH', `/api/usuarios/${ID.junior}`, { ativo: false });
  assert.equal(r.status, 200);
  assert.equal((await alvo.chamar('GET', '/api/probe')).status, 401);
  assert.equal((await alvo.chamar('POST', '/api/auth/refresh', {})).status, 401);
  assert.ok(banco.sessoesDo(ID.junior).every((s) => s.revogado_em));

  await mestre.chamar('PATCH', `/api/usuarios/${ID.junior}`, { ativo: true });
  const velho = cliente(); velho.jar.am_refresh = refreshDoAlvo;
  assert.equal((await velho.chamar('POST', '/api/auth/refresh', {})).status, 401, 'reativar não ressuscita a sessão antiga');
  assert.equal((await logar('carla@exemplo.com')).r.status, 200, 'mas ela entra de novo normalmente');
});

test('trocar e-mail derruba as sessões; trocar só o nome NÃO', async () => {
  const { c: mestre } = await logar('ana@exemplo.com');
  const { c: alvo } = await logar('carla@exemplo.com');
  assert.equal((await mestre.chamar('PATCH', `/api/usuarios/${ID.junior}`, { nome: 'Carla Souza' })).status, 200);
  assert.equal((await alvo.chamar('GET', '/api/probe')).status, 200, 'só o nome mudou: segue logada');
  assert.equal(banco.usuarios.get(ID.junior).sessao_versao, 0);

  assert.equal((await mestre.chamar('PATCH', `/api/usuarios/${ID.junior}`, { email: 'carla.nova@exemplo.com' })).status, 200);
  assert.equal((await alvo.chamar('GET', '/api/probe')).status, 401);
  assert.equal(banco.usuarios.get(ID.junior).sessao_versao, 1);
});

test('redefinição por Master: vira provisória, sobe a versão, derruba as sessões, audita SEM o valor; exige 10 caracteres', async () => {
  const { c: mestre } = await logar('ana@exemplo.com');
  const { c: alvo } = await logar('carla@exemplo.com');
  const provisoria = 'ProvisoriaNova#77';

  assert.equal((await mestre.chamar('PATCH', `/api/usuarios/${ID.junior}/senha`, { senha: '123456789' })).status, 400);
  assert.equal(banco.usuarios.get(ID.junior).sessao_versao, 0);

  assert.equal((await mestre.chamar('PATCH', `/api/usuarios/${ID.junior}/senha`, { senha: provisoria })).status, 200);
  const carla = banco.usuarios.get(ID.junior);
  assert.equal(carla.senha_temporaria, true);
  assert.equal(carla.sessao_versao, 1);
  assert.equal((await alvo.chamar('GET', '/api/probe')).status, 401, 'a sessão aberta cai');
  const log = banco.logs.find((l) => l.acao === 'redefinir_senha');
  assert.ok(log && log.entidadeId === ID.junior && log.usuarioId === ID.master);
  assert.ok(!JSON.stringify(banco.logs).includes(provisoria));

  // o próximo login pede senha nova (primeiro acesso), sem abrir sessão
  const { r, c } = await logar('carla@exemplo.com', provisoria);
  assert.equal(r.corpo.primeiro_acesso, true);
  assert.equal(c.jar.am_token, undefined);
  // usuário inexistente → 404 e nada é gravado
  assert.equal((await mestre.chamar('PATCH', '/api/usuarios/99999999-9999-4999-8999-999999999999/senha', { senha: provisoria })).status, 404);
});

test('criar usuário: senha inicial com menos de 10 caracteres → 400; com 10 → 201 e provisória', async () => {
  const { c } = await logar('ana@exemplo.com');
  const corpo = { nome: 'Eva Nova', email: 'eva@exemplo.com', perfil: 'junior', master_id: ID.master };
  assert.equal((await c.chamar('POST', '/api/usuarios', { ...corpo, senha: '123456789' })).status, 400);
  assert.equal(banco.porEmail('eva@exemplo.com'), undefined);
  const ok = await c.chamar('POST', '/api/usuarios', { ...corpo, senha: '1234567890' });
  assert.equal(ok.status, 201);
  assert.equal(banco.porEmail('eva@exemplo.com').senha_temporaria, true);
});

test('excluir usuário: a sessão dele cai imediatamente (linhas de refresh vão junto)', async () => {
  const { c: mestre } = await logar('ana@exemplo.com');
  const { c: alvo } = await logar('carla@exemplo.com');
  assert.equal((await alvo.chamar('GET', '/api/probe')).status, 200);
  assert.equal((await mestre.chamar('DELETE', `/api/usuarios/${ID.junior}`)).status, 200);
  assert.equal((await alvo.chamar('GET', '/api/probe')).status, 401);
  assert.equal((await alvo.chamar('POST', '/api/auth/refresh', {})).status, 401);
});

// ─────────────────────────── migração e ligação no boot ───────────────────────────

test('migração S-03: idempotente (IF NOT EXISTS) e NÃO destrutiva; cria a versão de sessão e a tabela', async () => {
  const texto = SQL_MIGRACAO_SESSAO.join('\n');
  assert.match(texto, /ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS sessao_versao INTEGER NOT NULL DEFAULT 0/);
  assert.match(texto, /CREATE TABLE IF NOT EXISTS sessoes_refresh/);
  assert.match(texto, /token_hash\s+TEXT NOT NULL UNIQUE/);
  assert.match(texto, /familia_expira_em\s+TIMESTAMPTZ NOT NULL/);
  assert.match(texto, /ON DELETE CASCADE/);
  for (const sql of SQL_MIGRACAO_SESSAO) {
    assert.match(sql, /IF NOT EXISTS/, sql);
    assert.doesNotMatch(sql.replace(/ON DELETE CASCADE/g, ''), /\b(DROP|TRUNCATE|DELETE|UPDATE)\b/i, sql);
  }
  const executados = [];
  await migrarSessaoRevogavel(async (sql) => { executados.push(sql); });
  assert.deepEqual(executados, SQL_MIGRACAO_SESSAO);
});

test('migração S-03: registrada no boot SEM .catch (falha derruba o boot; /health segue 503) e limite do refresh em 120', () => {
  const fonte = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  const linha = fonte.split('\n').find((l) => l.includes("migrar('2026_10_S03_sessao_revogavel'"));
  assert.ok(linha, 'migração registrada em index.js');
  assert.ok(!linha.includes('.catch'), 'sem .catch que engula o erro');
  assert.match(fonte, /refreshLimiter = rateLimit\(\{[^}]*max: 120/s);
  assert.match(fonte, /app\.use\('\/api\/auth\/refresh',\s+refreshLimiter\)/);
  assert.match(fonte, /app\.use\('\/api\/auth\/alterar-senha',\s+authLimiter\)/);
});
