import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { criarOuBuscarContato } from './index.js';

// S-14: criarOuBuscarContato logava o telefone do cliente inteiro (número inválido, contato
// criado e corpo de erro do Digisac). Sem rede: axios.create devolve um dublê. Telefone fictício.
const TEL = '83912345678';
const TEL_COMPLETO = '5583912345678';

async function comAmbiente(apiFalsa, fn) {
  const guardado = {
    token: process.env.DIGISAC_TOKEN, url: process.env.DIGISAC_API_URL, servico: process.env.DIGISAC_SERVICE_ID,
    criar: axios.create,
  };
  process.env.DIGISAC_TOKEN = 'token-de-teste';
  process.env.DIGISAC_API_URL = 'https://digisac.invalid/api/v1';
  process.env.DIGISAC_SERVICE_ID = 'servico-teste';
  axios.create = () => apiFalsa;
  const linhas = [];
  const originais = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(originais)) console[k] = (...a) => linhas.push(a.map(String).join(' '));
  try {
    const resultado = await fn();
    return { resultado, log: linhas.join('\n') };
  } finally {
    Object.assign(console, originais);
    axios.create = guardado.criar;
    for (const [k, v] of [['DIGISAC_TOKEN', guardado.token], ['DIGISAC_API_URL', guardado.url], ['DIGISAC_SERVICE_ID', guardado.servico]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

test('número inválido: o aviso não traz o número digitado por inteiro', async () => {
  const { resultado, log } = await comAmbiente({}, () => criarOuBuscarContato('839123456', 'Cliente Fictício'));
  assert.equal(resultado, null);
  assert.match(log, /número inválido — \*\*\*\*-3456/);
  assert.ok(!log.includes('839123456'), 'telefone inteiro no log');
});

test('contato criado: o log mostra o telefone mascarado e o id do contato', async () => {
  const api = {
    async get() { return { data: { data: [] } }; },
    async post() { return { data: { id: 'contato-1' } }; },
  };
  const { resultado, log } = await comAmbiente(api, () => criarOuBuscarContato(TEL, 'Cliente Fictício'));
  assert.equal(resultado, 'contato-1');
  assert.match(log, /Contato criado para \+55 83 9\*\*\*\*-5678: contato-1/);
  assert.ok(!log.includes(TEL_COMPLETO) && !log.includes(TEL), 'telefone inteiro no log');
  assert.ok(!log.includes('Cliente Fictício'), 'nome do cliente no log');
});

test('erro do Digisac que devolve o telefone no corpo: o log sai sem o número', async () => {
  const api = {
    async get() { return { data: { data: [] } }; },
    async post() {
      const err = new Error('Request failed');
      err.response = { status: 422, data: { message: `número ${TEL_COMPLETO} inválido para o serviço`, number: TEL_COMPLETO } };
      throw err;
    },
  };
  const { resultado, log } = await comAmbiente(api, () => criarOuBuscarContato(TEL, 'Cliente Fictício'));
  assert.equal(resultado, null);
  assert.match(log, /Erro ao criar\/buscar contato: HTTP 422/);
  assert.ok(!log.includes(TEL_COMPLETO) && !log.includes(TEL), 'telefone inteiro no log de erro');
});
