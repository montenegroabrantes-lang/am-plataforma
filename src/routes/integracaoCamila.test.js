import test from 'node:test';
import assert from 'node:assert/strict';
import { autenticarIntegracaoCamila } from './integracaoCamila.js';

function respostaFake() {
  return {
    statusCode: 200,
    body: null,
    status(codigo) { this.statusCode = codigo; return this; },
    json(corpo) { this.body = corpo; return this; },
  };
}

test('integração da Camila exige a chave compartilhada', () => {
  const anterior = process.env.CAMILA_CLIENT_LOOKUP_API_KEY;
  process.env.CAMILA_CLIENT_LOOKUP_API_KEY = 'chave-teste';
  try {
    const negada = respostaFake();
    let nextChamado = false;
    autenticarIntegracaoCamila({ get: () => 'incorreta' }, negada, () => { nextChamado = true; });
    assert.equal(negada.statusCode, 401);
    assert.equal(nextChamado, false);

    const permitida = respostaFake();
    autenticarIntegracaoCamila({ get: () => 'chave-teste' }, permitida, () => { nextChamado = true; });
    assert.equal(nextChamado, true);
    assert.equal(permitida.body, null);
  } finally {
    if (anterior === undefined) delete process.env.CAMILA_CLIENT_LOOKUP_API_KEY;
    else process.env.CAMILA_CLIENT_LOOKUP_API_KEY = anterior;
  }
});
