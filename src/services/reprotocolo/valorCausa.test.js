import test from 'node:test';
import assert from 'node:assert/strict';
import { calcularValorCausa, salarioMinimoVigente, TETO_JUIZADO_SALARIOS } from './valorCausa.js';

const OFICIAL = { status: 'encontrado', correspondencia: 'unica', risco: 12345.678, periodo_consultado: { inicio: '2021-10', fim: '2026-09' } };

test('tese diferente de FGTS: sem cálculo integrado, exige o advogado', () => {
  const r = calcularValorCausa({ tese: 'INSALUBRIDADE', oficial: OFICIAL, salarioMinimo: null });
  assert.equal(r.valor, null);
  assert.equal(r.exige_humano, true);
  assert.match(r.motivo, /INSALUBRIDADE/);
});

test('FGTS sem conferência oficial (município) ou sem correspondência clara: exige o advogado', () => {
  assert.match(calcularValorCausa({ tese: 'FGTS', oficial: null, salarioMinimo: null }).motivo, /município ou ente inferido/);
  const ambigua = calcularValorCausa({ tese: 'FGTS', oficial: { status: 'encontrado', correspondencia: 'ambigua', risco: null }, salarioMinimo: null });
  assert.equal(ambigua.valor, null);
  assert.match(ambigua.motivo, /correspondência clara/);
});

test('FGTS com referência oficial: valor arredondado, memória e sempre "revisar"', () => {
  const r = calcularValorCausa({ tese: 'FGTS', oficial: OFICIAL, salarioMinimo: null });
  assert.equal(r.valor, 12345.68);
  assert.equal(r.revisar, true);
  assert.equal(r.exige_humano, false);
  assert.ok(r.memoria.some(m => m.includes('2021-10 a 2026-09')));
  assert.ok(r.memoria.some(m => m.includes('não verificado')), 'teto não verificado sem salário mínimo');
});

test('teto do Juizado: 60 salários mínimos; acima disso vai para o advogado', () => {
  const dentro = calcularValorCausa({ tese: 'FGTS', oficial: { ...OFICIAL, risco: 5000 }, salarioMinimo: 1500 });
  assert.equal(dentro.exige_humano, false);
  assert.equal(TETO_JUIZADO_SALARIOS, 60);
  const acima = calcularValorCausa({ tese: 'FGTS', oficial: { ...OFICIAL, risco: 95000 }, salarioMinimo: 1500 });
  assert.equal(acima.exige_humano, true);
  assert.match(acima.motivo, /teto do Juizado/i);
});

test('salarioMinimoVigente lê a env e ignora valor inválido', () => {
  const antes = process.env.SALARIO_MINIMO_VIGENTE;
  try {
    process.env.SALARIO_MINIMO_VIGENTE = '1621.5'; assert.equal(salarioMinimoVigente(), 1621.5);
    process.env.SALARIO_MINIMO_VIGENTE = '1621,5'; assert.equal(salarioMinimoVigente(), 1621.5);
    process.env.SALARIO_MINIMO_VIGENTE = 'abc'; assert.equal(salarioMinimoVigente(), null);
    delete process.env.SALARIO_MINIMO_VIGENTE; assert.equal(salarioMinimoVigente(), null);
  } finally { if (antes === undefined) delete process.env.SALARIO_MINIMO_VIGENTE; else process.env.SALARIO_MINIMO_VIGENTE = antes; }
});
