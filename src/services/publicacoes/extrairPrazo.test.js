import test from 'node:test';
import assert from 'node:assert/strict';
import { extrairPrazoPublicacao, prazoPlausivel } from './extrairPrazo.js';

test('calcula prazo útil a partir do primeiro dia útil após a publicação', () => {
  const prazo = extrairPrazoPublicacao(
    'Intime-se a parte para manifestação no prazo de 5 dias úteis.',
    '2026-09-11', // sexta-feira: publicação na segunda, contagem na terça
    { numero: '0000000-00.2026.8.15.0000' },
  );

  assert.equal(prazo.dataEvento.toISOString().slice(0, 10), '2026-09-21');
  assert.equal(prazoPlausivel(prazo.dataEvento, '2026-09-11'), true);
});

test('recusa data histórica encontrada no corpo de uma publicação nova', () => {
  const prazo = extrairPrazoPublicacao(
    'Conforme audiência designada até 08/12/2021, intime-se.',
    '2026-09-10',
    null,
  );

  assert.equal(prazo.dataEvento.toISOString().slice(0, 10), '2021-12-08');
  assert.equal(prazoPlausivel(prazo.dataEvento, '2026-09-10'), false);
});

test('recusa prazo automático acima de 180 dias', () => {
  assert.equal(prazoPlausivel(new Date('2027-04-01T12:00:00Z'), '2026-09-10'), false);
});

test('recusa datas inválidas sem lançar exceção', () => {
  assert.equal(prazoPlausivel(new Date('data-invalida'), '2026-09-10'), false);
  assert.equal(prazoPlausivel(new Date(), 'data-invalida'), false);
});

// ---------------------------------------------------------------------------------------------
// R-22 — "prazo de N dias" + data explícita, audiência por extenso e ordem do tipo do ato.
// Textos inventados, no formato genérico das publicações; publicação em 28/09/2026 (segunda-feira).
// ---------------------------------------------------------------------------------------------

const PROCESSO = { numero: '0000000-00.2026.8.15.0000' };
const dia = data => data.toISOString().slice(0, 10);

test('R-22: prazo de N dias + data explícita POSTERIOR → vale a menor (dias) e marca "conferir"', () => {
  // Dias corridos: 29/09 + 5 = domingo 04/10 → prorroga para segunda 05/10. A data explícita
  // (31/12) é só o limite de um cálculo e antes vencia por cima do prazo real.
  const prazo = extrairPrazoPublicacao(
    'Intime-se a parte autora para se manifestar no prazo de 5 dias. As diferenças devidas até 31/12/2026 serão apuradas em liquidação.',
    '2026-09-28',
    PROCESSO,
  );

  assert.equal(dia(prazo.dataEvento), '2026-10-05');
  assert.equal(prazo.conferir, true);
  assert.match(prazo.titulo, /\(conferir data\)$/);
  assert.match(prazo.motivoConferir, /05\/10\/2026/);
  assert.match(prazo.motivoConferir, /31\/12\/2026/);
  assert.match(prazo.descricao, /Conferir no PJe:/);
  assert.match(prazo.descricao, /Prazo: 5 dias/);
  assert.equal(prazoPlausivel(prazo.dataEvento, '2026-09-28'), true);
});

test('R-22: prazo de N dias + data explícita ANTERIOR → vale a data explícita e marca "conferir"', () => {
  // 15 dias corridos dariam 14/10; o vencimento citado no texto é 10/10.
  const prazo = extrairPrazoPublicacao(
    'Intime-se para pagamento no prazo de 15 dias, com vencimento até 10/10/2026.',
    '2026-09-28',
    PROCESSO,
  );

  assert.equal(dia(prazo.dataEvento), '2026-10-10');
  assert.equal(prazo.conferir, true);
  assert.match(prazo.titulo, /\(conferir data\)$/);
  assert.doesNotMatch(prazo.descricao, /Prazo: 15 dias/, 'a data escolhida não vem da contagem em dias');
});

test('R-22: dias úteis e data explícita → compara a data já contada em dias úteis', () => {
  // 5 dias úteis a partir de 29/09: 30/09, 01/10, 02/10, 05/10, 06/10 → terça 06/10.
  const prazo = extrairPrazoPublicacao(
    'Concedo o prazo de 5 (cinco) dias úteis para juntar documentos, até 20/10/2026.',
    '2026-09-28',
    PROCESSO,
  );

  assert.equal(dia(prazo.dataEvento), '2026-10-06');
  assert.equal(prazo.conferir, true);
  assert.match(prazo.descricao, /Prazo: 5 dias úteis/);
});

