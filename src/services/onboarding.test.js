import test from 'node:test';
import assert from 'node:assert/strict';
import { validarDadosFechamento } from './onboarding.js';
import { somarDiasUteis } from '../utils/diasUteis.js';

const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';

test('fechamento exige assinatura, produto e responsáveis', () => {
  const erros = validarDadosFechamento({});
  assert.ok(erros.some(e => e.includes('assinado')));
  assert.ok(erros.some(e => e.includes('produto')));
  assert.ok(erros.some(e => e.includes('cadastro')));
  assert.ok(erros.some(e => e.includes('protocolo')));
});

test('cliente existente dispensa responsável de cadastro', () => {
  const erros = validarDadosFechamento({
    contrato_assinado: true,
    contrato_data: '2026-09-10',
    cliente_id: ID1,
    responsavel_protocolo_id: ID2,
    produtos: [{ produto_id: ID1, honorarios_pct: 20 }],
  });
  assert.deepEqual(erros, []);
});

test('honorários fora da faixa são recusados', () => {
  const erros = validarDadosFechamento({
    contrato_assinado: true,
    contrato_data: '2026-09-10',
    responsavel_cadastro_id: ID1,
    responsavel_protocolo_id: ID2,
    produtos: [{ produto_id: ID1, honorarios_pct: 120 }],
  });
  assert.ok(erros.some(e => e.includes('honorários')));
});

test('datas impossíveis e produtos repetidos são recusados', () => {
  const erros = validarDadosFechamento({
    contrato_assinado: true,
    contrato_data: '2026-02-30',
    responsavel_cadastro_id: ID1,
    responsavel_protocolo_id: ID2,
    produtos: [
      { produto_id: ID1, honorarios_pct: 20 },
      { produto_id: ID1, honorarios_pct: 20 },
    ],
  });
  assert.ok(erros.some(e => e.includes('data de assinatura')));
  assert.ok(erros.some(e => e.includes('mais de uma vez')));
});

test('soma dias úteis sem contar o fim de semana', () => {
  assert.equal(somarDiasUteis('2026-09-11', 1), '2026-09-14'); // sexta → segunda
  assert.equal(somarDiasUteis('2026-09-11', 3), '2026-09-16');
});
