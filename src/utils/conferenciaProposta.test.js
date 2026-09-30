import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseValorBR, numeroPositivo, mesAtual, completarVinculos, referenciaDaEstimativa,
  referenciaDosVinculos, avaliarFaixa, respostaForaDaFaixa, formatarBRL, TETO_ABSOLUTO,
} from './conferenciaProposta.js';

// 15/09/2026 ao meio-dia em Brasília.
const AGORA = new Date('2026-09-15T15:00:00Z');

// ── JN-01: período do vínculo ────────────────────────────────────────────────

test('mês atual é o de Brasília, não o de UTC (virada do mês às 22h)', () => {
  // 01/10/2026 01:30 UTC ainda é 30/09/2026 22:30 em Brasília.
  assert.equal(mesAtual(new Date('2026-10-01T01:30:00Z')), '09/2026');
  assert.equal(mesAtual(new Date('2026-10-01T03:00:00Z')), '10/2026');
  assert.equal(mesAtual(AGORA), '09/2026');
});

test('vínculo ativo (fim vazio) conta até o mês atual e ganha numMeses', () => {
  const r = completarVinculos([{ cargo: 'Professor', mesesInicio: '01/2025', mesesFim: '' }], AGORA);
  assert.equal(r.ok, true);
  assert.equal(r.vinculos[0].mesesFim, '09/2026');
  assert.equal(r.vinculos[0].numMeses, 21); // 01/2025 a 09/2026, inclusive
  assert.equal(r.vinculos[0].cargo, 'Professor'); // demais campos preservados
});

test('fim ausente (campo não enviado) também vira o mês atual', () => {
  const r = completarVinculos([{ mesesInicio: '09/2026' }], AGORA);
  assert.equal(r.ok, true);
  assert.deepEqual([r.vinculos[0].mesesFim, r.vinculos[0].numMeses], ['09/2026', 1]);
});

test('fim informado é respeitado e os meses contam inclusive', () => {
  const r = completarVinculos([{ mesesInicio: '03/2023', mesesFim: '02/2024' }], AGORA);
  assert.equal(r.ok, true);
  assert.equal(r.vinculos[0].numMeses, 12);
});

test('limite de 60 meses: numMeses trava em 60 e o período informado é mantido', () => {
  const r = completarVinculos([{ mesesInicio: '01/2021', mesesFim: '' }], AGORA);
  assert.equal(r.vinculos[0].numMeses, 60); // 01/2021 a 09/2026 = 69 meses
  assert.equal(r.vinculos[0].mesesInicio, '01/2021');
  // 59 e 60 meses ficam como estão; 61 e 74 meses viram 60.
  assert.equal(completarVinculos([{ mesesInicio: '11/2021' }], AGORA).vinculos[0].numMeses, 59);
  assert.equal(completarVinculos([{ mesesInicio: '10/2021' }], AGORA).vinculos[0].numMeses, 60);
  assert.equal(completarVinculos([{ mesesInicio: '09/2021' }], AGORA).vinculos[0].numMeses, 60);
  assert.equal(completarVinculos([{ mesesInicio: '08/2020' }], AGORA).vinculos[0].numMeses, 60);
});

test('vários vínculos: cada um recebe o seu próprio numMeses', () => {
  const r = completarVinculos([
    { mesesInicio: '01/2022', mesesFim: '12/2022' },
    { mesesInicio: '01/2023', mesesFim: '' },
  ], AGORA);
  assert.equal(r.ok, true);
  assert.deepEqual(r.vinculos.map(v => v.numMeses), [12, 45]);
});

test('período fora de MM/AAAA é barrado, com o número do vínculo quando há mais de um', () => {
  for (const inicio of ['', '2021-01', '1/2021', '13/2021', '00/2021', 'jan/2021', '01/21', '01/2021 ativo']) {
    const r = completarVinculos([{ mesesInicio: inicio, mesesFim: '' }], AGORA);
    assert.equal(r.ok, false, `início "${inicio}" deveria ser barrado`);
    assert.match(r.erro, /início.*MM\/AAAA/);
  }
  const fimRuim = completarVinculos([{ mesesInicio: '01/2024' }, { mesesInicio: '01/2024', mesesFim: 'atual' }], AGORA);
  assert.equal(fimRuim.ok, false);
  assert.match(fimRuim.erro, /^Vínculo 2: o fim do período deve estar no formato MM\/AAAA/);
});

