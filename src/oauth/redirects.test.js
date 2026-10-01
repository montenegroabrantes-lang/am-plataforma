// Lista de retornos permitidos do registro OAuth (S-07 + D-S2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerRedirectsPermitidos, redirectPermitido, fontesFormAction, hostDoRetorno } from './redirects.js';

const padrao = lerRedirectsPermitidos('');
const ok = (uri, lista = padrao) => redirectPermitido(uri, lista);

test('padrão: aceita os retornos do claude.ai e do claude.com (caminho exato, https)', () => {
  assert.equal(ok('https://claude.ai/api/mcp/auth_callback'), true);
  assert.equal(ok('https://claude.com/api/mcp/auth_callback'), true);
  assert.equal(ok('https://CLAUDE.AI/api/mcp/auth_callback'), true, 'host em maiúsculas é o mesmo host');
});

test('padrão: recusa host estranho, http, outra porta, outro caminho e disfarces por texto', () => {
  const recusados = [
    'https://exemplo.invalid/cb',
    'http://claude.ai/api/mcp/auth_callback',                       // http em claude.ai
    'https://claude.ai:8443/api/mcp/auth_callback',                 // outra porta
    'https://claude.ai/api/mcp/auth_callback/',                     // caminho diferente (barra final)
    'https://claude.ai/api/mcp/auth_callback/x',
    'https://claude.ai/outro',
    'https://claude.ai.exemplo.invalid/api/mcp/auth_callback',      // prefixo de texto casaria, host não
    'https://exemplo.invalid/?u=https://claude.ai/api/mcp/auth_callback',
    'https://claude.ai@exemplo.invalid/api/mcp/auth_callback',      // credencial na URL
    'https://claude.ai:senha@claude.ai/api/mcp/auth_callback',
    'https://claude.ai/api/mcp/auth_callback#fragmento',            // sem fragmento (RFC 6749)
    'https://claude.ai/api/mcp/auth_callback#',
    'https://claude.ai\\@exemplo.invalid/api/mcp/auth_callback',    // barra invertida: o parser a lê como "/"
    'https://sub.claude.ai/api/mcp/auth_callback',
    'javascript:alert(1)',
    'data:text/html,x',
    'ftp://claude.ai/api/mcp/auth_callback',
    '//claude.ai/api/mcp/auth_callback',
    '/api/mcp/auth_callback',
    '',
    'https://claude.ai/api/mcp/auth_callback\n@exemplo.invalid',    // controle: o parser o descartaria
    'https://claude.ai/api/mcp/ auth_callback',
  ];
  for (const uri of recusados) assert.equal(ok(uri), false, uri);
});

test('padrão: recusa o que não é texto e o que passa de 512 caracteres', () => {
  for (const v of [null, undefined, 42, {}, ['https://claude.ai/api/mcp/auth_callback'], true]) assert.equal(ok(v), false, String(v));
  const longo = `https://claude.ai/api/mcp/auth_callback?x=${'a'.repeat(600)}`;
  assert.equal(ok(longo), false);
});

test('D-S2: retorno local do Claude Code (localhost e 127.0.0.1, qualquer porta e caminho, só http)', () => {
  assert.equal(ok('http://localhost:53421/callback'), true);
  assert.equal(ok('http://127.0.0.1:8080/oauth/callback'), true);
  assert.equal(ok('http://localhost/callback'), true, 'sem porta');
  assert.equal(ok('https://localhost:53421/callback'), false, 'https local não está na lista');
  assert.equal(ok('http://localhost.exemplo.invalid:53421/callback'), false, 'sufixo de host não vale');
  assert.equal(ok('http://exemplo.invalid:53421/callback'), false);
  assert.equal(ok('http://localhost@exemplo.invalid:53421/callback'), false);
  assert.equal(ok('http://127.0.0.1.exemplo.invalid/cb'), false);
  assert.equal(ok('http://[::1]:53421/callback'), false, 'só os dois hosts locais do plano');
  assert.equal(ok('http://0.0.0.0:53421/callback'), false);
});

test('OAUTH_REDIRECTS_PERMITIDOS substitui o padrão (vírgula ou espaço); sem o local, o Claude Code fica de fora', () => {
  const soClaudeAi = lerRedirectsPermitidos('https://claude.ai/api/mcp/auth_callback');
  assert.equal(ok('https://claude.ai/api/mcp/auth_callback', soClaudeAi), true);
  assert.equal(ok('https://claude.com/api/mcp/auth_callback', soClaudeAi), false);
  assert.equal(ok('http://localhost:53421/callback', soClaudeAi), false);

  const novo = lerRedirectsPermitidos('https://claude.ai/api/mcp/auth_callback, https://app.exemplo.com/oauth/retorno http://localhost:*/callback');
  assert.equal(ok('https://app.exemplo.com/oauth/retorno', novo), true);
  assert.equal(ok('https://app.exemplo.com/oauth/outro', novo), false);
  assert.equal(ok('http://localhost:9999/callback', novo), true);
  assert.equal(ok('http://localhost:9999/outro', novo), false, 'com caminho na lista, só aquele caminho');
});

test('itens inválidos da variável são ignorados; variável só com lixo volta ao padrão', () => {
  const silencio = console.warn;
  console.warn = () => {};
  try {
    const mista = lerRedirectsPermitidos('http://exemplo.com/cb, nao-e-url, https://claude.ai/api/mcp/auth_callback');
    assert.equal(ok('http://exemplo.com/cb', mista), false, 'http fora do local é ignorado');
    assert.equal(ok('https://claude.ai/api/mcp/auth_callback', mista), true);
    const lixo = lerRedirectsPermitidos('nao-e-url http://exemplo.com/cb');
    assert.equal(ok('https://claude.ai/api/mcp/auth_callback', lixo), true, 'voltou ao padrão');
  } finally {
    console.warn = silencio;
  }
});

test('fontesFormAction: origens dos retornos para a CSP (sem caminho, sem repetição)', () => {
  assert.deepEqual(fontesFormAction(padrao), ['https://claude.ai', 'https://claude.com', 'http://localhost:*', 'http://127.0.0.1:*']);
  const custom = lerRedirectsPermitidos('https://claude.ai/a https://claude.ai/b');
  assert.deepEqual(fontesFormAction(custom), ['https://claude.ai']);
});

test('hostDoRetorno: host (com porta) para mostrar ao Master; vazio se não for URL', () => {
  assert.equal(hostDoRetorno('https://claude.ai/api/mcp/auth_callback'), 'claude.ai');
  assert.equal(hostDoRetorno('http://localhost:53421/callback'), 'localhost:53421');
  assert.equal(hostDoRetorno('lixo'), '');
});
