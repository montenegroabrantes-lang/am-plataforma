import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  transporte,
  consultarPorNumeros,
  consultarProcesso,
  ErroDataJud,
  dividirEmLotes,
  instanteDataJud,
  lerTamanhoLote,
  TAMANHO_LOTE,
} from './datajud.js';

// Nenhuma rede: `transporte.post` (a única saída HTTP) e `transporte.esperar` (o único atraso) são dublês.
mock.method(console, 'log',  () => {});
mock.method(console, 'warn', () => {});

const postOriginal    = transporte.post;
const esperarOriginal = transporte.esperar;
let chamadas;
let esperas;

// `respostas`: fila consumida em ordem. Cada item é { status, data, headers } ou um Error (falha de rede/timeout).
// Depois da fila, repete o último item.
function fingirApi(respostas) {
  chamadas = [];
  esperas  = [];
  const fila = [...respostas];
  transporte.post = async (indice, body) => {
    chamadas.push({ indice, body });
    const r = fila.length > 1 ? fila.shift() : fila[0];
    if (typeof r === 'function') return r(body);
    if (r instanceof Error) throw r;
    return r;
  };
  transporte.esperar = async (ms) => { esperas.push(ms); };
}
afterEach(() => { transporte.post = postOriginal; transporte.esperar = esperarOriginal; });

const numero = (i) => `${String(i).padStart(7, '0')}9920268150001`;   // 20 dígitos, fictício

function doc(n, { atualizado = '2026-09-29T10:00:00.000Z', movimentos, vara = 'Vara Fictícia' } = {}) {
  return {
    _source: {
      numeroProcesso: n,
      dataHoraUltimaAtualizacao: atualizado,
      classe: { codigo: 12078, nome: 'Cumprimento de Sentença' },
      orgaoJulgador: { nome: vara, codigoMunicipioIBGE: 2507507 },
      movimentos: movimentos ?? [{ codigo: 26, nome: 'Distribuição do processo', dataHora: '2026-09-01T10:00:00.000Z' }],
    },
  };
}
const ok  = (hits, extra = {}) => ({ status: 200, data: { hits: { total: { value: hits.length }, hits }, ...extra } });
const http = (status, data = {}, headers = {}) => ({ status, data, headers });
const erroRede = (code, message) => Object.assign(new Error(message), { code });

// ── utilitários ──────────────────────────────────────────────────────────────

test('dividirEmLotes: 250 números viram lotes de 100, 100 e 50; lista vazia não gera lote', () => {
  const lotes = dividirEmLotes(Array.from({ length: 250 }, (_, i) => i));
  assert.deepEqual(lotes.map(l => l.length), [100, 100, 50]);
  assert.equal(TAMANHO_LOTE, 100);
  assert.deepEqual(dividirEmLotes([]), []);
});

test('lerTamanhoLote: padrão 100; DATAJUD_TAMANHO_LOTE só vale entre 10 e 200 (valor absurdo não derruba o sync)', () => {
  assert.equal(lerTamanhoLote(undefined), 100);
  assert.equal(lerTamanhoLote(''), 100);
  assert.equal(lerTamanhoLote('50'), 50);
  assert.equal(lerTamanhoLote('200'), 200);
  assert.equal(lerTamanhoLote('0'), 100);
  assert.equal(lerTamanhoLote('5'), 100);
  assert.equal(lerTamanhoLote('100000'), 100);
  assert.equal(lerTamanhoLote('abc'), 100);
  assert.equal(lerTamanhoLote('12.5'), 100);
});

test('instanteDataJud: ISO com Z, ISO sem fuso (vale UTC), formato compacto e lixo', () => {
  assert.equal(instanteDataJud('2026-09-29T10:00:00.000Z').toISOString(), '2026-09-29T10:00:00.000Z');
  assert.equal(instanteDataJud('2026-09-29T10:00:00').toISOString(), '2026-09-29T10:00:00.000Z');
  assert.equal(instanteDataJud('20260929100000').toISOString(), '2026-09-29T10:00:00.000Z');
  assert.equal(instanteDataJud('20260929100000123').toISOString(), '2026-09-29T10:00:00.123Z');
  assert.equal(instanteDataJud(null), null);
  assert.equal(instanteDataJud(''), null);
  assert.equal(instanteDataJud('não é data'), null);
});

// ── consulta por números ─────────────────────────────────────────────────────