test('fim anterior ao início e fim posterior ao mês atual são barrados', () => {
  const antes = completarVinculos([{ mesesInicio: '06/2024', mesesFim: '05/2024' }], AGORA);
  assert.equal(antes.ok, false);
  assert.match(antes.erro, /anterior ao início/);
  const futuro = completarVinculos([{ mesesInicio: '06/2024', mesesFim: '10/2026' }], AGORA);
  assert.equal(futuro.ok, false);
  assert.match(futuro.erro, /posterior ao mês atual/);
  // O próprio mês atual é permitido.
  assert.equal(completarVinculos([{ mesesInicio: '06/2024', mesesFim: '09/2026' }], AGORA).ok, true);
});

test('vínculo que não é objeto é barrado; lista vazia passa (aprovação só com o valor)', () => {
  assert.equal(completarVinculos([null], AGORA).ok, false);
  assert.equal(completarVinculos(['01/2021'], AGORA).ok, false);
  assert.deepEqual(completarVinculos([], AGORA), { ok: true, vinculos: [] });
});

test('não altera os vínculos recebidos (cópia)', () => {
  const original = [{ mesesInicio: '01/2025', mesesFim: '' }];
  completarVinculos(original, AGORA);
  assert.deepEqual(original, [{ mesesInicio: '01/2025', mesesFim: '' }]);
});

// ── leitura do valor (mesma da Camila) ───────────────────────────────────────

test('parseValorBR: ponto é milhar, vírgula é decimal, número JSON passa direto', () => {
  assert.equal(parseValorBR('12.324'), 12324);
  assert.equal(parseValorBR('12.324,50'), 12324.5);
  assert.equal(parseValorBR('R$ 9.565,98'), 9565.98);
  assert.equal(parseValorBR('32000'), 32000);
  assert.equal(parseValorBR(9565.98), 9565.98);
  assert.equal(parseValorBR('12.32'), 12.32); // o erro de vírgula clássico: não é milhar
  assert.equal(parseValorBR(''), 0);
  assert.equal(parseValorBR('abc'), 0);
  assert.equal(parseValorBR(undefined), 0);
  assert.equal(parseValorBR(NaN), 0);
});

test('numeroPositivo aceita NUMERIC do Postgres (string) e rejeita zero, negativo e lixo', () => {
  assert.equal(numeroPositivo('12403.50'), 12403.5);
  assert.equal(numeroPositivo(0), null);
  assert.equal(numeroPositivo(-1), null);
  assert.equal(numeroPositivo(null), null);
  assert.equal(numeroPositivo('x'), null);
});

// ── JN-02: faixa de valor ────────────────────────────────────────────────────

test('valor dentro de 0,2 a 5 vezes a referência não é barrado (bordas inclusive)', () => {
  assert.equal(avaliarFaixa({ valor: 12000, referencia: 12403 }).foraDaFaixa, false);
  assert.equal(avaliarFaixa({ valor: 50000, referencia: 10000 }).foraDaFaixa, false); // 5×
  assert.equal(avaliarFaixa({ valor: 2000, referencia: 10000 }).foraDaFaixa, false); // 0,2×
  assert.equal(avaliarFaixa({ valor: 2480.6, referencia: 12403 }).foraDaFaixa, false); // 0,2× com centavos
});

test('um centavo além das bordas já é barrado', () => {
  assert.equal(avaliarFaixa({ valor: 50000.01, referencia: 10000 }).razao, 'acima_da_faixa');
  assert.equal(avaliarFaixa({ valor: 1999.99, referencia: 10000 }).razao, 'abaixo_da_faixa');
});

test('erro de vírgula: os quatro casos reais de produção são barrados', () => {
  // estimativas 89 e 91: sugestões de R$ 12.403 e R$ 11.725 aprovadas em ≈ R$ 1,2 milhão (100×)
  assert.equal(avaliarFaixa({ valor: 1240335, referencia: 12403 }).razao, 'acima_da_faixa');
  assert.equal(avaliarFaixa({ valor: 1172475, referencia: 11725 }).razao, 'acima_da_faixa');
  // estimativas 97 e 102: R$ 12,32 e R$ 12,22 (1/1000 da sugestão)
  assert.equal(avaliarFaixa({ valor: 12.32, referencia: 12320 }).razao, 'abaixo_da_faixa');
  assert.equal(avaliarFaixa({ valor: 12.22, referencia: 12220 }).razao, 'abaixo_da_faixa');
  // fechado de R$ 856.598 no lugar de R$ 8.565,98
  assert.equal(avaliarFaixa({ valor: 856598, referencia: 8565.98 }).foraDaFaixa, true);
  // "9.565" lido como R$ 9,57
  assert.equal(avaliarFaixa({ valor: 9.57, referencia: 9565 }).foraDaFaixa, true);
});

