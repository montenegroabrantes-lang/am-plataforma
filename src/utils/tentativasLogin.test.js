// Contadores de senha errada (S-02): e-mail + IP, teto por e-mail e devolução dos acertos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarTentativasLogin, normalizarEmailTentado, limitesPorIpAtivos } from './tentativasLogin.js';

const MIN = 60 * 1000;

function relogio(inicio = 1_000_000) {
  let t = inicio;
  return { agora: () => t, avancar: (ms) => { t += ms; } };
}

// Simula uma tentativa que termina em falha de credencial (não desfaz).
const falhar = (c, email, ip, opcoes) => c.iniciar(email, ip, opcoes);

test('normalizarEmailTentado: minúsculo, sem espaços nas pontas, no máximo 254 caracteres, sempre string', () => {
  assert.equal(normalizarEmailTentado('  Fulano@Exemplo.COM '), 'fulano@exemplo.com');
  assert.equal(normalizarEmailTentado(undefined), '');
  assert.equal(normalizarEmailTentado(null), '');
  assert.equal(normalizarEmailTentado({}), '[object object]');
  assert.equal(normalizarEmailTentado('a'.repeat(400)).length, 254);
});

test('e-mail + IP: a 11ª tentativa do mesmo e-mail no mesmo IP é bloqueada; a 10ª ainda passa', () => {
  const c = criarTentativasLogin();
  for (let i = 0; i < 10; i++) assert.equal(falhar(c, 'a@x.com', '203.0.113.1').bloqueio, null, `tentativa ${i + 1}`);
  const t = falhar(c, 'a@x.com', '203.0.113.1');
  assert.equal(t.bloqueio, 'email_ip');
  assert.ok(t.retryAposMs > 0 && t.retryAposMs <= 15 * MIN);
});

test('e-mail + IP: outro IP ou outro e-mail não são afetados (ninguém de fora tranca o Master)', () => {
  const c = criarTentativasLogin();
  for (let i = 0; i < 30; i++) falhar(c, 'master@x.com', `198.51.100.${i}`); // 30 IPs diferentes, 1 falha cada
  assert.equal(c.iniciar('master@x.com', '203.0.113.50').bloqueio, null, 'IP novo continua livre');
  for (let i = 0; i < 10; i++) falhar(c, 'master@x.com', '203.0.113.1');
  assert.equal(c.iniciar('master@x.com', '203.0.113.1').bloqueio, 'email_ip');
  assert.equal(c.iniciar('outro@x.com', '203.0.113.1').bloqueio, null, 'outro e-mail no mesmo IP');
  assert.equal(c.iniciar('master@x.com', '203.0.113.2').bloqueio, null, 'mesmo e-mail em outro IP');
});

test('e-mail + IP: maiúsculas e espaços não escapam do contador', () => {
  const c = criarTentativasLogin();
  for (let i = 0; i < 10; i++) falhar(c, i % 2 ? '  A@X.com' : 'a@x.COM ', '203.0.113.1');
  assert.equal(c.iniciar('a@x.com', '203.0.113.1').bloqueio, 'email_ip');
});

test('acertos não consomem o limite (desfazer), mas falhas consomem', () => {
  const c = criarTentativasLogin();
  for (let i = 0; i < 9; i++) falhar(c, 'a@x.com', '203.0.113.1');
  for (let i = 0; i < 40; i++) c.iniciar('a@x.com', '203.0.113.1').desfazer(); // 40 logins certos
  assert.equal(c.iniciar('a@x.com', '203.0.113.1').bloqueio, null, 'a 10ª falha ainda passa');
  assert.equal(c.iniciar('a@x.com', '203.0.113.1').bloqueio, 'email_ip', 'a 11ª não');
});

test('rajada em paralelo: tentativas em andamento já contam (não dá para escapar com 50 ao mesmo tempo)', () => {
  const c = criarTentativasLogin();
  const resultados = Array.from({ length: 50 }, () => c.iniciar('a@x.com', '203.0.113.1').bloqueio);
  assert.equal(resultados.filter(b => b === null).length, 10);
  assert.equal(resultados.filter(b => b === 'email_ip').length, 40);
});

test('a janela de 15 minutos expira e o bloqueio some', () => {
  const r = relogio();
  const c = criarTentativasLogin({ agora: r.agora });
  for (let i = 0; i < 10; i++) falhar(c, 'a@x.com', '203.0.113.1');
  assert.equal(c.iniciar('a@x.com', '203.0.113.1').bloqueio, 'email_ip');
  r.avancar(14 * MIN);
  assert.equal(c.iniciar('a@x.com', '203.0.113.1').bloqueio, 'email_ip', 'aos 14 min ainda bloqueado');
  r.avancar(2 * MIN);
  assert.equal(c.iniciar('a@x.com', '203.0.113.1').bloqueio, null, 'aos 16 min liberado');
});

