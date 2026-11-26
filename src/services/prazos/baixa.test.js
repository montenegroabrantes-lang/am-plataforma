import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avaliarPrazo, avaliarTarefas, executarBaixaAutomatica, ehAudiencia, ehJuntadaDePeticao, TOLERANCIA_DIAS } from './baixa.js';

const hoje = new Date('2026-11-26T15:00:00Z');
const prazo = (descricao, prazo_data) => ({ descricao, prazo_data });

test('reconhece audiência e juntada de petição, com ou sem acento', () => {
  assert.equal(ehAudiencia('Audiência — 0800001-11.2026.8.15.2001'), true);
  assert.equal(ehAudiencia('AUDIENCIA de conciliação'), true);
  assert.equal(ehAudiencia('Prazo — Contestação'), false);
  assert.equal(ehJuntadaDePeticao('Juntada de Petição de petição'), true);
  assert.equal(ehJuntadaDePeticao('Petição — Contraminuta'), true);
  assert.equal(ehJuntadaDePeticao('Expedição de Outros documentos'), false);
});

test('audiência fecha sozinha só depois que a data passa', () => {
  const ontem = avaliarPrazo({ tarefa: prazo('Audiência — X', '2026-11-25'), hoje });
  assert.equal(ontem.acao, 'concluir');
  assert.equal(ontem.motivo, 'audiencia');
  assert.match(ontem.nota, /25\/11\/2026/);
  assert.equal(avaliarPrazo({ tarefa: prazo('Audiência — X', '2026-11-26'), hoje }).acao, 'nada');
  assert.equal(avaliarPrazo({ tarefa: prazo('Audiência — X', '2026-12-08'), hoje }).acao, 'nada');
});

test('audiência nunca vira sugestão, mesmo com petição juntada', () => {
  const r = avaliarPrazo({ tarefa: prazo('Audiência — X', '2026-12-08'), inicio: '2026-11-23', hoje,
    juntadas: [{ data: '2026-11-24', texto: 'Juntada de Petição de petição' }] });
  assert.equal(r.acao, 'nada');
});

test('petição juntada depois da publicação vira sugestão, nunca baixa', () => {
  const r = avaliarPrazo({ tarefa: prazo('Prazo — Contrarrazões', '2026-12-04'), inicio: '2026-11-23', hoje,
    juntadas: [{ data: '2026-11-24T13:00:00Z', texto: 'Juntada de Petição de petição' }, { data: '2026-11-25', texto: 'Juntada de Petição de petição' }] });
  assert.equal(r.acao, 'sugerir');
  assert.equal(r.texto, 'Petição juntada em 25/11/2026');
  assert.equal(r.quantas, 2);
});

test('juntada no mesmo dia da publicação, antes dela ou movimento que não é petição não contam', () => {
  const base = { tarefa: prazo('Prazo — Manifestação', '2026-12-04'), inicio: '2026-11-23', hoje };
  assert.equal(avaliarPrazo({ ...base, juntadas: [{ data: '2026-11-23', texto: 'Juntada de Petição de petição' }] }).acao, 'nada');
  assert.equal(avaliarPrazo({ ...base, juntadas: [{ data: '2026-11-10', texto: 'Juntada de Petição de petição' }] }).acao, 'nada');
  assert.equal(avaliarPrazo({ ...base, juntadas: [{ data: '2026-11-24', texto: 'Conclusos para despacho' }] }).acao, 'nada');
  assert.equal(avaliarPrazo({ ...base }).acao, 'nada');
});

test('juntada muito depois do prazo não conta', () => {
  const base = { tarefa: prazo('Prazo — Recurso', '2026-11-10'), inicio: '2026-10-20', hoje };
  assert.equal(avaliarPrazo({ ...base, juntadas: [{ data: '2026-11-15', texto: 'Juntada de Petição de recurso inominado' }] }).acao, 'sugerir');
  assert.equal(TOLERANCIA_DIAS, 5);
  assert.equal(avaliarPrazo({ ...base, juntadas: [{ data: '2026-11-16', texto: 'Juntada de Petição de recurso inominado' }] }).acao, 'nada');
});

test('peça nossa no acervo antes da juntada fecha o prazo sozinho', () => {
  const r = avaliarPrazo({ tarefa: prazo('Prazo — Impugnação', '2026-12-14'), inicio: '2026-11-12', hoje,
    juntadas: [{ data: '2026-11-17', texto: 'Juntada de Petição de petição' }],
    pecas: [{ titulo: 'Impugnação à contestação', tipo_peca: 'impugnacao-contestacao', criado_em: '2026-11-16T20:00:00Z' }] });
  assert.equal(r.acao, 'concluir');
  assert.equal(r.motivo, 'peca');
  assert.match(r.nota, /Impugnação à contestação.*17\/11\/2026/);
});

test('peça sem juntada posterior, peça anterior à publicação ou inicial não fecham', () => {
  const base = { tarefa: prazo('Prazo — Impugnação', '2026-12-14'), inicio: '2026-11-12', hoje, juntadas: [{ data: '2026-11-17', texto: 'Juntada de Petição de petição' }] };
  assert.equal(avaliarPrazo({ ...base, pecas: [{ titulo: 'A', tipo_peca: 'memorial', criado_em: '2026-11-20' }] }).acao, 'sugerir');
  assert.equal(avaliarPrazo({ ...base, pecas: [{ titulo: 'A', tipo_peca: 'memorial', criado_em: '2026-11-01' }] }).acao, 'sugerir');
  assert.equal(avaliarPrazo({ ...base, pecas: [{ titulo: 'A', tipo_peca: 'inicial', criado_em: '2026-11-13' }] }).acao, 'sugerir');
  assert.equal(avaliarPrazo({ ...base, juntadas: [], pecas: [{ titulo: 'A', tipo_peca: 'memorial', criado_em: '2026-11-13' }] }).acao, 'nada');
});