test('consulta em lote: terms em numeroProcesso, no índice do tribunal, sem filtro de data (não varre o tribunal)', async () => {
  fingirApi([ok([])]);
  await consultarPorNumeros('TJPB', [numero(1), numero(2), numero(2)]);   // repetido some
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].indice, 'api_publica_tjpb');
  assert.deepEqual(chamadas[0].body.query, { terms: { numeroProcesso: [numero(1), numero(2)] } });
  assert.doesNotMatch(JSON.stringify(chamadas[0].body), /range|dataHoraUltimaAtualizacao/);
});

test('sucesso: devolve os processos encontrados, hits, status 200 e a marca de atualização; ignora número que não pedimos', async () => {
  fingirApi([ok([doc(numero(1)), doc(numero(2), { atualizado: '2026-09-30T08:00:00.000Z' }), doc(numero(99))])]);
  const r = await consultarPorNumeros('TJPB', [numero(1), numero(2), numero(3)]);
  assert.deepEqual([...r.encontrados.keys()].sort(), [numero(1), numero(2)]);   // 99 não foi pedido; 3 o DataJud não tem
  assert.equal(r.hits, 3);
  assert.equal(r.status, 200);
  assert.equal(r.falharam.size, 0);
  assert.equal(r.encontrados.get(numero(2)).atualizadoEm.toISOString(), '2026-09-30T08:00:00.000Z');
  assert.equal(r.encontrados.get(numero(1)).dados.vara, 'Vara Fictícia');
  assert.equal(r.encontrados.get(numero(1)).movimentacoes.length, 1);
});

test('mesmo número em mais de um documento (graus): vence o atualizado mais recentemente', async () => {
  fingirApi([ok([
    doc(numero(1), { atualizado: '2026-09-01T00:00:00.000Z', vara: 'Antiga' }),
    doc(numero(1), { atualizado: '2026-09-20T00:00:00.000Z', vara: 'Recente' }),
    doc(numero(1), { atualizado: '2026-09-10T00:00:00.000Z', vara: 'Meio' }),
  ])]);
  const r = await consultarPorNumeros('TJPB', [numero(1)]);
  assert.equal(r.encontrados.get(numero(1)).dados.vara, 'Recente');
});

test('lista vazia não chama a API', async () => {
  fingirApi([ok([])]);
  const r = await consultarPorNumeros('TJPB', []);
  assert.equal(chamadas.length, 0);
  assert.equal(r.encontrados.size, 0);
});

test('tribunal sem índice mapeado é falha (ErroDataJud), não "nada mudou"', async () => {
  fingirApi([ok([])]);
  await assert.rejects(consultarPorNumeros('TRIBUNAL_INEXISTENTE', [numero(1)]), ErroDataJud);
  assert.equal(chamadas.length, 0);
});

// ── 429, 5xx e timeout são FALHA ─────────────────────────────────────────────

test('429 na 1ª página, sempre: NÃO devolve mapa vazio ("nada mudou") — lança ErroDataJud com o status, após 4 tentativas e esperas crescentes', async () => {
  fingirApi([http(429, { error: 'Too Many Requests' })]);
  await assert.rejects(consultarPorNumeros('TJPB', [numero(1)]), (err) => {
    assert.ok(err instanceof ErroDataJud);
    assert.equal(err.status, 429);
    assert.equal(err.tentativas, 4);
    assert.match(err.message, /HTTP 429/);
    return true;
  });
  assert.equal(chamadas.length, 4, 'termina: não repete a mesma página indefinidamente');
  assert.deepEqual(esperas, [5_000, 15_000, 45_000]);
});

test('429 duas vezes e depois 200: captura normalmente (a nova tentativa resolve)', async () => {
  fingirApi([http(429), http(429), ok([doc(numero(1))])]);
  const r = await consultarPorNumeros('TJPB', [numero(1)]);
  assert.equal(r.encontrados.size, 1);
  assert.equal(r.tentativas, 3);
  assert.equal(r.status, 200);
  assert.deepEqual(esperas, [5_000, 15_000]);
});

test('5xx é falha com nova tentativa; sem sucesso, lança com o último status', async () => {
  fingirApi([http(503), http(502), http(500)]);
  await assert.rejects(consultarPorNumeros('TJPB', [numero(1)]), (err) => err.status === 500 && err.tentativas === 4);
  assert.equal(chamadas.length, 4);
});

