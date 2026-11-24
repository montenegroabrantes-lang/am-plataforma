// Relatório mensal do acervo, etapa 3: 1º dia útil do mês e mensagem do aviso (sem cliente).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ehPrimeiroDiaUtilDoMes } from './relatorioMensal.js';
import { montarAvisoRelatorio, nomeMesBR } from './avisosAcervo.js';

test('1º dia útil do mês, com fim de semana e feriado nacional', () => {
  assert.equal(ehPrimeiroDiaUtilDoMes('2026-12-01'), true, 'terça');
  assert.equal(ehPrimeiroDiaUtilDoMes('2026-12-02'), false);
  assert.equal(ehPrimeiroDiaUtilDoMes('2026-11-02'), false, 'Finados');
  assert.equal(ehPrimeiroDiaUtilDoMes('2026-11-03'), true, 'depois de domingo e de Finados');
  assert.equal(ehPrimeiroDiaUtilDoMes('2027-01-01'), false, 'Confraternização');
  assert.equal(ehPrimeiroDiaUtilDoMes('2027-01-04'), true, 'segunda depois do feriado e do fim de semana');
  assert.equal(ehPrimeiroDiaUtilDoMes('2026-08-01'), false, 'sábado');
  assert.equal(ehPrimeiroDiaUtilDoMes('2026-08-03'), true);
});

test('aviso do relatório: cinco linhas, plural certo e link; sem processo', () => {
  assert.equal(nomeMesBR('2026-11'), 'novembro/2026');
  const t = montarAvisoRelatorio({
    mes: '2026-11',
    resumo: { pecas_protocoladas: 42, decisoes: { total: 9, favoraveis: 7, desfavoraveis: 1, a_confirmar: 1 }, taxa_exito_mes: 87.5 },
    anterior: { mes: '2026-10', resumo: { taxa_exito_mes: null } },
    atencao: { teses_em_risco: [{}], decisoes_a_confirmar: 2, vigilancia_mudou: [] },
    baseUrl: 'https://am.exemplo.com.br',
  });
  assert.equal(t, [
    '📊 *Acervo — relatório de novembro/2026*',
    '42 peças protocoladas · 9 decisões (7 favoráveis, 1 desfavorável, 1 a confirmar)',
    'Êxito do mês: 87,5% (outubro: —)',
    'Atenção: 1 tese em risco · 2 decisões a conferir',
    'Relatório completo: https://am.exemplo.com.br/acervo/relatorio?mes=2026-11',
  ].join('\n'));
  const vazio = montarAvisoRelatorio({ mes: '2026-10', resumo: { pecas_protocoladas: 1, decisoes: { total: 0 }, taxa_exito_mes: null }, baseUrl: '' });
  assert.match(vazio, /1 peça protocolada · nenhuma decisão\nÊxito do mês: —\nAtenção: nada pendente\nRelatório completo no AM\.$/);
});
