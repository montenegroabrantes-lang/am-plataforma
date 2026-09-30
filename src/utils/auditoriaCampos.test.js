import test from 'node:test';
import assert from 'node:assert/strict';
import { diferenca, idCurto, tamanhoDoTexto, resumirTelefone, resumirEmail, emailTentadoParaLog } from './auditoriaCampos.js';

// S-13 — o "antes e depois" do log traz só o que mudou.

test('diferenca: só os campos que mudaram, com antes e depois', () => {
  const r = diferenca({ vara: '1ª Vara', juiz: 'A', status: 'ativo' }, { vara: '2ª Vara', juiz: 'A' }, ['vara', 'juiz', 'status']);
  assert.deepEqual(r.antes, { vara: '1ª Vara' });
  assert.deepEqual(r.depois, { vara: '2ª Vara' });
  assert.equal(r.mudou, true);
});

test('diferenca: campo não enviado (undefined) não conta; nada mudou → mudou=false', () => {
  const r = diferenca({ vara: '1ª Vara', status: 'ativo' }, { vara: '1ª Vara' }, ['vara', 'status']);
  assert.deepEqual(r.depois, {});
  assert.equal(r.mudou, false);
});

test('diferenca: NUMERIC do banco ("812.35") e número do corpo (812.35) são o mesmo valor', () => {
  assert.equal(diferenca({ valor_causa: '812.35' }, { valor_causa: 812.35 }, ['valor_causa']).mudou, false);
  assert.equal(diferenca({ valor_causa: '812.30' }, { valor_causa: '812.3' }, ['valor_causa']).mudou, false);
  const r = diferenca({ valor_causa: '812.35' }, { valor_causa: 8123.5 }, ['valor_causa']);
  assert.equal(r.mudou, true);
  assert.deepEqual(r.antes, { valor_causa: '812.35' });
});

test('diferenca: vazio, nulo e string vazia são a mesma coisa; de vazio para valor conta', () => {
  assert.equal(diferenca({ juiz: null }, { juiz: '' }, ['juiz']).mudou, false);
  const r = diferenca({ juiz: null }, { juiz: 'Dr. Fulano' }, ['juiz']);
  assert.deepEqual(r.antes, { juiz: null });
  assert.deepEqual(r.depois, { juiz: 'Dr. Fulano' });
});

test('diferenca: booleanos e datas (string do banco x string do corpo)', () => {
  assert.equal(diferenca({ ativo: true }, { ativo: true }, ['ativo']).mudou, false);
  assert.equal(diferenca({ ativo: true }, { ativo: false }, ['ativo']).mudou, true);
  assert.equal(diferenca({ periodo_inicio: '2021-01-01' }, { periodo_inicio: '2021-01-01' }, ['periodo_inicio']).mudou, false);
  assert.equal(diferenca({ periodo_inicio: '2021-01-01' }, { periodo_inicio: '2021-02-01' }, ['periodo_inicio']).mudou, true);
});

test('diferenca: timestamptz do banco (Date) x texto ISO com fuso do corpo = mesmo instante', () => {
  const noBanco = new Date('2026-10-15T17:00:00.000Z');
  assert.equal(diferenca({ data_hora: noBanco }, { data_hora: '2026-10-15T14:00:00-03:00' }, ['data_hora']).mudou, false);
  const r = diferenca({ data_hora: noBanco }, { data_hora: '2026-10-16T14:00:00-03:00' }, ['data_hora']);
  assert.equal(r.mudou, true);
  assert.equal(r.antes.data_hora, '2026-10-15T17:00:00.000Z');
});

test('diferenca: ocultar (texto livre) grava só a marca "[alterado]", nunca o conteúdo', () => {
  const r = diferenca({ notas: 'segredo antigo' }, { notas: 'segredo novo' }, ['notas'], { ocultar: ['notas'] });
  assert.deepEqual(r.antes, { notas: '[alterado]' });
  assert.deepEqual(r.depois, { notas: '[alterado]' });
  assert.equal(JSON.stringify(r).includes('segredo'), false);
});

test('diferenca: resumir aplica a função aos dois lados (telefone e e-mail parciais)', () => {
  const r = diferenca(
    { whatsapp: '83999991234', email: 'maria@exemplo.invalid' },
    { whatsapp: '83988885678', email: 'maria@exemplo.invalid' },
    ['whatsapp', 'email'],
    { resumir: { whatsapp: resumirTelefone, email: resumirEmail } }
  );
  assert.deepEqual(r.antes, { whatsapp: '***1234' });
  assert.deepEqual(r.depois, { whatsapp: '***5678' });
});

test('diferenca: texto muito longo é truncado no log', () => {
  const r = diferenca({ acao: 'a' }, { acao: 'b'.repeat(1000) }, ['acao']);
  assert.ok(r.depois.acao.length <= 301);
});

test('idCurto, tamanhoDoTexto, resumirTelefone e resumirEmail', () => {
  assert.equal(idCurto('89e1802c-1234-4abc-8def-000000000001'), '89e1802c');
  assert.equal(idCurto(null), null);
  assert.equal(idCurto(''), null);
  assert.equal(tamanhoDoTexto('olá!'), 4);
  assert.equal(tamanhoDoTexto(undefined), 0);
  assert.equal(resumirTelefone('+55 (83) 99999-1234'), '***1234');
  assert.equal(resumirTelefone(''), null);
  assert.equal(resumirEmail('maria@exemplo.invalid'), 'm***@exemplo.invalid');
  assert.equal(resumirEmail('semarroba'), '***');
  assert.equal(resumirEmail(null), null);
});

test('emailTentadoParaLog: e-mail normalizado passa; qualquer outra coisa (senha digitada no campo) vira só a marca', () => {
  assert.equal(emailTentadoParaLog('  Alguem@Exemplo.INVALID '), 'alguem@exemplo.invalid');
  assert.equal(emailTentadoParaLog('SenhaSecreta#2026'), '[fora do formato de e-mail]');
  assert.equal(emailTentadoParaLog('ab cd@x.com'), '[fora do formato de e-mail]');
  assert.equal(emailTentadoParaLog(undefined), '[fora do formato de e-mail]');
  assert.equal(emailTentadoParaLog({}), '[fora do formato de e-mail]');
});
