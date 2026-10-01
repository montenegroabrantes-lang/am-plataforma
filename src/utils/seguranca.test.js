import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mesmaChave } from './seguranca.js';

// S-08 — comparação de chaves em tempo constante. Comportamento: igual só quando idêntica.

test('mesmaChave: chave idêntica confere', () => {
  assert.equal(mesmaChave('chave-de-teste-1234567890', 'chave-de-teste-1234567890'), true);
});

test('mesmaChave: chave errada, de mesmo tamanho ou de tamanho diferente, não confere', () => {
  const certa = 'chave-de-teste-1234567890';
  assert.equal(mesmaChave('chave-de-teste-1234567891', certa), false);            // 1 caractere diferente
  assert.equal(mesmaChave('Chave-de-teste-1234567890', certa), false);            // maiúscula
  assert.equal(mesmaChave('chave-de-teste', certa), false);                       // prefixo da certa
  assert.equal(mesmaChave(certa + 'x', certa), false);                            // certa + sobra
  assert.equal(mesmaChave('x', certa), false);
});

test('mesmaChave: ausente ou vazia nunca confere, nem contra outra ausente (servidor sem chave não aceita ninguém)', () => {
  for (const [recebida, esperada] of [[undefined, 'k'], ['k', undefined], [null, null], ['', ''], [undefined, undefined], ['', 'k'], ['k', '']]) {
    assert.equal(mesmaChave(recebida, esperada), false, `${recebida}/${esperada}`);
  }
});

test('mesmaChave: entradas que não são texto não derrubam', () => {
  assert.equal(mesmaChave(12345, '12345'), true);
  assert.equal(mesmaChave({}, 'k'), false);
});