test('tarefa sem data de prazo não é avaliada', () => {
  assert.equal(avaliarPrazo({ tarefa: prazo('Prazo — X', null), inicio: '2026-11-12', hoje }).acao, 'nada');
});

function bancoFalso({ tarefas, juntadas = [], pecas = [] }) {
  const chamadas = [];
  return { chamadas,
    async query(sql, p) { chamadas.push({ sql: sql.replace(/\s+/g, ' ').trim(), p });
      if (sql.includes('FROM tarefas t')) return tarefas;
      if (sql.includes('FROM movimentacoes')) return juntadas;
      if (sql.includes('FROM acervo_pecas')) return pecas;
      throw new Error('consulta inesperada'); },
    async execute(sql, p) { chamadas.push({ sql: sql.replace(/\s+/g, ' ').trim(), p }); return { rowCount: 1 }; } };
}
const cenario = () => ({
  tarefas: [
    { id: 'aud-passada', descricao: 'Audiência — A', prazo_data: '2026-11-20', processo_id: 'p1', inicio: '2026-11-01' },
    { id: 'aud-futura', descricao: 'Audiência — B', prazo_data: '2026-12-08', processo_id: 'p2', inicio: '2026-11-23' },
    { id: 'sugestao', descricao: 'Prazo — Contrarrazões', prazo_data: '2026-12-04', processo_id: 'p3', inicio: '2026-11-23' },
    { id: 'com-peca', descricao: 'Prazo — Impugnação', prazo_data: '2026-12-14', processo_id: 'p4', inicio: '2026-11-12' },
    { id: 'sem-nada', descricao: 'Prazo — Recurso', prazo_data: '2026-11-30', processo_id: 'p5', inicio: '2026-11-12' },
    { id: 'sem-processo', descricao: 'Prazo — Petição', prazo_data: '2026-11-30', processo_id: null, inicio: '2026-11-12' },
  ],
  juntadas: [{ processo_id: 'p3', data: '2026-11-24', texto: 'Juntada de Petição de petição' }, { processo_id: 'p4', data: '2026-11-17', texto: 'Juntada de Petição de petição' },
    { processo_id: 'p2', data: '2026-11-24', texto: 'Juntada de Petição de petição' }],
  pecas: [{ processo_id: 'p4', titulo: 'Impugnação', tipo_peca: 'impugnacao-contestacao', criado_em: '2026-11-16' }],
});

test('avaliarTarefas cruza cada tarefa só com o próprio processo e não consulta audiências', async () => {
  const banco = bancoFalso(cenario());
  const r = await avaliarTarefas({ banco, tarefas: cenario().tarefas, hoje });
  assert.deepEqual([...r].map(([id, a]) => [id, a.acao]), [['aud-passada', 'concluir'], ['aud-futura', 'nada'], ['sugestao', 'sugerir'], ['com-peca', 'concluir'], ['sem-nada', 'nada'], ['sem-processo', 'nada']]);
  const mov = banco.chamadas.find(c => c.sql.includes('FROM movimentacoes'));
  assert.deepEqual(mov.p[0].sort(), ['p3', 'p4', 'p5']);
});

test('simulação não grava nada e diz o que faria', async () => {
  const banco = bancoFalso(cenario());
  const r = await executarBaixaAutomatica({ banco, agora: () => hoje, simular: true });
  assert.deepEqual({ abertas: r.abertas, audiencias: r.audiencias, com_peca: r.com_peca, sugeridas: r.sugeridas, concluidas: r.concluidas }, { abertas: 6, audiencias: 1, com_peca: 1, sugeridas: 1, concluidas: 0 });
  assert.equal(banco.chamadas.some(c => /^(UPDATE|INSERT)/.test(c.sql)), false);
});

test('execução conclui só as duas certas, anota o motivo, audita e não toca na agenda', async () => {
  const banco = bancoFalso(cenario());
  const r = await executarBaixaAutomatica({ banco, agora: () => hoje });
  assert.equal(r.concluidas, 2);
  const updates = banco.chamadas.filter(c => c.sql.startsWith('UPDATE tarefas'));
  assert.deepEqual(updates.map(u => u.p[0]), ['aud-passada', 'com-peca']);
  assert.match(updates[0].p[1], /data da audiência \(20\/11\/2026\) passou/);
  assert.match(updates[0].sql, /status = 'pendente' AND tipo = 'prazo'/);
  assert.equal(updates.some(u => /calendar_event_id/.test(u.sql)), false);
  const log = banco.chamadas.find(c => c.sql.startsWith('INSERT INTO logs_auditoria'));
  assert.equal(log.p[0], 'baixa_automatica_prazo');
  assert.equal(JSON.parse(log.p[3]).total, 2);
});

test('sem nada a concluir não grava nem audita', async () => {
  const banco = bancoFalso({ tarefas: [cenario().tarefas[4]] });
  const r = await executarBaixaAutomatica({ banco, agora: () => hoje });
  assert.equal(r.concluidas, 0);
  assert.equal(banco.chamadas.some(c => /^(UPDATE|INSERT)/.test(c.sql)), false);
});
