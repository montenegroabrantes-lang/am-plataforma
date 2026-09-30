import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { google } from 'googleapis';
import { ESCOPOS_GOOGLE, escoposFaltando } from './escopos.js';
import { verificarTokenGoogle, montarAlertaGoogle, codigoErroGoogle, notificarMasters } from './verificarToken.js';

// Nada aqui usa rede, banco ou o Google de verdade: OAuth, notificação e registro são dublês.
const DRIVE = 'https://www.googleapis.com/auth/drive';
const CALENDAR = 'https://www.googleapis.com/auth/calendar';
const ENV = { GOOGLE_CLIENT_ID: 'cliente-teste', GOOGLE_CLIENT_SECRET: 'segredo-teste', GOOGLE_REFRESH_TOKEN: 'refresh-teste' };

// Erro no formato do gaxios quando o Google responde 400 invalid_grant.
function erroGoogle(codigo, descricao = 'Token has been expired or revoked.') {
  return Object.assign(new Error(codigo), { response: { status: 400, data: { error: codigo, error_description: descricao } } });
}

// OAuth2 falso: getAccessToken renova (ou falha) e deixa `credentials.scope` como o Google deixaria.
function oauthFalso({ erro, scope, token = 'access-teste', tokenInfo } = {}) {
  const o = {
    credentials: {},
    async getAccessToken() {
      if (erro) throw erro;
      if (scope !== undefined) o.credentials.scope = scope;
      return { token };
    },
    async getTokenInfo() {
      if (tokenInfo instanceof Error) throw tokenInfo;
      return tokenInfo;
    },
  };
  return o;
}

function montar(oauth) {
  const notificacoes = [];
  const gravacoes = [];
  return {
    notificacoes,
    gravacoes,
    opcoes: {
      env: ENV,
      criarOAuth2: () => oauth,
      notificar: async (texto) => { notificacoes.push(texto); return { destinatarios: 2, entregues: 2 }; },
      registrar: async (r) => { gravacoes.push(r); },
    },
  };
}

async function silencioso(fn) {
  const originais = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = () => {};
  try { return await fn(); } finally { Object.assign(console, originais); }
}

test('escopos: pede Drive e Calendar, e NÃO pede Sheets', () => {
  assert.deepEqual([...ESCOPOS_GOOGLE].sort(), [CALENDAR, DRIVE].sort());
  assert.ok(!ESCOPOS_GOOGLE.some(e => /spreadsheets/.test(e)));
});

test('escoposFaltando: lista o que falta, na ordem da lista exigida', () => {
  assert.deepEqual(escoposFaltando([DRIVE, CALENDAR]), []);
  assert.deepEqual(escoposFaltando([CALENDAR, DRIVE, 'https://www.googleapis.com/auth/userinfo.email']), []);
  assert.deepEqual(escoposFaltando([DRIVE]), [CALENDAR]);
  assert.deepEqual(escoposFaltando([CALENDAR]), [DRIVE]);
  assert.deepEqual(escoposFaltando([]), [DRIVE, CALENDAR]);
  assert.deepEqual(escoposFaltando(null), [DRIVE, CALENDAR]);
});

test('script de reautorização pede a lista compartilhada (Drive + Calendar) e não fixa só o Drive', () => {
  const fonte = readFileSync(new URL('../../../obter-novo-refresh-token.mjs', import.meta.url), 'utf8');
  assert.match(fonte, /import \{[^}]*ESCOPOS_GOOGLE[^}]*\} from '\.\/src\/services\/google\/escopos\.js'/);
  assert.match(fonte, /scope:\s*ESCOPOS_GOOGLE/);
  assert.ok(!/scope:\s*\[/.test(fonte), 'o scope não pode voltar a ser uma lista fixa dentro do script');
  assert.ok(!/auth\/spreadsheets/.test(fonte), 'Sheets não é usado e não deve ser pedido');
});