test('R-22: prazo de N dias e data explícita que coincidem → sem "conferir"', () => {
  const prazo = extrairPrazoPublicacao(
    'Manifeste-se no prazo de 5 dias, ou seja, até 05/10/2026.',
    '2026-09-28',
    PROCESSO,
  );

  assert.equal(dia(prazo.dataEvento), '2026-10-05');
  assert.equal(prazo.conferir, undefined);
  assert.doesNotMatch(prazo.titulo, /conferir/);
  assert.doesNotMatch(prazo.descricao, /Conferir no PJe/);
});

test('R-22: só data explícita ou só prazo de N dias seguem como antes, sem "conferir"', () => {
  const soExplicita = extrairPrazoPublicacao('Junte o comprovante até 30/10/2026.', '2026-09-28', PROCESSO);
  assert.equal(dia(soExplicita.dataEvento), '2026-10-30');
  assert.equal(soExplicita.conferir, undefined);
  assert.doesNotMatch(soExplicita.titulo, /conferir/);

  const soDias = extrairPrazoPublicacao('Intime-se para emendar a inicial no prazo de 15 dias úteis.', '2026-09-28', PROCESSO);
  assert.equal(dia(soDias.dataEvento), '2026-10-21'); // 12/10 (feriado) não conta
  assert.equal(soDias.conferir, undefined);
  assert.doesNotMatch(soDias.titulo, /conferir/);
});

test('R-22: data explícita histórica junto de "prazo de N dias" continua sendo barrada pela plausibilidade', () => {
  const prazo = extrairPrazoPublicacao(
    'Conforme decisão anterior, até 08/12/2021, fica concedido o prazo de 5 dias.',
    '2026-09-28',
    PROCESSO,
  );

  assert.equal(dia(prazo.dataEvento), '2021-12-08');
  assert.equal(prazo.conferir, true);
  assert.equal(prazoPlausivel(prazo.dataEvento, '2026-09-28'), false);
});

test('R-22: data de disponibilização inválida não derruba a extração', () => {
  // Só dias: sem base não há como contar → null (antes lançava RangeError).
  assert.equal(extrairPrazoPublicacao('Manifeste-se no prazo de 5 dias.', 'data-invalida', PROCESSO), null);
  // Explícita sozinha não depende da disponibilização.
  assert.equal(dia(extrairPrazoPublicacao('Junte o comprovante até 30/10/2026.', 'data-invalida', PROCESSO).dataEvento), '2026-10-30');
  // Os dois: sem como comparar, fica a data explícita, como antes da correção.
  const ambos = extrairPrazoPublicacao('Manifeste-se no prazo de 5 dias, até 30/10/2026.', undefined, PROCESSO);
  assert.equal(dia(ambos.dataEvento), '2026-10-30');
  assert.equal(ambos.conferir, undefined);
});

test('R-22: data por extenso com hora de uma decisão não vira "Audiência"; vale o prazo de N dias', () => {
  const prazo = extrairPrazoPublicacao(
    'Decisão proferida em 10 de dezembro de 2026, às 14h. Intime-se a parte para apresentar recurso no prazo de 5 dias.',
    '2026-09-28',
    PROCESSO,
  );

  assert.equal(dia(prazo.dataEvento), '2026-10-05');
  assert.match(prazo.titulo, /^Prazo — Recurso/);
  assert.doesNotMatch(prazo.titulo, /Audiência/);
});

test('R-22: data por extenso com hora, sem audiência/sessão e sem prazo, não gera nada', () => {
  assert.equal(extrairPrazoPublicacao('Publicado em 10 de dezembro de 2026, às 14h.', '2026-09-28', PROCESSO), null);
});

