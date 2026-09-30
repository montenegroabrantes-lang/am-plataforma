import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  adquirirLock,
  liberarLockSeInativo,
  CHAVE_LOCK_SYNC,
  LOCK_TTL_S,
  LOCK_BATIMENTO_MS,
  SCRIPT_RENOVAR,
  SCRIPT_LIBERAR,
} from './syncLock.js';

// Nenhum Redis de verdade: dublê em memória que reproduz o que o lock usa (SET NX EX, os dois scripts
// de comparar-e-agir, PTTL e DEL). Os scripts são reconhecidos por igualdade de texto.
function redisFalso() {
  const chaves = new Map();   // chave -> { valor, ttl }
  const r = {
    chaves,
    evals: [],
    falhasEval: 0,            // quantas próximas chamadas de eval devem lançar
    eval_pendente: false,     // true = eval nunca responde (Redis travado)
    async set(chave, valor, ...args) {
      if (args.includes('NX') && chaves.has(chave)) return null;
      const i = args.indexOf('EX');
      chaves.set(chave, { valor, ttl: i >= 0 ? Number(args[i + 1]) : null });
      return 'OK';
    },
    async eval(script, _n, chave, token, ttl) {
      r.evals.push({ script, chave, token, ttl });
      if (r.eval_pendente) return new Promise(() => {});
      if (r.falhasEval > 0) { r.falhasEval--; throw new Error('Connection is closed.'); }
      const c = chaves.get(chave);
      if (script === SCRIPT_RENOVAR) { if (c?.valor === token) { c.ttl = Number(ttl); return 1; } return 0; }
      if (script === SCRIPT_LIBERAR) { if (c?.valor === token) { chaves.delete(chave); return 1; } return 0; }
      throw new Error('script desconhecido');
    },
    pttlMs: null,             // o teste define o que o PTTL devolve
    async pttl() { if (r.pttlLancar) throw new Error('Connection is closed.'); return r.pttlMs; },
    apagados: [],
    async del(chave) { r.apagados.push(chave); chaves.delete(chave); return 1; },
  };
  return r;
}
const dormir = (ms) => new Promise(r => setTimeout(r, ms));
// Espera uma condição (com teto), em vez de um sleep fixo que dependeria da velocidade da máquina.
async function ate(condicao, ms = 2000) {
  const fim = Date.now() + ms;
  while (!condicao()) {
    if (Date.now() > fim) throw new Error('condição não atingida a tempo');
    await dormir(5);
  }
}

// ── dois syncs ao mesmo tempo ────────────────────────────────────────────────

test('dois pedidos simultâneos do lock: só um obtém, o outro recebe null', async () => {
  const redis = redisFalso();
  const [a, b] = await Promise.all([adquirirLock(redis), adquirirLock(redis)]);
  const obtidos = [a, b].filter(Boolean);
  assert.equal(obtidos.length, 1);
  await obtidos[0].liberar();
});

test('o lock tem dono (token único, não "1") e validade curta — não os 30 min do lock antigo', async () => {
  const redis = redisFalso();
  const lock = await adquirirLock(redis);
  const guardado = redis.chaves.get(CHAVE_LOCK_SYNC);
  assert.equal(guardado.valor, lock.token);
  assert.notEqual(guardado.valor, '1');
  assert.equal(guardado.ttl, LOCK_TTL_S);
  assert.ok(LOCK_TTL_S < 30 * 60, 'validade menor que a do lock antigo');
  assert.ok(LOCK_TTL_S >= 3 * (LOCK_BATIMENTO_MS / 1000), 'cabem vários batimentos antes de vencer');
  await lock.liberar();
});

test('liberar apaga a chave quando o lock ainda é nosso', async () => {
  const redis = redisFalso();
  const lock = await adquirirLock(redis);
  await lock.liberar();
  assert.equal(redis.chaves.has(CHAVE_LOCK_SYNC), false);
  // e depois de liberar, outra execução consegue pegar
  const outro = await adquirirLock(redis);
  assert.ok(outro);
  await outro.liberar();
});

test('liberar NÃO apaga o lock de outra execução que o assumiu depois da nossa validade vencer', async () => {
  const redis = redisFalso();
  const a = await adquirirLock(redis);
  redis.chaves.delete(CHAVE_LOCK_SYNC);          // a validade de A venceu
  const b = await adquirirLock(redis);           // B assume
  assert.ok(b);
  await a.liberar();                             // o finally de A roda tarde
  assert.equal(redis.chaves.get(CHAVE_LOCK_SYNC)?.valor, b.token, 'a chave de B continua');
  // com o lock antigo (DEL incondicional) a chave de B teria sido apagada e uma terceira execução entraria
  assert.equal(await adquirirLock(redis), null);
  await b.liberar();
});

// ── batimento ────────────────────────────────────────────────────────────────

test('batimento renova a validade enquanto a execução vive (execução longa não perde o lock)', async () => {
  const redis = redisFalso();
  const lock = await adquirirLock(redis, CHAVE_LOCK_SYNC, { batimentoMs: 15 });
  redis.chaves.get(CHAVE_LOCK_SYNC).ttl = 1;     // "quase vencendo"
  await ate(() => redis.chaves.get(CHAVE_LOCK_SYNC).ttl === LOCK_TTL_S);   // o batimento devolveu a validade cheia
  assert.equal(redis.chaves.get(CHAVE_LOCK_SYNC).ttl, LOCK_TTL_S);
  assert.equal(lock.perdido, false);
  await lock.liberar();
});