test('token com invalid_grant → status invalid_grant, alerta enviado e resultado gravado', async () => {
  const { opcoes, notificacoes, gravacoes } = montar(oauthFalso({ erro: erroGoogle('invalid_grant') }));
  const r = await silencioso(() => verificarTokenGoogle(opcoes));

  assert.equal(r.status, 'invalid_grant');
  assert.equal(notificacoes.length, 1);
  assert.match(notificacoes[0], /invalid_grant/);
  assert.match(notificacoes[0], /obter-novo-refresh-token\.mjs/);
  assert.match(notificacoes[0], /GOOGLE_REFRESH_TOKEN/);
  assert.equal(r.entregues, 2);
  assert.equal(gravacoes.length, 1);
  assert.equal(gravacoes[0].status, 'invalid_grant');
});

test('invalid_grant reconhecido também só pela mensagem do erro (sem response)', async () => {
  const { opcoes, notificacoes } = montar(oauthFalso({ erro: new Error('invalid_grant') }));
  const r = await silencioso(() => verificarTokenGoogle(opcoes));
  assert.equal(r.status, 'invalid_grant');
  assert.equal(notificacoes.length, 1);
});

test('invalid_client (segredo trocado) e unauthorized_client também alertam como recusa da credencial', async () => {
  for (const codigo of ['invalid_client', 'unauthorized_client']) {
    const { opcoes, notificacoes } = montar(oauthFalso({ erro: erroGoogle(codigo, 'x') }));
    const r = await silencioso(() => verificarTokenGoogle(opcoes));
    assert.equal(r.status, codigo);
    assert.equal(notificacoes.length, 1);
    assert.match(notificacoes[0], new RegExp(codigo));
  }
});

test('token válido com Drive e Calendar → ok, NENHUM alerta, heartbeat com ultimo_ok', async () => {
  const { opcoes, notificacoes, gravacoes } = montar(oauthFalso({ scope: `${DRIVE} ${CALENDAR}` }));
  const r = await silencioso(() => verificarTokenGoogle(opcoes));

  assert.equal(r.status, 'ok');
  assert.equal(notificacoes.length, 0, 'token bom não pode gerar alerta');
  assert.equal(gravacoes[0].status, 'ok');
});

test('token válido mas SÓ com Drive (como o gerado em 21/09) → sem_escopo, alerta cita a Agenda', async () => {
  const { opcoes, notificacoes } = montar(oauthFalso({ scope: DRIVE }));
  const r = await silencioso(() => verificarTokenGoogle(opcoes));

  assert.equal(r.status, 'sem_escopo');
  assert.deepEqual(r.faltando, [CALENDAR]);
  assert.equal(notificacoes.length, 1);
  assert.match(notificacoes[0], /Agenda/);
  assert.ok(!/invalid_grant/.test(notificacoes[0]), 'não pode dizer que o token morreu');
});

test('escopo vem do tokeninfo quando a renovação não traz `scope`', async () => {
  const bom = montar(oauthFalso({ tokenInfo: { scopes: [DRIVE, CALENDAR] } }));
  assert.equal((await silencioso(() => verificarTokenGoogle(bom.opcoes))).status, 'ok');

  const incompleto = montar(oauthFalso({ tokenInfo: { scopes: [DRIVE] } }));
  const r = await silencioso(() => verificarTokenGoogle(incompleto.opcoes));
  assert.equal(r.status, 'sem_escopo');
  assert.equal(incompleto.notificacoes.length, 1);
});

test('escopo impossível de saber (sem `scope` e tokeninfo falhando) → ok, sem alarme falso', async () => {
  const { opcoes, notificacoes } = montar(oauthFalso({ tokenInfo: new Error('tokeninfo fora do ar') }));
  const r = await silencioso(() => verificarTokenGoogle(opcoes));
  assert.equal(r.status, 'ok');
  assert.equal(notificacoes.length, 0);
});

