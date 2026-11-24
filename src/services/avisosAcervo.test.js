// Avisos do acervo (24/11/2026): mensagem sem dado de cliente, janela de horário e interruptor.
// O despacho e a fila são testados contra Postgres real (integração do acervo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarAvisoVigilancia, dentroDaJanela, horaEscritorio, avisosLigados } from './avisosAcervo.js';

const BASE = 'https://am.exemplo.com.br';

test('aviso da vigilância: tema, situação, contagens e link; sem processo nem cliente', () => {
  const t = montarAvisoVigilancia({ referencia: 'Tema 1218 (RE 1.326.541)', situacao: 'Julgado em 25/11/2026:\n tese fixada.', totalPecas: 7, totalProcessos: 7, teses: ['piso-salarial-magisterio-pb'], baseUrl: BASE });
  assert.match(t, /^⚖️ \*Acervo — vigilância mudou\*/);
  assert.match(t, /Tema 1218 \(RE 1\.326\.541\)/);
  assert.match(t, /Nova situação: Julgado em 25\/11\/2026: tese fixada\./, 'quebra de linha da situação vira espaço');
  assert.match(t, /Afeta 7 peças em 7 processos \(teses: piso-salarial-magisterio-pb\)\./);
  assert.match(t, /Tarefa aberta para você no AM: https:\/\/am\.exemplo\.com\.br\/tarefas$/);
  assert.doesNotMatch(t, /\d{7}-\d{2}\.\d{4}/, 'nenhum número de processo');
});

test('aviso da vigilância: singular, sem peças, sem link local e com textos longos cortados', () => {
  assert.match(montarAvisoVigilancia({ referencia: 'PUIL', situacao: 'x', totalPecas: 1, totalProcessos: 1, baseUrl: BASE }), /Afeta 1 peça em 1 processo\./);
  const sem = montarAvisoVigilancia({ referencia: 'PUIL', situacao: 'x', totalPecas: 0, baseUrl: 'http://localhost:3000' });
  assert.match(sem, /Nenhuma peça do acervo ligada a essas teses\./);
  assert.match(sem, /Tarefa aberta para você no AM\.$/, 'sem link para a máquina local');
  const longo = montarAvisoVigilancia({ referencia: 'R'.repeat(500), situacao: 'S'.repeat(900), baseUrl: BASE });
  assert.ok(longo.length < 800);
  const muitas = montarAvisoVigilancia({ referencia: 'T', situacao: 's', totalPecas: 9, totalProcessos: 9, teses: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], baseUrl: BASE });
  assert.match(muitas, /\(teses: a, b, c, d, e…\)/);
});

test('janela: dia útil, das 08h às 20h de Brasília', () => {
  // 24/11/2026 é terça-feira. Brasília = UTC−3.
  assert.equal(horaEscritorio(new Date('2026-11-24T13:00:00Z')), 10);
  assert.equal(dentroDaJanela(new Date('2026-11-24T13:00:00Z')), true, 'terça, 10h');
  assert.equal(dentroDaJanela(new Date('2026-11-24T11:00:00Z')), true, 'terça, 08h em ponto');
  assert.equal(dentroDaJanela(new Date('2026-11-24T10:59:00Z')), false, 'terça, 07h59');
  assert.equal(dentroDaJanela(new Date('2026-11-24T22:59:00Z')), true, 'terça, 19h59');
  assert.equal(dentroDaJanela(new Date('2026-11-24T23:00:00Z')), false, 'terça, 20h');
  assert.equal(dentroDaJanela(new Date('2026-11-28T13:00:00Z')), false, 'sábado');
  assert.equal(dentroDaJanela(new Date('2026-12-25T13:00:00Z')), false, 'Natal');
  assert.equal(dentroDaJanela(new Date('2026-11-25T02:30:00Z')), false, 'terça, 23h30 em Brasília, já quarta em UTC');
});

test('interruptor geral', () => {
  assert.equal(avisosLigados({}), true);
  assert.equal(avisosLigados({ ACERVO_AVISOS_WHATSAPP: 'false' }), false);
  assert.equal(avisosLigados({ ACERVO_AVISOS_WHATSAPP: ' FALSE ' }), false);
  assert.equal(avisosLigados({ ACERVO_AVISOS_WHATSAPP: 'true' }), true);
});

test('decisão: linha com CNJ, peça, data e sentido; nunca número que não seja CNJ', async () => {
  const { montarLinhaDecisao } = await import('./avisosAcervo.js');
  assert.equal(montarLinhaDecisao({ numero: '0859627-45.2025.8.15.2001', tipoPeca: 'memorial', tipoDecisao: 'Sentença', data: '2026-11-18' }),
    '• 0859627-45.2025.8.15.2001 (memorial) — Sentença de 18/11/2026 — resultado a confirmar');
  assert.equal(montarLinhaDecisao({ numero: '08596274520258152001', tipoPeca: 'recurso-inominado', tipoDecisao: 'Acórdão', data: '2026-11-20', resultado: 'parcialmente-provido', sentido: 'favoravel' }),
    '• 0859627-45.2025.8.15.2001 (recurso inominado) — Acórdão de 20/11/2026 — favorável ao cliente: parcialmente provido');
  assert.match(montarLinhaDecisao({ numero: 'MARIA DA SILVA 123', tipoPeca: 'inicial', tipoDecisao: 'Sentença', data: '2026-11-20', resultado: 'improcedente', sentido: 'desfavoravel' }),
    /^• processo sem número CNJ \(inicial\) — Sentença de 20\/11\/2026 — desfavorável ao cliente: improcedente$/, 'texto livre no número não vai para o WhatsApp');
});

test('decisões agrupadas: título no singular ou plural, no máximo 10 linhas', async () => {
  const { montarAvisoDecisoes } = await import('./avisosAcervo.js');
  const um = montarAvisoDecisoes(['• a'], { baseUrl: BASE });
  assert.match(um, /^📄 \*Acervo — decisão no PJe\*\n• a\nConferir nas tarefas do AM: https:\/\/am\.exemplo\.com\.br\/tarefas$/);
  const muitos = montarAvisoDecisoes(Array.from({ length: 13 }, (_, i) => `• ${i}`), { baseUrl: '' });
  assert.match(muitos, /^📄 \*Acervo — 13 decisões no PJe\*/);
  assert.equal(muitos.split('\n').filter(l => l.startsWith('• ')).length, 10);
  assert.match(muitos, /\ne mais 3 no AM\nConferir nas tarefas do AM\.$/);
});
