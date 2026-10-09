import test from 'node:test';
import assert from 'node:assert/strict';
import { valorOpcional } from './valorOpcional.js';

test('valorOpcional: vazio vira null; formatos brasileiros e numéricos são aceitos', () => {
  assert.equal(valorOpcional(undefined), null);
  assert.equal(valorOpcional(''), null);
  assert.equal(valorOpcional(null), null);
  assert.equal(valorOpcional('9.565,98'), 9565.98);
  assert.equal(valorOpcional('9565.98'), 9565.98);
  assert.equal(valorOpcional(9565.98), 9565.98);
  assert.equal(valorOpcional('1.320,00'), 1320);
});

test('valorOpcional: recusa lixo, zero, negativo e valor absurdo (vírgula/ponto trocados)', () => {
  assert.equal(valorOpcional('abc'), false);
  assert.equal(valorOpcional(0), false);
  assert.equal(valorOpcional('-5'), false);
  assert.equal(valorOpcional(956598000), false);
});
