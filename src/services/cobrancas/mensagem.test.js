import test from 'node:test';
import assert from 'node:assert/strict';
import { montarMensagemCobranca, formatarReais, prontaParaCobrar, valorCobrancaValido } from './mensagem.js';

test('montarMensagemCobranca: nome, processo, valor e Pix do favorecido', () => {
  const t = montarMensagemCobranca({
    clienteNome: 'JOSEANE DIAS SANTOS VIANA', tipo: 'contador', valor: 750,
    beneficiarioNome: 'Raimunda Alves de Oliveira', chavePix: '000.000.000-00', numeroProcesso: '0809017-10.2024.8.15.2001',
  });
  assert.match(t, /^Olá, Joseane! Tudo bem\?/);
  assert.match(t, /processo 0809017-10\.2024\.8\.15\.2001/);
  assert.match(t, /contador judicial, no valor de R\$\s750,00/);
  assert.match(t, /Favorecido: Raimunda Alves de Oliveira/);
  assert.match(t, /Chave: 000\.000\.000-00/);
});

test('montarMensagemCobranca: sem favorecido não inventa bloco de Pix', () => {
  const t = montarMensagemCobranca({ clienteNome: 'maria', tipo: 'perito', valor: 1320.5 });
  assert.doesNotMatch(t, /Pix/);
  assert.match(t, /perito, no valor de R\$\s1\.320,50/);
});

test('formatarReais e valorCobrancaValido: aceita vírgula brasileira e recusa absurdos', () => {
  assert.match(formatarReais(520), /R\$\s520,00/);
  assert.equal(valorCobrancaValido('1.320,00'), 1320);
  assert.equal(valorCobrancaValido(750), 750);
  assert.equal(valorCobrancaValido('0'), null);
  assert.equal(valorCobrancaValido(-5), null);
  assert.equal(valorCobrancaValido('abc'), null);
  assert.equal(valorCobrancaValido(2_000_000), null);
});

test('prontaParaCobrar: RPV paga ou precatório disponibilizado', () => {
  assert.equal(prontaParaCobrar({ status_rpv: 'paga' }), true);
  assert.equal(prontaParaCobrar({ status_precatorio: 'pagamento_disponibilizado' }), true);
  assert.equal(prontaParaCobrar({ status_rpv: 'expedida' }), false);
});
