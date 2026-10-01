import test from 'node:test';
import assert from 'node:assert/strict';
import { parseValorBR, valorDaCausaDoCorpo } from './valorBR.js';

test('parseValorBR: pt-BR, ponto decimal e milhar', () => {
  const casos = [['812,35', 812.35], ['812.35', 812.35], ['1.234,56', 1234.56], ['81.235', 81235], ['8.123', 8123], ['812.3', 812.3],
    ['R$ 812,35', 812.35], [' 6.118,03 ', 6118.03], ['1.234.567', 1234567], ['0,5', 0.5], ['800', 800]];
  for (const [texto, esperado] of casos) assert.equal(parseValorBR(texto), esperado, texto);
});

test('parseValorBR: lixo vira 0 (quem chama recusa)', () => {
  for (const v of ['abc', '', null, undefined, '1.2.3', '12,3,4', '--5', '1e5', '0x10', '1e3', 'Infinity', '-812,35']) assert.equal(parseValorBR(v), 0, String(v));
});

test('valorDaCausaDoCorpo: número e texto passam; outros tipos são inválidos', () => {
  assert.equal(valorDaCausaDoCorpo(812.35), 812.35);
  assert.equal(valorDaCausaDoCorpo('812,35'), 812.35);
  for (const v of [true, false, null, undefined, {}, [], [812]]) assert.ok(Number.isNaN(valorDaCausaDoCorpo(v)), String(v));
});
