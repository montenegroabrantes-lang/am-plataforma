import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getNextMillis } from 'bullmq';
import { AGENDA, TZ_ESCRITORIO, removerAgendamentosAntigos, descreverAgendamentos, lerRepetivel } from './agendamentos.js';

// Nada aqui usa Redis: getNextMillis é a MESMA função que o BullMQ usa para decidir a próxima
// execução de um repeatable; a fila é um dublê.
//
// Sem `tz`, o BullMQ usa o fuso do PROCESSO — em produção (Railway) é UTC; num Mac de Brasília seria
// Brasília. Por isso o "antes" dos testes abaixo diz `tz: 'UTC'` explicitamente: simula o servidor
// e faz o teste passar em qualquer máquina (rodar com TZ=UTC e TZ=America/Sao_Paulo dá o mesmo).
const ANTES = pattern => ({ pattern, tz: 'UTC' });

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

// Instante → { data, hora, dia } no relógio de Brasília.
function emBrasilia(ms) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ_ESCRITORIO, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
    }).formatToParts(new Date(ms)).map(x => [x.type, x.value]),
  );
  const dia = { Sun: 'dom', Mon: 'seg', Tue: 'ter', Wed: 'qua', Thu: 'qui', Fri: 'sex', Sat: 'sáb' }[p.weekday];
  return { data: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}`, dia };
}

// As próximas `n` execuções a partir de `inicioIso`, como o BullMQ as calcularia.
function proximas(repeat, inicioIso, n) {
  const saida = [];
  let ms = new Date(inicioIso).getTime();
  for (let i = 0; i < n; i++) {
    ms = getNextMillis(ms, { ...repeat });
    saida.push({ ms, ...emBrasilia(ms) });
  }
  return saida;
}

// Quarta-feira 30/09/2026, 09:00 em Brasília.
const INICIO = '2026-09-30T12:00:00Z';

test('todo agendamento dependente de relógio tem tz America/Sao_Paulo', () => {
  for (const [nome, repeat] of Object.entries(AGENDA)) {
    assert.equal(repeat.tz, 'America/Sao_Paulo', `${nome} sem tz de Brasília`);
  }
});

test('sem tz o BullMQ roda em UTC: o "8h" antigo saía às 05h de Brasília (o defeito A5-03)', () => {
  const antigo = proximas(ANTES('0 8 * * *'), INICIO, 1)[0];
  assert.equal(antigo.hora, '05:00');
  const novo = proximas(AGENDA['lembretes-diarios'], INICIO, 1)[0];
  assert.equal(novo.hora, '08:00');
});

test('lembretes-diarios: 08:00 de Brasília, só de segunda a sexta (nunca sábado nem domingo)', () => {
  const runs = proximas(AGENDA['lembretes-diarios'], INICIO, 14);
  assert.deepEqual(runs.slice(0, 5).map(r => `${r.dia} ${r.data}`), [
    'qui 2026-10-01', 'sex 2026-10-02', 'seg 2026-10-05', 'ter 2026-10-06', 'qua 2026-10-07',
  ]);
  for (const r of runs) {
    assert.equal(r.hora, '08:00');
    assert.ok(['seg', 'ter', 'qua', 'qui', 'sex'].includes(r.dia), `caiu em ${r.dia} ${r.data}`);
  }
  // 08:00 em Brasília = 11:00 UTC
  assert.equal(new Date(runs[0].ms).toISOString(), '2026-10-01T11:00:00.000Z');
});

test('lembretes-diarios: a partir de sexta à tarde a próxima é a segunda', () => {
  const sexta = proximas(AGENDA['lembretes-diarios'], '2026-10-02T18:00:00Z', 1)[0];
  assert.equal(`${sexta.dia} ${sexta.data} ${sexta.hora}`, 'seg 2026-10-05 08:00');
});

test('escalonamento-vespera: 08:30 e 16:30 de Brasília (o "30 8,16" original), só em dia de semana', () => {
  const antigo = proximas(ANTES('30 8,16 * * *'), INICIO, 2);
  assert.deepEqual(antigo.map(r => r.hora), ['13:30', '05:30'], 'antes: 13h30 e 05h30 de Brasília');
  const runs = proximas(AGENDA['escalonamento-vespera'], INICIO, 10);
  assert.deepEqual(runs.slice(0, 4).map(r => `${r.data} ${r.hora}`), [
    '2026-09-30 16:30', '2026-10-01 08:30', '2026-10-01 16:30', '2026-10-02 08:30',
  ]);
  // sexta 16:30 → a próxima é segunda 08:30 (nada no fim de semana)
  assert.deepEqual(proximas(AGENDA['escalonamento-vespera'], '2026-10-02T20:00:00Z', 1).map(r => `${r.dia} ${r.hora}`), ['seg 08:30']);
  for (const r of runs) {
    assert.ok(['08:30', '16:30'].includes(r.hora), `hora ${r.hora}`);
    assert.ok(!['sáb', 'dom'].includes(r.dia), `caiu em ${r.dia}`);
  }
});

test('backup-diario: 02:00 de Brasília todo dia (antes: 23:00 do dia anterior)', () => {
  const antigo = proximas(ANTES('0 2 * * *'), INICIO, 1)[0];
  assert.equal(antigo.hora, '23:00');
  const runs = proximas(AGENDA['backup-diario'], INICIO, 8);
  for (const r of runs) assert.equal(r.hora, '02:00');
  // todo dia, inclusive fim de semana: 8 execuções em 8 datas consecutivas distintas
  assert.equal(new Set(runs.map(r => r.data)).size, 8);
  assert.equal(new Date(runs[0].ms).toISOString(), '2026-10-01T05:00:00.000Z');
});

test('ciclos-recorrentes: 07:00 de Brasília todo dia (antes: 04:00) — sempre antes do bom dia das 08:00', () => {
  const antigo = proximas(ANTES('0 7 * * *'), INICIO, 1)[0];
  assert.equal(antigo.hora, '04:00');
  const runs = proximas(AGENDA['ciclos-recorrentes'], INICIO, 8);
  for (const r of runs) assert.equal(r.hora, '07:00');
  assert.equal(new Set(runs.map(r => r.data)).size, 8);
});

test('verificar-token-google: 08:00 de Brasília todo dia, inclusive fim de semana (token morre no sábado também)', () => {
  const runs = proximas(AGENDA['verificar-token-google'], INICIO, 8);
  for (const r of runs) assert.equal(r.hora, '08:00');
  assert.ok(runs.some(r => r.dia === 'sáb') && runs.some(r => r.dia === 'dom'));
});

test('workers/index.js usa AGENDA nos jobs com hora do dia; o que ficou inline é "a cada N" (neutro ao fuso)', () => {
  const fonte = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
  const usados = [...fonte.matchAll(/AGENDA\['([^']+)'\]/g)].map(m => m[1]);
  assert.deepEqual([...new Set(usados)].sort(), Object.keys(AGENDA).sort(), 'cada job da AGENDA precisa estar ligado no index.js');
  for (const nome of usados) assert.ok(AGENDA[nome], `AGENDA sem ${nome}`);

  // Todo `pattern:` escrito à mão em index.js precisa ser "a cada N" ou de hora em hora.
  const inline = [...fonte.matchAll(/pattern:\s*'([^']+)'/g)].map(m => m[1]);
  for (const p of inline) {
    assert.match(p, /^(\*\/\d+ \* \* \* \*|0 \* \* \* \*)$/, `pattern com hora do dia sem tz em index.js: "${p}"`);
  }
});

// ── removerAgendamentosAntigos ────────────────────────────────────────────────

function filaFalsa(repetiveis, { falhaListar = false, falhaRemover = [] } = {}) {
  const removidas = [];
  return {
    name: 'alertas',
    removidas,
    async getRepeatableJobs() {
      if (falhaListar) throw new Error('redis fora');
      return repetiveis;
    },
    async removeRepeatableByKey(key) {
      if (falhaRemover.includes(key)) throw new Error('falhou');
      removidas.push(key);
      return true;
    },
  };
}

const semTz = (name, pattern, key) => ({ key, name, pattern, tz: null, next: 0 });
const certo = (name, key) => ({ key, name, pattern: AGENDA[name].pattern, tz: AGENDA[name].tz, next: 0 });

test('removerAgendamentosAntigos: apaga o agendamento em UTC e mantém o novo (senão o bom dia sai em dobro)', async () => {
  const fila = filaFalsa([
    semTz('lembretes-diarios', '0 8 * * *', 'K-velho'),
    certo('lembretes-diarios', 'K-novo'),
  ]);
  const removidos = await removerAgendamentosAntigos(fila, ['lembretes-diarios']);
  assert.deepEqual(fila.removidas, ['K-velho']);
  assert.deepEqual(removidos.map(r => r.nome), ['lembretes-diarios']);
});

test('removerAgendamentosAntigos: cobre os 4 jobs trocados, inclusive o backup que rodava às 23h', async () => {
  const fila = filaFalsa([
    semTz('lembretes-diarios', '0 8 * * *', 'A'),
    semTz('ciclos-recorrentes', '0 7 * * *', 'B'),
    semTz('escalonamento-vespera', '30 8,16 * * *', 'C'),
    semTz('backup-diario', '0 2 * * *', 'D'),
  ]);
  await removerAgendamentosAntigos(fila, ['lembretes-diarios', 'ciclos-recorrentes', 'escalonamento-vespera', 'backup-diario']);
  assert.deepEqual(fila.removidas.sort(), ['A', 'B', 'C', 'D']);
});

test('removerAgendamentosAntigos: mesmo padrão com outro fuso também é antigo', async () => {
  const fila = filaFalsa([
    { key: 'F', name: 'lembretes-diarios', pattern: AGENDA['lembretes-diarios'].pattern, tz: 'America/Fortaleza', next: 0 },
  ]);
  await removerAgendamentosAntigos(fila, ['lembretes-diarios']);
  assert.deepEqual(fila.removidas, ['F']);
});

test('removerAgendamentosAntigos: segundo boot não remove nada (idempotente)', async () => {
  const fila = filaFalsa([certo('lembretes-diarios', 'K1'), certo('escalonamento-vespera', 'K2')]);
  const removidos = await removerAgendamentosAntigos(fila, ['lembretes-diarios', 'escalonamento-vespera']);
  assert.deepEqual(removidos, []);
  assert.deepEqual(fila.removidas, []);
});

test('removerAgendamentosAntigos: chave no formato antigo (hash vazio) também é reconhecida e removida', async () => {
  // `getRepeatableJobs` devolve name/pattern/tz vazios quando o hash não existe; só a chave tem os dados
  const velha = { key: 'lembretes-diarios:lembretes-diarios-recorrente:::0 8 * * *', name: undefined, pattern: null, tz: null, next: 0 };
  assert.deepEqual(
    [lerRepetivel(velha).name, lerRepetivel(velha).pattern, lerRepetivel(velha).tz],
    ['lembretes-diarios', '0 8 * * *', null],
  );
  const comFuso = { key: 'backup-diario:backup-diario-recorrente::UTC:0 2 * * *', name: undefined, pattern: null, tz: null, next: 0 };
  assert.equal(lerRepetivel(comFuso).tz, 'UTC');
  const fila = filaFalsa([velha, comFuso, certo('lembretes-diarios', 'K-novo')]);
  await removerAgendamentosAntigos(fila, ['lembretes-diarios', 'backup-diario']);
  assert.deepEqual(fila.removidas.sort(), [comFuso.key, velha.key].sort());
});

test('lerRepetivel: chave em hash (md5) sem dados fica como está', () => {
  const md5 = { key: 'd41d8cd98f00b204e9800998ecf8427e', name: undefined, pattern: null, tz: null };
  assert.deepEqual(lerRepetivel(md5), md5);
});

test('removerAgendamentosAntigos: não toca em job de outro nome nem em job que não foi pedido', async () => {
  const fila = filaFalsa([
    semTz('reprocessar-sync-camila', '*/15 * * * *', 'X'),   // fora da AGENDA
    semTz('reprocessar-sync-drive', '*/30 * * * *', 'Y'),    // fora da AGENDA
    semTz('backup-diario', '0 2 * * *', 'Z'),                 // na AGENDA, mas não pedido nesta chamada
  ]);
  await removerAgendamentosAntigos(fila, ['lembretes-diarios']);
  assert.deepEqual(fila.removidas, []);
});

test('removerAgendamentosAntigos: nunca lança (boot não pode cair) — falha ao listar ou ao remover', async () => {
  const semRedis = filaFalsa([], { falhaListar: true });
  assert.deepEqual(await removerAgendamentosAntigos(semRedis, ['lembretes-diarios']), []);

  const fila = filaFalsa([
    semTz('lembretes-diarios', '0 8 * * *', 'ruim'),
    semTz('ciclos-recorrentes', '0 7 * * *', 'bom'),
  ], { falhaRemover: ['ruim'] });
  const removidos = await removerAgendamentosAntigos(fila, ['lembretes-diarios', 'ciclos-recorrentes']);
  assert.deepEqual(fila.removidas, ['bom'], 'a falha de um não impede remover o outro');
  assert.deepEqual(removidos.map(r => r.nome), ['ciclos-recorrentes']);
});

test('descreverAgendamentos: mostra a próxima execução em horário de Brasília', async () => {
  const fila = filaFalsa([{ ...certo('lembretes-diarios', 'K'), next: Date.UTC(2026, 9, 1, 11, 0) }]);
  const [linha] = await descreverAgendamentos(fila);
  assert.match(linha, /alertas\/lembretes-diarios "0 8 \* \* 1-5" \(America\/Sao_Paulo\)/);
  assert.match(linha, /08:00/);
  assert.match(linha, /01\/10/);
});

test('descreverAgendamentos: nunca lança', async () => {
  const [linha] = await descreverAgendamentos(filaFalsa([], { falhaListar: true }));
  assert.match(linha, /não deu pra listar/);
});