test('batimento descobre que perdeu o lock (chave apagada) e marca perdido, sem lançar', async () => {
  const redis = redisFalso();
  const lock = await adquirirLock(redis, CHAVE_LOCK_SYNC, { batimentoMs: 15 });
  assert.equal(lock.perdido, false);
  redis.chaves.delete(CHAVE_LOCK_SYNC);
  await ate(() => lock.perdido);
  assert.equal(lock.perdido, true);
  const antes = redis.evals.length;
  await dormir(60);
  assert.equal(redis.evals.length, antes, 'parou de renovar depois de perder');
  await lock.liberar();
});

test('batimento não confunde o lock de OUTRO com o nosso: chave de outro dono = perdido', async () => {
  const redis = redisFalso();
  const lock = await adquirirLock(redis, CHAVE_LOCK_SYNC, { batimentoMs: 15 });
  redis.chaves.set(CHAVE_LOCK_SYNC, { valor: 'outra-execucao', ttl: 300 });
  await ate(() => lock.perdido);
  assert.equal(lock.perdido, true);
  await lock.liberar();
  assert.equal(redis.chaves.get(CHAVE_LOCK_SYNC).valor, 'outra-execucao', 'não apagou a chave alheia');
});

test('falha passageira do Redis no batimento não derruba nem marca perdido; o batimento seguinte renova', async () => {
  const redis = redisFalso();
  const lock = await adquirirLock(redis, CHAVE_LOCK_SYNC, { batimentoMs: 15 });
  redis.falhasEval = 2;
  redis.chaves.get(CHAVE_LOCK_SYNC).ttl = 1;
  await ate(() => redis.falhasEval === 0 && redis.chaves.get(CHAVE_LOCK_SYNC).ttl === LOCK_TTL_S);
  assert.equal(lock.perdido, false);
  assert.equal(redis.chaves.get(CHAVE_LOCK_SYNC).ttl, LOCK_TTL_S);
  await lock.liberar();
});

test('depois de liberar, o batimento para', async () => {
  const redis = redisFalso();
  const lock = await adquirirLock(redis, CHAVE_LOCK_SYNC, { batimentoMs: 15 });
  await lock.liberar();
  const antes = redis.evals.length;
  await dormir(60);
  assert.equal(redis.evals.length, antes);
});

test('Redis que não responde não trava o fim do sync: liberar desiste no prazo e não lança', async () => {
  const redis = redisFalso();
  const lock = await adquirirLock(redis, CHAVE_LOCK_SYNC, { batimentoMs: 60_000, esperaLiberarMs: 30 });
  redis.eval_pendente = true;
  const t0 = Date.now();
  await lock.liberar();
  assert.ok(Date.now() - t0 < 1000);
});

// ── botão "forçar" ───────────────────────────────────────────────────────────

test('forçar: lock inexistente não apaga nada', async () => {
  const redis = redisFalso();
  redis.pttlMs = -2;
  assert.equal(await liberarLockSeInativo(redis), false);
  assert.deepEqual(redis.apagados, []);
});

test('forçar: lock VIVO (renovado há pouco) é mantido — não se apaga o lock de quem está rodando', async () => {
  const redis = redisFalso();
  redis.chaves.set(CHAVE_LOCK_SYNC, { valor: 'x', ttl: 300 });
  redis.pttlMs = (LOCK_TTL_S - 30) * 1000;   // renovado há 30 s
  assert.equal(await liberarLockSeInativo(redis), false);
  assert.deepEqual(redis.apagados, []);
  assert.ok(redis.chaves.has(CHAVE_LOCK_SYNC));
});

test('forçar: lock PARADO (sem batimento há mais de 2 ciclos) é apagado', async () => {
  const redis = redisFalso();
  redis.chaves.set(CHAVE_LOCK_SYNC, { valor: 'x', ttl: 300 });
  redis.pttlMs = (LOCK_TTL_S * 1000) - (3 * LOCK_BATIMENTO_MS);   // 3 batimentos sem renovar
  assert.equal(await liberarLockSeInativo(redis), true);
  assert.deepEqual(redis.apagados, [CHAVE_LOCK_SYNC]);
});

test('forçar: chave sem validade (resto do lock antigo) é apagada', async () => {
  const redis = redisFalso();
  redis.chaves.set(CHAVE_LOCK_SYNC, { valor: '1', ttl: null });
  redis.pttlMs = -1;
  assert.equal(await liberarLockSeInativo(redis), true);
});

test('forçar: Redis com erro devolve false e não lança', async () => {
  const redis = redisFalso();
  redis.pttlLancar = true;
  assert.equal(await liberarLockSeInativo(redis), false);
});

// ── integração com o restante do código ─────────────────────────────────────

test('rota sync-todos: forçar usa liberarLockSeInativo (não apaga mais o lock de quem está rodando)', () => {
  const fonte = readFileSync(new URL('../../routes/processos.js', import.meta.url), 'utf8');
  assert.match(fonte, /liberarLockSeInativo\(redis\)/);
  assert.doesNotMatch(fonte, /redis\.del\('sync:global:lock'\)/);
});

test('boot continua liberando o lock (um deploy no meio do sync não pode deixá-lo preso)', () => {
  const fonte = readFileSync(new URL('../../index.js', import.meta.url), 'utf8');
  assert.match(fonte, /redis\.del\('sync:global:lock'\)/);
  assert.equal(CHAVE_LOCK_SYNC, 'sync:global:lock', 'a chave é a mesma que o boot e a tela /sync-status já usam');
});
