import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarLeitura, criarGravacaoSegundoGrau, criarBaseSegundoGrau, PREFIXO_RECURSO, MAX_PRECATORIOS } from './segundoGrau.js';

const P1 = '0800450-08.2026.8.15.0000', P2 = '0801544-88.2026.8.15.0000', R1 = '0863208-68.2025.8.15.2001';
const corpo = () => ({ executada_em: '2026-11-27T12:00:00Z',
  precatorios: [
    { numero: P1, acessivel: true, classe: 'PRECATÓRIO (1265)', orgao: 'Precatórios', relator: 'Fulano',
      andamentos: [{ data: '2026-06-11', texto: '  JUNTADA DE   PETIÇÃO DE PETIÇÃO ' }, { data: '2026-06-11', texto: 'JUNTADA DE PETIÇÃO DE PETIÇÃO' }, { data: '11/06/2026', texto: 'data torta' }, { data: '2026-05-29', texto: '' }] },
    { numero: P2, acessivel: false, andamentos: [{ data: '2026-01-01', texto: 'não deveria entrar' }] },
  ],
  recursos: [{ numero: R1, andamentos: [{ data: '2026-11-26', texto: 'CONCLUSOS PARA DESPACHO' }] }] });

test('valida e normaliza: tira repetição, descarta andamento torto e ignora andamentos de quem não abriu', () => {
  const d = validarLeitura(corpo());
  assert.equal(d.erro, undefined);
  assert.deepEqual(d.precatorios[0].andamentos, [{ data: '2026-06-11', texto: 'JUNTADA DE PETIÇÃO DE PETIÇÃO' }]);
  assert.deepEqual([d.precatorios[1].acessivel, d.precatorios[1].andamentos], [false, []]);
  assert.equal(d.recursos[0].numero, R1);
});

test('recusa corpo inválido', () => {
  assert.match(validarLeitura(null).erro, /Corpo/);
  assert.match(validarLeitura({ precatorios: [] }).erro, /executada_em/);
  assert.match(validarLeitura({ executada_em: 'x', precatorios: [] }).erro, /executada_em/);
  assert.match(validarLeitura({ executada_em: '2026-11-27', precatorios: 'x' }).erro, /listas/);
  assert.match(validarLeitura({ executada_em: '2026-11-27', precatorios: [{ numero: '123', acessivel: true }] }).erro, /número inválido/);
  assert.match(validarLeitura({ executada_em: '2026-11-27', precatorios: [{ numero: P1 }] }).erro, /acessivel/);
  assert.match(validarLeitura({ executada_em: '2026-11-27', recursos: [{ numero: 'abc' }] }).erro, /Recurso 1/);
  assert.match(validarLeitura({ executada_em: '2026-11-27', precatorios: Array(MAX_PRECATORIOS + 1).fill({ numero: P1, acessivel: true }) }).erro, /No máximo/);
});

function ambiente({ fichas, processos }) {
  const chamadas = [], auditorias = [];
  const tx = {
    async query(sql, p) { chamadas.push({ sql: sql.replace(/\s+/g, ' ').trim(), p }); return sql.includes('FROM precatorios') ? fichas : processos; },
    async queryOne(sql, p) { chamadas.push({ sql: sql.replace(/\s+/g, ' ').trim(), p }); return { id: 'v1' }; },
    async execute(sql, p) { chamadas.push({ sql: sql.replace(/\s+/g, ' ').trim(), p }); return { rowCount: sql.includes('INSERT INTO precatorio_andamentos') || sql.includes('INSERT INTO movimentacoes') ? 1 : 1 }; },
  };
  const conexao = { transaction: async fn => fn(tx) };
  const res = { codigo: 200, corpo: null, status(c) { this.codigo = c; return this; }, json(c) { this.corpo = c; return this; } };
  return { chamadas, auditorias, conexao, res, auditar: async (a) => { auditorias.push(a); } };
}

