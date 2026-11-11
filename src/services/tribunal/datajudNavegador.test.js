import test from 'node:test';
import assert from 'node:assert/strict';

process.env.REDIS_URL = 'redis://127.0.0.1:1';
process.env.DATAJUD_TRIBUNAIS_IGNORADOS = 'TJPB';
const { gerarTarefa, receberResultado, criarTransporte, montarConsultas } = await import('./datajudNavegador.js');
const datajud = await import('./datajud.js');
const { redis } = await import('../../cache/redis.js');
redis.disconnect?.();

const N1 = '08000011220264058200';
const N2 = '08000021220264058200';

function bancoFalso({ ultima = null, processos = [] } = {}) {
  return {
    async queryOne() { return { em: ultima }; },
    async query() { return processos; },
  };
}
function cacheFalso() {
  const m = new Map();
  return {
    m,
    async set(k, v, _ex, _s, nx) { if (nx && m.has(k)) return null; m.set(k, v); return 'OK'; },
    async get(k) { return m.get(k) ?? null; },
    async del(k) { m.delete(k); return 1; },
  };
}

test('monta consultas só dos tribunais fora do TJPB, com número CNJ válido', async () => {
  const consultas = await montarConsultas(bancoFalso({ processos: [
    { numero: '0800001-12.2026.4.05.8200', tribunal: 'TRF5' },
    { numero: '0800002-12.2026.8.15.2001', tribunal: 'TJPB' },
    { numero: '123', tribunal: 'TRF1' },
  ] }));
  assert.equal(consultas.length, 1);
  assert.equal(consultas[0].indice, 'api_publica_trf5');
  assert.deepEqual(consultas[0].corpo.query.terms.numeroProcesso, ['08000011220264058200']);
});

test('tarefa: não repete antes de 12 h e só uma máquina por vez', async () => {
  const processos = [{ numero: '0800001-12.2026.4.05.8200', tribunal: 'TRF5' }];
  const agora = new Date('2026-11-11T20:00:00Z');
  const recente = await gerarTarefa({ banco: bancoFalso({ ultima: new Date('2026-11-11T19:00:00Z'), processos }), cache: cacheFalso(), agora });
  assert.equal(recente.tarefa, null);
  assert.equal(recente.motivo, 'recente');

  const cache = cacheFalso();
  const banco = bancoFalso({ ultima: new Date('2026-11-10T19:00:00Z'), processos });
  const t1 = await gerarTarefa({ banco, cache, agora });
  assert.ok(t1.tarefa.token);
  assert.equal(t1.tarefa.base, datajud.BASE);
  assert.equal(t1.tarefa.consultas.length, 1);
  const t2 = await gerarTarefa({ banco, cache, agora });
  assert.equal(t2.tarefa, null);
  assert.equal(t2.motivo, 'em_andamento');
});

test('transporte: entrega só os números pedidos; falha vira status de erro', async () => {
  const hit = n => ({ _source: { numeroProcesso: n, movimentos: [] } });
  const t = criarTransporte([
    { indice: 'api_publica_trf5', status: 200, data: { hits: { hits: [hit(N1), hit('99999999999999999999')] } } },
    { indice: 'api_publica_trf1', status: 429, data: null },
    { indice: 'api_publica_trf3', status: 200, data: { hits: { hits: [hit(N2)] } } },
  ], { api_publica_trf5: [N1], api_publica_trf1: [N2] });
  const r5 = await t.post('api_publica_trf5', { query: { terms: { numeroProcesso: [N1] } } });
  assert.equal(r5.status, 200);
  assert.deepEqual(r5.data.hits.hits.map(h => h._source.numeroProcesso), [N1]);
  assert.equal((await t.post('api_publica_trf1', { query: { terms: { numeroProcesso: [N2] } } })).status, 429);
  assert.equal((await t.post('api_publica_trf3', { query: { terms: { numeroProcesso: [N2] } } })).status, 503, 'índice não pedido é ignorado');
});

test('transporte dentro da execução: consultarPorNumeros lê das respostas, sem rede e sem espera', async () => {
  const t = criarTransporte([{ indice: 'api_publica_trf5', status: 200, data: { hits: { hits: [{ _source: { numeroProcesso: N1, dataHoraUltimaAtualizacao: '2026-11-10T10:00:00', movimentos: [{ nome: 'Conclusos para julgamento', dataHora: '2026-11-10T10:00:00' }] } }] } } }],
    { api_publica_trf5: [N1, N2] });
  const r = await datajud.comTransporte(t, () => datajud.consultarPorNumeros('TRF5', [N1, N2]));
  assert.equal(r.encontrados.size, 1);
  assert.equal(r.encontrados.get(N1).movimentacoes[0].texto, 'Conclusos para julgamento');
  const falha = criarTransporte([{ indice: 'api_publica_trf5', status: 429, data: null }], { api_publica_trf5: [N1] });
  await assert.rejects(datajud.comTransporte(falha, () => datajud.consultarPorNumeros('TRF5', [N1])), /429/);
});

test('resultado: só aceita o token da tarefa reservada e roda o sync com o transporte', async () => {
  const cache = cacheFalso();
  await cache.set('datajud:navegador:reserva', JSON.stringify({ token: 'tk', pedidos: { api_publica_trf5: [N1] } }), 'EX', 900, 'NX');
  assert.equal((await receberResultado({ token: 'outro', respostas: [] }, { cache })).aceito, false);
  let chamou = null;
  const r = await receberResultado({ token: 'tk', respostas: [{ indice: 'api_publica_trf5', status: 200, data: { hits: { hits: [] } } }] },
    { cache, sincronizar: async () => { chamou = await datajud.transporte.post('api_publica_trf5', { query: { terms: { numeroProcesso: [N1] } } }); return []; } });
  assert.equal(r.aceito, true);
  await new Promise(res => setTimeout(res, 20));
  assert.equal(chamou.status, 200);
  assert.equal(await cache.get('datajud:navegador:reserva'), null, 'reserva liberada');
});
