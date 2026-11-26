import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grupoExercicio, pendencias, resumoPorGrupo, lerValor, numeroCnjValido, etapaValida } from './regras.js';

const base = { etapa: 'incluido_orcamento', exercicio: 2027, regime_especial: false, habilitacao_ramon: 'habilitado', habilitacao_luciano: 'habilitado', processo_origem_id: 'x' };
const tipos = (p, ano = 2026) => pendencias(p, ano).map(i => i.tipo);

test('grupo: regime especial vence o exercício; sem os dois é "sem decisão"', () => {
  assert.equal(grupoExercicio({ regime_especial: true, exercicio: 2027 }).chave, 'regime_especial');
  assert.equal(grupoExercicio({ exercicio: 2028 }).nome, 'Exercício 2028');
  assert.equal(grupoExercicio({}).chave, 'sem_decisao');
});

test('pendências: nada a cobrar quando está tudo em dia', () => {
  assert.deepEqual(tipos(base), []);
});

test('pendências: habilitação pendente e protocolada de cada sócio', () => {
  assert.deepEqual(tipos({ ...base, habilitacao_luciano: 'pendente' }), ['habilitacao']);
  assert.match(pendencias({ ...base, habilitacao_luciano: 'pendente' }, 2026)[0].texto, /Dr\. Luciano/);
  assert.deepEqual(tipos({ ...base, habilitacao_ramon: 'protocolada' }), ['habilitacao_conferir']);
});

test('pendências: sem decisão, exercício vencido e origem', () => {
  assert.deepEqual(tipos({ ...base, exercicio: null, etapa: 'autuado' }), ['sem_decisao']);
  assert.deepEqual(tipos({ ...base, exercicio: null, etapa: 'remetido' }), []);
  assert.deepEqual(tipos({ ...base, exercicio: null, regime_especial: true, etapa: 'autuado' }), []);
  assert.deepEqual(tipos({ ...base, exercicio: 2026 }), ['exercicio_vencido']);
  assert.deepEqual(tipos({ ...base, exercicio: 2025, etapa: 'pagamento_disponibilizado' }), ['alvara']);
  assert.deepEqual(tipos({ ...base, exercicio: 2025, etapa: 'alvara_levantado' }), ['repasse']);
  assert.deepEqual(tipos({ ...base, exercicio: 2025, etapa: 'repasse_cliente' }), []);
  assert.deepEqual(tipos({ ...base, processo_origem_id: null }), ['origem']);
});

test('resumo: soma por grupo, anos em ordem, sem decisão e regime especial no fim', () => {
  const r = resumoPorGrupo([
    { regime_especial: true, valor_requisitado: '10.00' }, { exercicio: 2028 }, { exercicio: 2027, valor_requisitado: '100.50' },
    { exercicio: 2027, valor_requisitado: 50 }, {},
  ]);
  assert.deepEqual(r.map(g => [g.chave, g.total, g.valor]), [['2027', 2, 150.5], ['2028', 1, 0], ['sem_decisao', 1, 0], ['regime_especial', 1, 10]]);
});

test('valor, número e etapa', () => {
  assert.equal(lerValor('1.234,56'), 1234.56);
  assert.equal(lerValor('184300'), 184300);
  assert.equal(lerValor('R$ 96.750,00'), 96750);
  assert.equal(lerValor(1234.5), 1234.5);
  assert.equal(lerValor(''), null);
  assert.equal(lerValor('abc'), false);
  assert.equal(lerValor(-5), false);
  assert.equal(numeroCnjValido('0826410-63.2026.8.15.0000'), true);
  assert.equal(numeroCnjValido('826410-63.2026.8.15.0000'), false);
  assert.equal(etapaValida('autuado'), true);
  assert.equal(etapaValida('qualquer'), false);
});
