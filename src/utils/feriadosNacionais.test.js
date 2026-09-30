import test from 'node:test';
import assert from 'node:assert/strict';
import {
  feriadosNacionais, ehFeriadoNacional, ehDiaUtil, proximoDiaUtil, hojeEscritorio, nomeDoDia, diaDaSemana,
} from './feriadosNacionais.js';
import { idCurto } from './mascarar.js';

test('feriados nacionais de 2026: fixos e móveis (Páscoa em 05/04/2026)', () => {
  const esperados = [
    '2026-01-01', // Confraternização Universal
    '2026-02-16', '2026-02-17', // segunda e terça de Carnaval
    '2026-04-03', // Sexta-feira da Paixão
    '2026-04-21', '2026-05-01',
    '2026-06-04', // Corpus Christi
    '2026-09-07', '2026-10-12', '2026-11-02', '2026-11-15',
    '2026-11-20', // Consciência Negra
    '2026-12-25',
  ];
  const set = feriadosNacionais(2026);
  for (const d of esperados) assert.ok(set.has(d), `faltou ${d}`);
  assert.equal(set.size, esperados.length, 'nenhum feriado a mais');
});

test('feriados móveis de outros anos (Páscoa 2025 = 20/04; 2027 = 28/03)', () => {
  assert.ok(ehFeriadoNacional('2025-04-18'));  // Sexta-feira Santa
  assert.ok(ehFeriadoNacional('2025-03-03'));  // segunda de Carnaval
  assert.ok(ehFeriadoNacional('2025-06-19'));  // Corpus Christi
  assert.ok(ehFeriadoNacional('2027-03-26'));  // Sexta-feira Santa
  assert.ok(ehFeriadoNacional('2027-02-08'));  // segunda de Carnaval
});

test('Quarta-feira de Cinzas e véspera de Natal NÃO são feriado nacional', () => {
  assert.equal(ehFeriadoNacional('2026-02-18'), false);
  assert.equal(ehFeriadoNacional('2026-12-24'), false);
});

test('Consciência Negra só é feriado nacional a partir de 2024', () => {
  assert.equal(ehFeriadoNacional('2023-11-20'), false);
  assert.equal(ehFeriadoNacional('2024-11-20'), true);
});

test('ehDiaUtil: sábado, domingo e feriado nacional não são dia útil; o resto é', () => {
  assert.equal(diaDaSemana('2026-10-03'), 6);
  assert.equal(ehDiaUtil('2026-10-03'), false, 'sábado');
  assert.equal(ehDiaUtil('2026-10-04'), false, 'domingo');
  assert.equal(ehDiaUtil('2026-10-12'), false, 'segunda-feira, mas Nossa Senhora Aparecida');
  assert.equal(ehDiaUtil('2026-04-03'), false, 'sexta-feira da Paixão');
  assert.equal(ehDiaUtil('2026-10-01'), true, 'quinta comum');
  assert.equal(ehDiaUtil('2026-10-05'), true, 'segunda comum');
  assert.equal(ehDiaUtil('2026-12-24'), true, 'véspera de Natal trabalha');
});

test('proximoDiaUtil: sexta vai para segunda; feriado na segunda empurra para terça; é sempre depois da data', () => {
  assert.equal(proximoDiaUtil('2026-10-01'), '2026-10-02');
  assert.equal(proximoDiaUtil('2026-10-02'), '2026-10-05');     // sexta → segunda
  assert.equal(proximoDiaUtil('2026-10-03'), '2026-10-05');     // sábado → segunda
  assert.equal(proximoDiaUtil('2026-10-09'), '2026-10-13');     // segunda 12/10 é feriado
  assert.equal(proximoDiaUtil('2026-11-19'), '2026-11-23');     // sexta 20/11 é feriado
  assert.equal(proximoDiaUtil('2026-12-31'), '2027-01-04');     // vira o ano; 01/01 feriado, 02-03/01 fim de semana
});

test('hojeEscritorio: usa o relógio de Brasília, não o de UTC', () => {
  // 01:30Z de 01/10 ainda é 22:30 de 30/09 em Brasília
  assert.equal(hojeEscritorio(new Date('2026-10-01T01:30:00Z')), '2026-09-30');
  assert.equal(hojeEscritorio(new Date('2026-10-01T02:59:59Z')), '2026-09-30');
  assert.equal(hojeEscritorio(new Date('2026-10-01T03:00:00Z')), '2026-10-01');
  assert.equal(hojeEscritorio(new Date('2026-10-01T11:00:00Z')), '2026-10-01'); // 08:00 em Brasília
});

test('nomeDoDia e datas inválidas', () => {
  assert.equal(nomeDoDia('2026-10-05'), 'segunda-feira');
  assert.equal(nomeDoDia('2026-10-04'), 'domingo');
  assert.throws(() => ehDiaUtil('2026-02-30'), /inexistente/);
  assert.throws(() => ehDiaUtil('abc'), /inválida/);
  assert.throws(() => ehDiaUtil(undefined), /inválida/);
});

test('idCurto: 8 primeiros caracteres; vazio vira traço', () => {
  assert.equal(idCurto('e542bc19-aaaa-bbbb-cccc-1234567890ab'), 'e542bc19');
  assert.equal(idCurto(''), '—');
  assert.equal(idCurto(null), '—');
});
