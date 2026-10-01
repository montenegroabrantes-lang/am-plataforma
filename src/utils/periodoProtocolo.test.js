import test from 'node:test';
import assert from 'node:assert/strict';
import { primeiroDiaDoMes, resolverPeriodoProtocolo } from './periodoProtocolo.js';

const HOJE = new Date('2026-09-28T12:00:00Z');

test('primeiroDiaDoMes normaliza mês, data e Date; recusa lixo', () => {
  assert.equal(primeiroDiaDoMes('2025-11'), '2025-11-01');
  assert.equal(primeiroDiaDoMes('2025-11-17'), '2025-11-01');
  assert.equal(primeiroDiaDoMes(new Date('2026-09-28T12:00:00Z')), '2026-09-01');
  for (const invalido of [null, undefined, '', '2025-13', '11/2025', 'abc', '1800-01']) {
    assert.equal(primeiroDiaDoMes(invalido), null, `aceitou ${invalido}`);
  }
});

test('fim do período é obrigatório', () => {
  const r = resolverPeriodoProtocolo({ periodoFim: null, hoje: HOJE });
  assert.equal(r.ok, false);
  assert.match(r.erro, /fim do período/);
});

test('fim não pode passar do mês atual; o mês atual é aceito', () => {
  assert.equal(resolverPeriodoProtocolo({ periodoFim: '2026-10-01', hoje: HOJE }).ok, false);
  assert.deepEqual(resolverPeriodoProtocolo({ periodoFim: '2026-09-01', hoje: HOJE }),
    { ok: true, inicio: null, fim: '2026-09-01' });
});

test('re-protocolo sem início informado usa o ciclo_inicio', () => {
  const r = resolverPeriodoProtocolo({ cicloInicio: '2023-11-01', periodoFim: '2026-09-01', hoje: HOJE });
  assert.deepEqual(r, { ok: true, inicio: '2023-11-01', fim: '2026-09-01' });
});

test('re-protocolo nunca começa antes do ciclo (sobreporia o processo anterior)', () => {
  const r = resolverPeriodoProtocolo({ cicloInicio: '2023-11-01', periodoInicio: '2023-10', periodoFim: '2026-09', hoje: HOJE });
  assert.equal(r.ok, false);
  assert.match(r.erro, /11\/2023/);
});

test('re-protocolo pode começar depois do ciclo (ex.: limitar aos últimos 60 meses)', () => {
  const r = resolverPeriodoProtocolo({ cicloInicio: '2011-03-01', periodoInicio: '2021-10', periodoFim: '2026-09', hoje: HOJE });
  assert.deepEqual(r, { ok: true, inicio: '2021-10-01', fim: '2026-09-01' });
});

test('início depois do fim é recusado; início inválido também', () => {
  assert.equal(resolverPeriodoProtocolo({ periodoInicio: '2026-05', periodoFim: '2026-04', hoje: HOJE }).ok, false);
  assert.equal(resolverPeriodoProtocolo({ periodoInicio: '13/2026', periodoFim: '2026-04', hoje: HOJE }).ok, false);
});

test('protocolo inicial: início é opcional e, se vier, é gravado', () => {
  assert.deepEqual(resolverPeriodoProtocolo({ periodoFim: '2026-08', hoje: HOJE }), { ok: true, inicio: null, fim: '2026-08-01' });
  assert.deepEqual(resolverPeriodoProtocolo({ periodoInicio: '2021-09', periodoFim: '2026-08', hoje: HOJE }),
    { ok: true, inicio: '2021-09-01', fim: '2026-08-01' });
});