test('grava: marca acesso, libera a habilitação, guarda andamentos e movimentos do recurso, e audita', async () => {
  const a = ambiente({ fichas: [{ id: 'f1', numero: P1, habilitacao_ramon: 'protocolada' }, { id: 'f2', numero: P2, habilitacao_ramon: 'protocolada' }], processos: [{ id: 'proc1', numero: R1 }] });
  await criarGravacaoSegundoGrau(a.conexao, { auditar: a.auditar })({ body: corpo(), integracao: { id: 'chave1' } }, a.res);
  assert.equal(a.res.codigo, 200);
  assert.deepEqual({ ...a.res.corpo, varredura_id: undefined, ok: undefined }, { varredura_id: undefined, ok: undefined, precatorios_lidos: 1, precatorios_sem_acesso: 1,
    andamentos_de_precatorio: 1, habilitacoes_liberadas: 1, recursos_lidos: 1, movimentacoes_de_recurso: 1, ignorados: 0 });
  const acessos = a.chamadas.filter(c => c.sql.startsWith('UPDATE precatorios SET pje_acesso'));
  assert.deepEqual(acessos.map(c => [c.p[0], c.p[1]]), [['f1', 'ok'], ['f2', 'sem_acesso']]);
  const habil = a.chamadas.filter(c => c.sql.includes("habilitacao_ramon = 'habilitado'"));
  assert.deepEqual(habil.map(c => c.p[0]), ['f1']);
  assert.ok(a.chamadas.some(c => c.sql.startsWith('INSERT INTO precatorio_eventos') && c.p[1] === 'protocolada'));
  const and = a.chamadas.filter(c => c.sql.startsWith('INSERT INTO precatorio_andamentos'));
  assert.equal(and.length, 1);
  assert.match(and[0].sql, /ON CONFLICT \(precatorio_id, data, texto\) DO NOTHING/);
  const mov = a.chamadas.find(c => c.sql.startsWith('INSERT INTO movimentacoes'));
  assert.deepEqual(JSON.parse(mov.p[1]), [{ data: '2026-11-26', texto: `${PREFIXO_RECURSO}CONCLUSOS PARA DESPACHO` }]);
  assert.match(mov.sql, /'pje_2g'.*ON CONFLICT DO NOTHING/);
  assert.deepEqual([a.auditorias[0].acao, a.auditorias[0].valorDepois.chave_id], ['gravar_varredura_2grau', 'chave1']);
});

test('quem já estava habilitado não gera evento; número que o sistema não conhece é ignorado', async () => {
  const a = ambiente({ fichas: [{ id: 'f1', numero: P1, habilitacao_ramon: 'habilitado' }], processos: [] });
  await criarGravacaoSegundoGrau(a.conexao, { auditar: a.auditar })({ body: corpo() }, a.res);
  assert.equal(a.res.corpo.habilitacoes_liberadas, 0);
  assert.equal(a.res.corpo.ignorados, 2);
  assert.equal(a.chamadas.some(c => c.sql.startsWith('INSERT INTO precatorio_eventos')), false);
  assert.equal(a.chamadas.some(c => c.sql.startsWith('INSERT INTO movimentacoes')), false);
});

test('corpo inválido devolve 400 sem tocar no banco; falha do banco devolve 500', async () => {
  const a = ambiente({ fichas: [], processos: [] });
  await criarGravacaoSegundoGrau(a.conexao, { auditar: a.auditar })({ body: {} }, a.res);
  assert.equal(a.res.codigo, 400);
  assert.equal(a.chamadas.length, 0);
  const res = { status(c) { this.codigo = c; return this; }, json(c) { this.corpo = c; return this; } };
  await criarGravacaoSegundoGrau({ transaction: async () => { throw new Error('caiu'); } }, { auditar: a.auditar })({ body: corpo() }, res);
  assert.equal(res.codigo, 500);
});

test('base: devolve só os números, de precatórios e de recursos ativos', async () => {
  const res = { json(c) { this.corpo = c; } };
  const consultas = [];
  await criarBaseSegundoGrau({ query: async sql => { consultas.push(sql.replace(/\s+/g, ' ')); return sql.includes('FROM precatorios') ? [{ numero: P1 }] : [{ numero: R1 }]; } })({}, res);
  assert.deepEqual(res.corpo, { ok: true, precatorios: [P1], recursos: [R1] });
  assert.match(consultas[1], /status = 'ativo'.*em_recurso/);
});
