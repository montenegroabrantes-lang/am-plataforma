import test from 'node:test';
import assert from 'node:assert/strict';
import { vinculoUnicoAtivo } from './vinculos.js';

function dbFalso(linhas) {
  return { query: async () => linhas };
}

test('sem cliente retorna null', async () => {
  assert.equal(await vinculoUnicoAtivo(null), null);
});

test('cliente com exatamente 1 vínculo ativo retorna esse vínculo', async () => {
  const vinculo = { id: 'v1', polo_passivo: 'Estado da Paraíba' };
  const resultado = await vinculoUnicoAtivo('c1', dbFalso([vinculo]));
  assert.deepEqual(resultado, vinculo);
});

test('cliente sem vínculo ativo não escolhe nada', async () => {
  const resultado = await vinculoUnicoAtivo('c1', dbFalso([]));
  assert.equal(resultado, null);
});

test('cliente com 2+ vínculos ativos não escolhe um polo arbitrário', async () => {
  const resultado = await vinculoUnicoAtivo('c1', dbFalso([
    { id: 'v1', polo_passivo: 'Estado da Paraíba' },
    { id: 'v2', polo_passivo: 'Município de João Pessoa' },
  ]));
  assert.equal(resultado, null);
});