test('R-22: audiência por extenso continua reconhecida (data e hora)', () => {
  const prazo = extrairPrazoPublicacao(
    'Fica designada audiência de instrução para o dia 20 de agosto de 2026 às 14h30, na sala 2.',
    '2026-07-28',
    PROCESSO,
  );

  assert.match(prazo.titulo, /^Audiência/);
  assert.equal(prazo.dataEvento.getFullYear(), 2026);
  assert.equal(prazo.dataEvento.getMonth(), 7);
  assert.equal(prazo.dataEvento.getDate(), 20);
  assert.equal(prazo.dataEvento.getHours(), 14);
  assert.equal(prazo.dataEvento.getMinutes(), 30);

  // Com vírgula antes do "às" a data é reconhecida do mesmo jeito (a hora é outra história: o
  // parseDateExtenso só lê a hora sem vírgula — achado lateral, fora do R-22).
  const comVirgula = extrairPrazoPublicacao(
    'Fica designada audiência de instrução para o dia 20 de agosto de 2026, às 14h30, na sala 2.',
    '2026-07-28',
    PROCESSO,
  );
  assert.match(comVirgula.titulo, /^Audiência/);
  assert.equal(comVirgula.dataEvento.getDate(), 20);
});

test('R-22: data com "audiência" depois, na mesma frase, também vale; a da frase anterior não', () => {
  const mesmaFrase = extrairPrazoPublicacao(
    'Em 20 de agosto de 2026, às 14h, será realizada a audiência de conciliação.',
    '2026-07-28',
    PROCESSO,
  );
  assert.match(mesmaFrase.titulo, /^Audiência/);
  assert.equal(mesmaFrase.dataEvento.getDate(), 20);

  // A decisão (10/12) vem antes; a palavra "audiência" só aparece na frase seguinte, que trata de
  // outra data. Vale a segunda data, não a da decisão.
  const duas = extrairPrazoPublicacao(
    'Decisão proferida em 10 de dezembro de 2026, às 14h. Designada audiência para 20 de janeiro de 2027, às 9h.',
    '2026-12-11',
    PROCESSO,
  );
  assert.match(duas.titulo, /^Audiência/);
  assert.equal(duas.dataEvento.getFullYear(), 2027);
  assert.equal(duas.dataEvento.getMonth(), 0);
  assert.equal(duas.dataEvento.getDate(), 20);
});

test('R-22: sessão de julgamento com data por extenso e hora continua valendo', () => {
  const prazo = extrairPrazoPublicacao(
    'Processo incluído em pauta da sessão ordinária de 12 de novembro de 2026, às 09h00.',
    '2026-10-20',
    PROCESSO,
  );

  assert.match(prazo.titulo, /^Audiência/);
  assert.equal(prazo.dataEvento.getMonth(), 10);
  assert.equal(prazo.dataEvento.getDate(), 12);
});

test('audiência com data numérica (dd/mm/aaaa) segue igual', () => {
  const prazo = extrairPrazoPublicacao('Designo audiência para o dia 20/08/2026 às 14h30.', '2026-07-28', PROCESSO);

  assert.match(prazo.titulo, /^Audiência/);
  assert.equal(prazo.dataEvento.getMonth(), 7);
  assert.equal(prazo.dataEvento.getDate(), 20);
});

test('R-22: contrarrazões vêm antes de recurso, apelação, embargos e contestação no tipo do ato', () => {
  const tipo = texto => extrairPrazoPublicacao(texto, '2026-09-28', PROCESSO).titulo.replace(` — ${PROCESSO.numero}`, '');

  assert.equal(tipo('Intime-se o apelado para apresentar contrarrazões ao recurso de apelação, no prazo de 15 dias úteis.'), 'Prazo — Contrarrazões');
  assert.equal(tipo('Vista para contrarrazões ao recurso inominado no prazo de 10 dias.'), 'Prazo — Contrarrazões');
  assert.equal(tipo('Abra-se prazo de 5 dias para contrarrazões aos embargos de declaração.'), 'Prazo — Contrarrazões');
});

test('tipo do ato: recurso, apelação e demais tipos não mudaram sem "contrarrazões" no texto', () => {
  const tipo = texto => extrairPrazoPublicacao(texto, '2026-09-28', PROCESSO).titulo.replace(` — ${PROCESSO.numero}`, '');

  assert.equal(tipo('Fica intimada a parte para interpor recurso inominado no prazo de 10 dias.'), 'Prazo — Recurso');
  assert.equal(tipo('Da sentença cabe apelação no prazo de 15 dias úteis.'), 'Prazo — Apelação');
  assert.equal(tipo('Apresente a contestação no prazo de 15 dias úteis.'), 'Prazo — Contestação');
  assert.equal(tipo('Opostos embargos de declaração, manifeste-se a parte contrária em 5 dias.'), 'Prazo — Embargos de Declaração');
  assert.equal(tipo('Fica designada audiência de conciliação; a parte deve juntar documentos no prazo de 5 dias.'), 'Audiência');
});