test('teto por e-mail: 50 falhas em 1 hora, de qualquer IP, bloqueiam só quando o chamador pede o teto', () => {
  const c = criarTentativasLogin();
  for (let i = 0; i < 50; i++) falhar(c, 'master@x.com', `198.51.100.${i}`); // 1 falha por IP
  // login do AM (sem teto): nunca bloqueado por ele
  assert.equal(c.iniciar('master@x.com', '203.0.113.77').bloqueio, null);
  // OAuth (com teto): bloqueado, com aviso só na primeira vez da janela
  const a = c.iniciar('master@x.com', '203.0.113.78', { comTeto: true });
  assert.equal(a.bloqueio, 'email');
  assert.equal(a.primeiroAviso, true);
  assert.ok(a.retryAposMs > 0 && a.retryAposMs <= 60 * MIN);
  const b = c.iniciar('master@x.com', '203.0.113.79', { comTeto: true });
  assert.equal(b.bloqueio, 'email');
  assert.equal(b.primeiroAviso, false, 'não repete o aviso na mesma janela');
  // outro e-mail não é afetado
  assert.equal(c.iniciar('outro@x.com', '203.0.113.78', { comTeto: true }).bloqueio, null);
});

test('teto por e-mail: 49 falhas ainda deixam passar; o teto zera depois de 1 hora', () => {
  const r = relogio();
  const c = criarTentativasLogin({ agora: r.agora });
  for (let i = 0; i < 49; i++) falhar(c, 'master@x.com', `198.51.100.${i}`);
  assert.equal(c.iniciar('master@x.com', '203.0.113.5', { comTeto: true }).bloqueio, null); // a 50ª
  assert.equal(c.iniciar('master@x.com', '203.0.113.6', { comTeto: true }).bloqueio, 'email'); // a 51ª
  r.avancar(61 * MIN);
  assert.equal(c.iniciar('master@x.com', '203.0.113.6', { comTeto: true }).bloqueio, null);
});

test('porIp:false ignora e-mail + IP (IP não confiável), mas o teto por e-mail continua valendo', () => {
  const c = criarTentativasLogin();
  for (let i = 0; i < 49; i++) assert.equal(falhar(c, 'a@x.com', '10.0.0.1', { porIp: false, comTeto: true }).bloqueio, null);
  assert.equal(falhar(c, 'a@x.com', '10.0.0.1', { porIp: false, comTeto: true }).bloqueio, null); // 50ª
  assert.equal(falhar(c, 'a@x.com', '10.0.0.1', { porIp: false, comTeto: true }).bloqueio, 'email'); // 51ª
});

test('e-mail vazio ou ausente não conta nem bloqueia', () => {
  const c = criarTentativasLogin();
  for (let i = 0; i < 100; i++) assert.equal(c.iniciar('', '203.0.113.1', { comTeto: true }).bloqueio, null);
  assert.equal(c.iniciar(undefined, '203.0.113.1').bloqueio, null);
});

test('IPv6: endereços do mesmo bloco /56 dividem o contador; IPv4 mapeado vale como IPv4', () => {
  const c = criarTentativasLogin();
  const ip = (n) => `2001:db8:abcd:00${n.toString(16).padStart(2, '0')}::${n + 1}`; // mesmo /56, endereços diferentes
  for (let i = 0; i < 10; i++) falhar(c, 'a@x.com', ip(i));
  assert.equal(c.iniciar('a@x.com', ip(0x55)).bloqueio, 'email_ip', 'outro endereço do mesmo bloco continua bloqueado');
  assert.equal(c.iniciar('a@x.com', '2001:db8:ffff:0000::1').bloqueio, null, 'outro bloco /56 está livre');

  const d = criarTentativasLogin();
  for (let i = 0; i < 10; i++) falhar(d, 'a@x.com', '198.51.100.7');
  assert.equal(d.iniciar('a@x.com', '::ffff:198.51.100.7').bloqueio, 'email_ip');
});

test('memória limitada: passando de 5000 chaves, as mais antigas saem (o processo não cresce sem fim)', () => {
  const c = criarTentativasLogin();
  for (let i = 0; i < 10; i++) falhar(c, 'primeiro@x.com', '203.0.113.1');
  assert.equal(c.iniciar('primeiro@x.com', '203.0.113.1').bloqueio, 'email_ip');
  for (let i = 0; i < 5100; i++) falhar(c, `lixo${i}@x.com`, '203.0.113.9');
  assert.equal(c.iniciar('primeiro@x.com', '203.0.113.1').bloqueio, null, 'a chave mais antiga foi descartada');
});

test('limitesPorIpAtivos: ligado por padrão; LIMITES_POR_IP=desligado desliga', () => {
  const antes = process.env.LIMITES_POR_IP;
  try {
    delete process.env.LIMITES_POR_IP;
    assert.equal(limitesPorIpAtivos(), true);
    process.env.LIMITES_POR_IP = 'Desligado';
    assert.equal(limitesPorIpAtivos(), false);
    process.env.LIMITES_POR_IP = 'ligado';
    assert.equal(limitesPorIpAtivos(), true);
  } finally {
    if (antes === undefined) delete process.env.LIMITES_POR_IP; else process.env.LIMITES_POR_IP = antes;
  }
});
