import test from 'node:test';
import assert from 'node:assert/strict';
import { validarDadosFechamento, validarDatasVinculos } from './onboarding.js';
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

test('datas do vínculo: só AAAA-MM-DD ou vazio passam (vínculo atual, sem fim)', () => {
  assert.equal(validarDatasVinculos([{ vinculo_inicio: '2021-03-15', vinculo_fim: '2024-12-31' }]), null);
  assert.equal(validarDatasVinculos([{ vinculo_inicio: '2021-03-15', vinculo_fim: '' }]), null);
  assert.equal(validarDatasVinculos([{ vinculo_inicio: '', vinculo_fim: null }, { cargo: 'Professor' }]), null);
  assert.equal(validarDatasVinculos([]), null);
  assert.equal(validarDatasVinculos(undefined), null);
});

test('datas do vínculo: "AAAA-MM" do rascunho da Camila é recusado, com os campos e sem o valor', () => {
  const r = validarDatasVinculos([{ vinculo_inicio: '2021-03', vinculo_fim: '2024-05' }]);
  assert.match(r.mensagem, /início do vínculo 1, fim do vínculo 1/);
  assert.match(r.mensagem, /dia, mês e ano/);
  assert.doesNotMatch(r.mensagem, /2021|2024/);
  assert.deepEqual(r.campos, [
    { campo: 'vinculo_1_inicio', formato: 'AAAA-MM' },
    { campo: 'vinculo_1_fim', formato: 'AAAA-MM' },
  ]);
});

test('datas do vínculo: só o campo ruim é citado, inclusive no 2º vínculo', () => {
  const r = validarDatasVinculos([
    { vinculo_inicio: '2021-03-15', vinculo_fim: '' },
    { vinculo_inicio: '2018-07-01', vinculo_fim: '2020-02' },
  ]);
  assert.match(r.mensagem, /fim do vínculo 2/);
  assert.doesNotMatch(r.mensagem, /início|vínculo 1/);
  assert.deepEqual(r.campos, [{ campo: 'vinculo_2_fim', formato: 'AAAA-MM' }]);
});

test('datas do vínculo: dia impossível, lixo e tipos estranhos são recusados', () => {
  for (const ruim of ['2021-02-30', '2021-13-01', '21-03-15', '15/03/2021', 'abc', ' ', '2021-03-15T10:00:00', 20210315, ['2021-03-15'], {}, true]) {
    const r = validarDatasVinculos([{ vinculo_inicio: ruim }]);
    assert.ok(r, `deveria recusar ${JSON.stringify(ruim)}`);
    assert.equal(r.campos[0].formato, 'invalido');
  }
});
