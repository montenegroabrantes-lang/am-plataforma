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
