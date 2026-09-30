import test, { after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// sync.js importa o cliente Redis, que conecta ao ser importado. Aponta para uma porta local
// fechada (nenhuma rede real) e desconecta no fim; tudo que o sync usa (db, redis) é trocado por
// dublês em cada teste, então não existe banco nem Redis de verdade aqui.
process.env.REDIS_URL = 'redis://127.0.0.1:1';
const { db }     = await import('../../db/index.js');
const { redis }  = await import('../../cache/redis.js');
const { sincronizarTodos } = await import('./sync.js');
const { SCRIPT_LIBERAR }   = await import('./syncLock.js');

const avisos = [];
mock.method(console, 'log',   () => {});
mock.method(console, 'warn',  (...a) => { avisos.push(a.join(' ')); });
mock.method(console, 'error', (...a) => { avisos.push(a.join(' ')); });
after(() => redis.disconnect());

let chamadas;      // tudo que passou por db.*
let locksLiberados;

function prepararDubles({ processos = [], insertFalha = false, lockAtivo = false } = {}) {
  chamadas = [];
  locksLiberados = [];
  avisos.length = 0;
  db.queryOne = async (sql, params) => {
    chamadas.push({ sql, params });
    if (/FROM sync_execucoes/.test(sql)) return null;                  // nunca sincronizou
    if (/INSERT INTO sync_execucoes/.test(sql)) {
      if (insertFalha) throw new Error('permission denied for table sync_execucoes');
      return { id: 'exec-1' };
    }
    throw new Error(`queryOne inesperada: ${sql}`);
  };
  db.query = async (sql, params) => {
    chamadas.push({ sql, params });
    if (/FROM processos/.test(sql)) return processos;
    throw new Error(`query inesperada: ${sql}`);
  };
  db.execute = async (sql, params) => { chamadas.push({ sql, params }); return { rowCount: 1 }; };
  // Lock com dono (R-06): pegar = SET NX; liberar = script de comparar-e-apagar (eval), que registramos.
  redis.set  = async () => (lockAtivo ? null : 'OK');
  redis.eval = async (script, _n, chave) => { if (script === SCRIPT_LIBERAR) locksLiberados.push(chave); return 1; };
}

const fechamentos = () => chamadas.filter(c => /UPDATE sync_execucoes/.test(c.sql));
// Os 5 primeiros parâmetros do fechamento (viaDatajud, falhas, novas, erro, id no fim); as métricas do R-06 vêm no meio
const semMetricas = (params) => [...params.slice(0, 4), params[params.length - 1]];

beforeEach(() => prepararDubles());

test('erro fatal ANTES de registrar a execução: sobe o erro REAL (não ReferenceError) e libera o lock', async () => {
  // número nulo estoura em p.numero.replace(), depois do lock e antes do INSERT em sync_execucoes
  prepararDubles({ processos: [{ id: 1, numero: null, tribunal: 'TJPB' }] });
  await assert.rejects(sincronizarTodos(), (err) => {
    assert.ok(!(err instanceof ReferenceError), `esperava o erro real, veio: ${err.name}: ${err.message}`);
    assert.ok(err instanceof TypeError);
    return true;
  });
  assert.equal(fechamentos().length, 0);                       // não havia linha para fechar
  assert.deepEqual(locksLiberados, ['sync:global:lock']);
});

test('erro fatal DEPOIS de registrar a execução: fecha a linha com falhas>=1 e a causa (sem dado pessoal)', async () => {
  // 1ª leitura de .tribunal (montar a lista) passa; a 2ª (filtro por tribunal, já com a execução
  // aberta) estoura -- simula um erro inesperado dentro do laço, fora dos try/catch internos.
  let leituras = 0;
  const processo = {
    id: 1,
    numero: '0801234-56.2024.8.15.0001',
    get tribunal() {
      if (++leituras > 1) throw new Error('falha inesperada para joao@exemplo.com CPF 123.456.789-09');
      return 'TJPB';
    },
  };
  prepararDubles({ processos: [processo] });

  await assert.rejects(sincronizarTodos(), (err) => {
    assert.ok(!(err instanceof ReferenceError), 'o catch não pode mascarar o erro real com ReferenceError');
    assert.match(err.message, /falha inesperada/);
    return true;
  });

  const [fechamento, ...outros] = fechamentos();
  assert.equal(outros.length, 0, 'fecha uma única vez');
  assert.match(fechamento.sql, /concluido_em = NOW\(\)/);
  const [viaDatajud, falhas, novas, erro] = fechamento.params;
  const id = fechamento.params[fechamento.params.length - 1];
  assert.equal(id, 'exec-1');
  assert.equal(viaDatajud, 0);
  assert.ok(falhas >= 1, `falhas=${falhas}`);
  assert.equal(novas, 0);
  assert.match(erro, /falha inesperada/);
  assert.doesNotMatch(erro, /joao@|123\.456\.789/);            // mensagem gravada sem dado pessoal
  assert.deepEqual(locksLiberados, ['sync:global:lock']);
});

test('execução normal (nada a sincronizar): fecha sem erro e com falhas 0', async () => {
  prepararDubles({ processos: [] });
  const resultados = await sincronizarTodos();
  assert.deepEqual(resultados, []);
  const [fechamento, ...outros] = fechamentos();
  assert.equal(outros.length, 0);
  assert.deepEqual(semMetricas(fechamento.params), [0, 0, 0, null, 'exec-1']);
  // R-06: sem nenhuma resposta do DataJud, status_http fica nulo e hits/casados zerados
  assert.deepEqual(fechamento.params.slice(4, 7), [null, 0, 0]);
  assert.match(fechamento.sql, /status_http = \$5, hits = \$6, casados = \$7/);
  assert.deepEqual(locksLiberados, ['sync:global:lock']);
});

test('tribunal com falha (não é erro fatal): fecha com falhas=1 e sem erro, e devolve o resultado', async () => {
  prepararDubles({ processos: [{ id: 7, numero: '0801234-56.2024.8.15.0001', tribunal: 'TRIBUNAL_INEXISTENTE' }] });
  const resultados = await sincronizarTodos();
  assert.equal(resultados.length, 1);
  assert.equal(resultados[0].ok, false);
  const [fechamento] = fechamentos();
  assert.deepEqual(semMetricas(fechamento.params), [0, 1, 0, null, 'exec-1']);
});

test('INSERT da execução falha: o sync segue, avisa no log e não tenta fechar linha inexistente', async () => {
  prepararDubles({ processos: [], insertFalha: true });
  const resultados = await sincronizarTodos();
  assert.deepEqual(resultados, []);
  assert.equal(fechamentos().length, 0);
  assert.ok(avisos.some(a => /não registrada em sync_execucoes.*permission denied/.test(a)), avisos.join('\n'));
});

test('R-06: não há janela por data — o ponto de partida é a marca de cada processo, e nenhuma execução (nem a com falha) o move', async () => {
  prepararDubles({ processos: [] });
  await sincronizarTodos();
  // Antes: "último concluido_em - 4h" avançava até com falha. Agora nada disso é consultado...
  assert.equal(chamadas.some(c => /SELECT concluido_em FROM sync_execucoes/.test(c.sql)), false);
  // ...e a lista de processos traz a marca de cada um, os nunca capturados primeiro.
  const consulta = chamadas.find(c => /FROM processos/.test(c.sql));
  assert.match(consulta.sql, /datajud_atualizado_em/);
  assert.match(consulta.sql, /ORDER BY datajud_atualizado_em ASC NULLS FIRST/);
});

test('lock ativo: não faz nada (nem abre execução) e não libera o lock de quem está rodando', async () => {
  prepararDubles({ lockAtivo: true });
  const r = await sincronizarTodos();
  assert.equal(r.ignorado, true);
  assert.equal(chamadas.length, 0);
  assert.deepEqual(locksLiberados, []);
});