test('timeout e erro de rede: nova tentativa; sem resposta nenhuma, lança sem status e nomeia o motivo', async () => {
  fingirApi([erroRede('ECONNABORTED', 'timeout of 35000ms exceeded')]);
  await assert.rejects(consultarPorNumeros('TJPB', [numero(1)]), (err) => {
    assert.ok(err instanceof ErroDataJud);
    assert.equal(err.status, null);
    assert.match(err.message, /timeout/);
    return true;
  });
  assert.equal(chamadas.length, 4);
});

test('erro de rede que se resolve na 2ª tentativa: sucesso', async () => {
  fingirApi([erroRede('ECONNRESET', 'socket hang up'), ok([doc(numero(1))])]);
  const r = await consultarPorNumeros('TJPB', [numero(1)]);
  assert.equal(r.encontrados.size, 1);
  assert.equal(r.tentativas, 2);
});

test('erro que não adianta repetir (403, chave inválida): 1 tentativa só, sem espera', async () => {
  fingirApi([http(403, { error: 'Forbidden' })]);
  await assert.rejects(consultarPorNumeros('TJPB', [numero(1)]), (err) => err.status === 403 && err.tentativas === 1);
  assert.equal(chamadas.length, 1);
  assert.deepEqual(esperas, []);
});

test('respeita o Retry-After do servidor (com teto de 2 min)', async () => {
  fingirApi([http(429, {}, { 'retry-after': '30' }), http(429, {}, { 'retry-after': '99999' }), ok([])]);
  await consultarPorNumeros('TJPB', [numero(1)]);
  assert.deepEqual(esperas, [30_000, 120_000]);
});

test('429 que ainda traz processos no corpo: aproveita os que vieram e marca os que faltam como FALHA (não "não existe")', async () => {
  fingirApi([http(429, { hits: { hits: [doc(numero(1))] } })]);
  const r = await consultarPorNumeros('TJPB', [numero(1), numero(2)]);
  assert.deepEqual([...r.encontrados.keys()], [numero(1)]);
  assert.deepEqual([...r.falharam], [numero(2)]);
  assert.equal(r.status, 429);
  assert.equal(chamadas.length, 4, 'ainda tentou de novo antes de aceitar o parcial');
});

test('resposta 200 cortada (total maior que os hits devolvidos) é falha, não "não achei"', async () => {
  fingirApi([{ status: 200, data: { hits: { total: { value: 150 }, hits: [doc(numero(1))] } } }]);
  await assert.rejects(consultarPorNumeros('TJPB', [numero(1)]), (err) => err instanceof ErroDataJud && /incompleta/.test(err.message));
});

// ── fallback quando a API recusa o lote ──────────────────────────────────────

test('HTTP 400 no lote (terms recusado): cai na consulta por número, e o que falha individualmente vira "falharam"', async () => {
  fingirApi([(body) => {
    if (body.query.terms) return http(400, { error: 'bad request' });
    const n = body.query.match.numeroProcesso;
    if (n === numero(3)) return http(503);
    if (n === numero(2)) return ok([]);                 // o DataJud não tem: não é falha
    return ok([doc(n)]);
  }]);
  const r = await consultarPorNumeros('TJPB', [numero(1), numero(2), numero(3)]);
  assert.equal(r.metodo, 'match');
  assert.deepEqual([...r.encontrados.keys()], [numero(1)]);
  assert.deepEqual([...r.falharam], [numero(3)]);
  assert.equal(chamadas[0].body.query.terms !== undefined, true, 'tentou o lote primeiro');
  assert.equal(chamadas.filter(c => c.body.query.match).length, 3 + 3, '3 números; o 503 foi repetido (4 tentativas)');
});

test('HTTP 400 e a consulta por número também falha para todos: lança (não devolve tudo como "não encontrado")', async () => {
  fingirApi([(body) => (body.query.terms ? http(400) : http(503))]);
  await assert.rejects(consultarPorNumeros('TJPB', [numero(1), numero(2)]), (err) => err instanceof ErroDataJud && err.status === 503);
});

// ── consulta individual continua funcionando pelo mesmo transporte ──────────

test('consultarProcesso (sync individual): 429 sem dados e depois o processo — usa o transporte e a espera injetáveis', async () => {
  fingirApi([http(429), ok([doc(numero(1))])]);
  const r = await consultarProcesso('TJPB', '0000001-99.2026.8.15.0001');
  assert.equal(r.dados.vara, 'Vara Fictícia');
  assert.equal(r.atualizadoEm.toISOString(), '2026-09-29T10:00:00.000Z');
  assert.deepEqual(esperas, [5_000]);
  assert.deepEqual(chamadas[0].body.query, { match: { numeroProcesso: numero(1) } });
});