test('uma casa decimal a mais (10×) e a menos (1/10) também são barradas', () => {
  assert.equal(avaliarFaixa({ valor: 81230, referencia: 8123 }).foraDaFaixa, true);
  assert.equal(avaliarFaixa({ valor: 812.3, referencia: 8123 }).foraDaFaixa, true);
});

test('teto de R$ 100 mil vale com ou sem referência', () => {
  assert.equal(avaliarFaixa({ valor: TETO_ABSOLUTO, referencia: null }).foraDaFaixa, false);
  const semReferencia = avaliarFaixa({ valor: 100000.01, referencia: null });
  assert.equal(semReferencia.razao, 'acima_do_teto');
  assert.equal(semReferencia.minimo, null);
  // Dentro da faixa, mas acima do teto: barra pelo teto.
  assert.equal(avaliarFaixa({ valor: 150000, referencia: 60000 }).razao, 'acima_do_teto');
});

test('sem referência, valor baixo não é barrado (só o teto vale)', () => {
  assert.equal(avaliarFaixa({ valor: 12.32, referencia: null }).foraDaFaixa, false);
  assert.equal(avaliarFaixa({ valor: 12.32, referencia: 0 }).foraDaFaixa, false);
  assert.equal(avaliarFaixa({ valor: 12.32, referencia: 'x' }).foraDaFaixa, false);
});

test('valor ilegível não é barrado aqui (a Camila recusa valor zero ou inválido)', () => {
  assert.equal(avaliarFaixa({ valor: NaN, referencia: 12000 }).foraDaFaixa, false);
});

test('a resposta 409 traz código estável, faixa e um texto que o frontend antigo já mostra', () => {
  const corpo = respostaForaDaFaixa(avaliarFaixa({ valor: 1240335, referencia: 12403 }));
  assert.equal(corpo.ok, false);
  assert.equal(corpo.motivo, 'valor_fora_da_faixa');
  assert.equal(corpo.razao, 'acima_da_faixa');
  assert.equal(corpo.referencia, 12403);
  assert.equal(corpo.minimo, 2480.6);
  assert.equal(corpo.maximo, 62015);
  assert.match(corpo.erro, /R\$ 1\.240\.335,00/);
  assert.match(corpo.erro, /R\$ 2\.480,60 e R\$ 62\.015,00/);
  const teto = respostaForaDaFaixa(avaliarFaixa({ valor: 120000, referencia: null }));
  assert.equal(teto.razao, 'acima_do_teto');
  assert.match(teto.erro, /passa de R\$ 100\.000,00/);
});

test('formatarBRL usa espaço comum (sem NBSP)', () => {
  assert.equal(formatarBRL(1240335), 'R$ 1.240.335,00');
});

test('referência da estimativa: sugestão antes do valor apresentado; NUMERIC como string', () => {
  assert.equal(referenciaDaEstimativa({ valor_aprovado: '9000.00', valor_sugerido: '12403.00' }), 12403);
  assert.equal(referenciaDaEstimativa({ valor_aprovado: null, valor_sugerido: '12403.00' }), 12403);
  assert.equal(referenciaDaEstimativa({ valor_aprovado: '9000.00', valor_sugerido: null }), 9000);
  assert.equal(referenciaDaEstimativa({ valor_aprovado: null, valor_sugerido: null }), null);
  assert.equal(referenciaDaEstimativa(null), null);
});

test('referência dos vínculos soma o "valor do vínculo" digitado em qualquer formato', () => {
  assert.equal(referenciaDosVinculos([{ valorEstimado: '32.000,00' }, { valorEstimado: '8000' }, {}]), 40000);
  assert.equal(referenciaDosVinculos([{ valorEstimado: '' }]), null);
  assert.equal(referenciaDosVinculos(undefined), null);
});
