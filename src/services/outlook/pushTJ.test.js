import test from 'node:test';
import assert from 'node:assert/strict';
import { extrairMovimentos, extrairNumerosCNJ } from './pushTJ.js';

// Corpo real do push do PJe/TJPB (02/10/2026), com as partes pessoais trocadas.
const CORPO = `PJe Push

Tribunal de Justiça da Paraíba

PJe Push - Serviço de Acompanhamento automático de processos

Prezado(a),

Informamos que o processo a seguir sofreu movimentação:

Número do Processo: 0836519-21.2024.8.15.2001

Polo Ativo: FULANA DE TAL

Polo Passivo: Estado da Paraiba

Classe Judicial: CUMPRIMENTO DE SENTENÇA CONTRA A FAZENDA PÚBLICA

Data de Autuação: 11/06/2024 16:10

Data - Movimento

02/10/2026 12:04 - Juntada de RPV

Caso não tenha mais interesse em receber o push, acessar o link:
-1/Push/loginPush.seam`;

test('extrairMovimentos: pega a linha "data hora - movimento" com a hora de Brasília, e não a data de autuação', () => {
  const movs = extrairMovimentos(CORPO);
  assert.equal(movs.length, 1);
  assert.equal(movs[0].texto, 'Juntada de RPV');
  assert.equal(movs[0].data.toISOString(), '2026-10-02T15:04:00.000Z');
});

test('extrairMovimentos: vários movimentos no mesmo e-mail, sem repetir, aceitando segundos', () => {
  const movs = extrairMovimentos(`Data - Movimento\n\n01/10/2026 09:15 - Conclusos para decisão\n02/10/2026 08:00:30 - Expedição de intimação\n01/10/2026 09:15 - Conclusos para decisão\n`);
  assert.deepEqual(movs.map(m => [m.data.toISOString(), m.texto]), [
    ['2026-10-01T12:15:00.000Z', 'Conclusos para decisão'],
    ['2026-10-02T11:00:00.000Z', 'Expedição de intimação'],
  ]);
});

test('extrairMovimentos: layout desconhecido devolve [] (o processador cai no texto inteiro)', () => {
  assert.deepEqual(extrairMovimentos('Movimentação: Juntada de petição em 02/10/2026'), []);
  assert.deepEqual(extrairMovimentos(''), []);
});

test('extrairNumerosCNJ: acha o número com máscara no corpo do push', () => {
  assert.deepEqual(extrairNumerosCNJ(CORPO), ['08365192120248152001']);
});
