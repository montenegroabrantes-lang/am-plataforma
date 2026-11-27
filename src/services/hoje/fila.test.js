import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarHoje, tipoDecisao, POR_GRUPO } from './fila.js';

const agora = new Date('2026-11-25T15:00:00Z');
const dia = n => new Date(Date.UTC(2026, 10, 25 + n)).toISOString();

test('prazos: vencidos primeiro, texto do prazo e contagem do cartão', () => {
  const r = montarHoje({ agora, tarefas: [
    { id: 1, tipo: 'prazo', descricao: 'Contrarrazões', prazo_data: dia(3), processo_numero: '0800001-11.2026.8.15.2001', cliente_nome: 'ANA' },
    { id: 2, tipo: 'prazo', prazo_data: dia(-2) }, { id: 3, tipo: 'prazo', prazo_data: dia(0) }, { id: 4, tipo: 'prazo', prazo_data: dia(1) },
    { id: 5, tipo: 'prazo', prazo_data: dia(30) }, { id: 6, tipo: 'prazo', prazo_data: null },
  ] });
  assert.deepEqual(r.fila.map(i => i.quando), ['venceu há 2 dias', 'vence hoje', 'vence amanhã', 'vence em 3 dias', 'vence em 30 dias', 'sem data']);
  assert.deepEqual([r.resumo[0].total, r.resumo[0].nota, r.resumo[0].alerta], [6, '1 vencido · 3 em 7 dias', true]);
  assert.equal(r.fila[3].sub, 'ANA · 0800001-11.2026.8.15.2001');
  assert.equal(r.fila[3].link, '/tarefas?busca=0800001-11.2026.8.15.2001');
  assert.equal(r.fila[0]._ordem, undefined);
});

test('protocolar: o que já está no Drive vem primeiro e pede o número', () => {
  const r = montarHoje({ agora, tarefas: [
    { id: 1, tipo: 'protocolar', descricao: 'Protocolar FGTS', cliente_nome: 'JOSÉ', criado_em: dia(-12) },
    { id: 2, tipo: 'protocolar', cliente_nome: 'MARIA', criado_em: dia(-1), drive_protocolo_detectado_em: dia(0) },
  ] });
  assert.deepEqual(r.fila.map(i => [i.acao, i.quando]), [['Informar número', 'aberta há 1 dia'], ['Protocolar', 'aberta há 12 dias']]);
  assert.deepEqual([r.resumo[2].total, r.resumo[2].nota, r.resumo[2].alerta], [2, '1 já no Drive, falta o número', true]);
});

test('assinar e decisões: só sentença, decisão e acórdão entram', () => {
  assert.deepEqual(['Sentença', 'ACÓRDÃO', 'Decisão', 'EXPEDIENTE', 'Despacho_Intimação', null].map(tipoDecisao), ['Sentença', 'Acórdão', 'Decisão', null, null, null]);
  const r = montarHoje({ agora,
    assinaturas: [{ id: 'a', observacao: 'Contrarrazões', processo_numero: '0800003-33.2024.8.15.2001', local: '2ª Vara' }],
    publicacoes: [{ id: 'p1', tipo_documento: 'Sentença', numero_processo: '0800005-55.2025.8.15.2001', data_disponibilizacao: dia(-1) },
      { id: 'p2', tipo_documento: 'EXPEDIENTE', data_disponibilizacao: dia(0) }, { id: 'p3', tipo_documento: 'Decisão', data_disponibilizacao: dia(0) }] });
  assert.deepEqual(r.resumo.map(c => c.total), [0, 1, 0, 2]);
  assert.deepEqual(r.fila.map(i => [i.grupo, i.quando]), [['assinar', '2ª Vara'], ['decisao', 'hoje'], ['decisao', 'ontem']]);
});

test('fila: no máximo oito por grupo, e o cartão continua com o total', () => {
  const r = montarHoje({ agora, tarefas: Array.from({ length: 20 }, (_, i) => ({ id: i, tipo: 'prazo', prazo_data: dia(i) })) });
  assert.equal(r.fila.length, POR_GRUPO);
  assert.equal(r.resumo[0].total, 20);
  assert.equal(montarHoje({ agora }).resumo[0].nota, 'nenhum vencendo');
});

test('prazo com petição juntada: sugestão e endereço da baixa, sem mudar a ordem nem as contagens', () => {
  const avaliacoes = new Map([[3, { acao: 'sugerir', texto: 'Petição juntada em 24/11/2026' }], [2, { acao: 'concluir', motivo: 'audiencia' }], [1, { acao: 'nada' }]]);
  const r = montarHoje({ agora, avaliacoes, tarefas: [
    { id: 1, tipo: 'prazo', descricao: 'Recurso', prazo_data: dia(-2) },
    { id: 2, tipo: 'prazo', descricao: 'Audiência', prazo_data: dia(-1) },
    { id: 3, tipo: 'prazo', descricao: 'Contrarrazões', prazo_data: dia(9) },
  ] });
  assert.deepEqual(r.fila.map(i => i.titulo), ['Recurso', 'Audiência', 'Contrarrazões']);
  assert.deepEqual([r.fila[2].sugestao, r.fila[2].cumprir], ['Petição juntada em 24/11/2026', '/api/hoje/prazos/3/cumprir']);
  assert.deepEqual([r.fila[0].sugestao, r.fila[0].cumprir, r.fila[1].sugestao], [null, null, null]);
  assert.deepEqual([r.resumo[0].total, r.resumo[0].nota, r.resumo[0].com_peticao], [3, '2 vencidos', 1]);
  assert.equal(r.fila[0]._d, undefined);
});

test('sem avaliações nada é sugerido', () => {
  const r = montarHoje({ agora, tarefas: [{ id: 1, tipo: 'prazo', prazo_data: dia(1) }] });
  assert.deepEqual([r.fila[0].sugestao, r.fila[0].cumprir, r.resumo[0].com_peticao], [null, null, 0]);
});

test('fila de prazos: os 8 mais urgentes e, além deles, todo prazo com petição juntada', () => {
  const tarefas = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, tipo: 'prazo', descricao: `P${i + 1}`, prazo_data: dia(i) }));
  const avaliacoes = new Map([[2, { acao: 'sugerir', texto: 'Petição juntada em 24/11/2026' }], [11, { acao: 'sugerir', texto: 'Petição juntada em 25/11/2026' }]]);
  const r = montarHoje({ agora, tarefas, avaliacoes });
  assert.deepEqual(r.fila.map(i => i.titulo), ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P11']);
  assert.deepEqual([r.resumo[0].total, r.resumo[0].com_peticao], [12, 2]);
  assert.equal(POR_GRUPO, 8);
});

test('depois das 21h de Brasília ainda é o mesmo dia (o servidor em UTC já virou)', () => {
  const noite = new Date('2026-11-27T01:30:00Z'); // 22h30 de 26/11 em Brasília
  const r = montarHoje({ agora: noite, tarefas: [
    { id: 1, tipo: 'prazo', prazo_data: '2026-11-27' }, { id: 2, tipo: 'prazo', prazo_data: '2026-11-26' }, { id: 3, tipo: 'prazo', prazo_data: '2026-11-25' },
  ] });
  assert.deepEqual(r.fila.map(i => i.quando), ['venceu há 1 dia', 'vence hoje', 'vence amanhã']);
  assert.equal(r.resumo[0].nota, '1 vencido · 2 em 7 dias');
});