test('erro de rede/timeout → indeterminado: avisa, mas NÃO afirma que o token morreu', async () => {
  const erro = Object.assign(new Error('request to https://oauth2.googleapis.com/token failed, reason: getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
  const { opcoes, notificacoes, gravacoes } = montar(oauthFalso({ erro }));
  const r = await silencioso(() => verificarTokenGoogle(opcoes));

  assert.equal(r.status, 'indeterminado');
  assert.equal(notificacoes.length, 1);
  assert.match(notificacoes[0], /não foi possível testar/i);
  assert.ok(!/recusada/.test(notificacoes[0]) && !/invalid_grant/.test(notificacoes[0]));
  assert.equal(gravacoes[0].status, 'indeterminado');
});

test('erro 5xx do Google (sem código de credencial) também é indeterminado', async () => {
  const erro = Object.assign(new Error('Backend Error'), { response: { status: 503, data: { error: { code: 503, message: 'Backend Error' } } } });
  const { opcoes } = montar(oauthFalso({ erro }));
  assert.equal((await silencioso(() => verificarTokenGoogle(opcoes))).status, 'indeterminado');
});

test('variáveis ausentes ou placeholder → nao_configurado, alerta e nem tenta renovar', async () => {
  for (const env of [
    { ...ENV, GOOGLE_REFRESH_TOKEN: '' },
    { ...ENV, GOOGLE_REFRESH_TOKEN: 'configurar_no_railway' },
    { ...ENV, GOOGLE_CLIENT_ID: undefined },
    { ...ENV, GOOGLE_CLIENT_SECRET: undefined },
  ]) {
    const { opcoes, notificacoes } = montar(oauthFalso());
    let criou = false;
    const r = await silencioso(() => verificarTokenGoogle({ ...opcoes, env, criarOAuth2: () => { criou = true; return oauthFalso(); } }));
    assert.equal(r.status, 'nao_configurado');
    assert.equal(criou, false, 'sem credencial não há o que renovar');
    assert.equal(notificacoes.length, 1);
  }
});

test('access token vazio na resposta → indeterminado (não passa por "ok")', async () => {
  const { opcoes } = montar(oauthFalso({ token: null }));
  assert.equal((await silencioso(() => verificarTokenGoogle(opcoes))).status, 'indeterminado');
});

test('nunca lança: falha ao notificar ou ao gravar não derruba o job', async () => {
  const { opcoes } = montar(oauthFalso({ erro: erroGoogle('invalid_grant') }));
  const r = await silencioso(() => verificarTokenGoogle({
    ...opcoes,
    notificar: async () => { throw new Error('Digisac fora'); },
    registrar: async () => { throw new Error('banco fora'); },
  }));
  assert.equal(r.status, 'invalid_grant');
  assert.equal(r.entregues, 0);
});

test('nenhuma mensagem de alerta carrega segredo do ambiente', async () => {
  const casos = [
    oauthFalso({ erro: erroGoogle('invalid_grant') }),
    oauthFalso({ scope: DRIVE }),
    oauthFalso({ erro: new Error('falha qualquer') }),
  ];
  for (const oauth of casos) {
    const { opcoes, notificacoes } = montar(oauth);
    await silencioso(() => verificarTokenGoogle(opcoes));
    for (const texto of notificacoes) {
      for (const segredo of Object.values(ENV)) assert.ok(!texto.includes(segredo), `alerta vazou ${segredo}`);
    }
  }
});

test('montarAlertaGoogle: ok não gera texto; os demais estados geram', () => {
  assert.equal(montarAlertaGoogle({ status: 'ok' }), null);
  for (const status of ['invalid_grant', 'invalid_client', 'unauthorized_client', 'nao_configurado', 'indeterminado']) {
    assert.ok(montarAlertaGoogle({ status }), `esperava texto para ${status}`);
  }
  assert.match(montarAlertaGoogle({ status: 'sem_escopo', faltando: [DRIVE, CALENDAR] }), /Drive e Agenda/);
  assert.match(montarAlertaGoogle({ status: 'invalid_grant' }), /modo "Teste"/);
});

test('codigoErroGoogle: lê o código do corpo, da mensagem ou devolve null', () => {
  assert.equal(codigoErroGoogle(erroGoogle('invalid_grant')), 'invalid_grant');
  assert.equal(codigoErroGoogle(new Error('Invalid_Grant')), 'invalid_grant');
  assert.equal(codigoErroGoogle({ response: { data: { error: { code: 500 } } }, message: 'x' }), null);
  assert.equal(codigoErroGoogle(new Error('timeout')), null);
  assert.equal(codigoErroGoogle(undefined), null);
});

test('notificarMasters: só masters ativos com WhatsApp; conta as entregas; identifica origem e usuário', async () => {
  let sqlUsado = '';
  const banco = { async query(sql) { sqlUsado = sql; return [{ id: 'u1', whatsapp: '83900000001' }, { id: 'u2', whatsapp: '83900000002' }]; } };
  const enviadas = [];
  const enviar = async (numero, texto, opcoes) => { enviadas.push({ numero, texto, opcoes }); return { ok: numero.endsWith('1') }; };

  const r = await notificarMasters('texto do alerta', { banco, enviar });

  assert.match(sqlUsado, /perfil = 'master'/);
  assert.match(sqlUsado, /ativo = true/);
  assert.match(sqlUsado, /whatsapp IS NOT NULL/);
  assert.deepEqual(r, { destinatarios: 2, entregues: 1 });
  assert.deepEqual(enviadas.map(e => e.opcoes), [
    { origem: 'google_token', usuarioId: 'u1' },
    { origem: 'google_token', usuarioId: 'u2' },
  ]);
});

test('notificarMasters: consulta falhando ou sem destinatários devolve zero, sem lançar', async () => {
  const quebrado = { async query() { throw new Error('banco fora'); } };
  assert.deepEqual(await notificarMasters('x', { banco: quebrado, enviar: async () => ({ ok: true }) }), { destinatarios: 0, entregues: 0 });
  const vazio = { async query() { return []; } };
  assert.deepEqual(await notificarMasters('x', { banco: vazio, enviar: async () => ({ ok: true }) }), { destinatarios: 0, entregues: 0 });
});

// Com o cliente OAuth2 REAL da biblioteca do Google (só o transporte HTTP é simulado): garante
// que `credentials.scope` sai da renovação e que o formato de erro do Google é reconhecido.
function oauthRealComTransporte(request) {
  return (env) => {
    const o = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
    o.setCredentials({ refresh_token: env.GOOGLE_REFRESH_TOKEN });
    o.transporter = { request };
    return o;
  };
}

test('cliente OAuth2 real: escopo da renovação decide entre ok e sem_escopo', async () => {
  const renovacao = (scope) => async () => ({ data: { access_token: 'access-teste', expires_in: 3599, scope, token_type: 'Bearer' } });
  const completo = montar(null);
  const rOk = await silencioso(() => verificarTokenGoogle({ ...completo.opcoes, criarOAuth2: oauthRealComTransporte(renovacao(`${CALENDAR} ${DRIVE}`)) }));
  assert.equal(rOk.status, 'ok');
  assert.equal(completo.notificacoes.length, 0);

  const soDrive = montar(null);
  const rFalta = await silencioso(() => verificarTokenGoogle({ ...soDrive.opcoes, criarOAuth2: oauthRealComTransporte(renovacao(DRIVE)) }));
  assert.equal(rFalta.status, 'sem_escopo');
  assert.deepEqual(rFalta.faltando, [CALENDAR]);
});

test('cliente OAuth2 real: erro 400 invalid_grant do endpoint de token vira alerta', async () => {
  const { opcoes, notificacoes } = montar(null);
  const r = await silencioso(() => verificarTokenGoogle({
    ...opcoes,
    criarOAuth2: oauthRealComTransporte(async () => { throw erroGoogle('invalid_grant'); }),
  }));
  assert.equal(r.status, 'invalid_grant');
  assert.equal(notificacoes.length, 1);
});
