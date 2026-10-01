import test from 'node:test';
import assert from 'node:assert/strict';
import { extrairVersaoPgDump, lerVersaoPgDump, logarVersoesBoot } from './versaoPgDump.js';

test('extrairVersaoPgDump: lê a versão da saída real do pg_dump', () => {
  assert.equal(extrairVersaoPgDump('pg_dump (PostgreSQL) 18.1 (Debian 18.1-1.pgdg120+2)\n'), '18.1');
  assert.equal(extrairVersaoPgDump('pg_dump (PostgreSQL) 15.14 (Debian 15.14-0+deb12u1)'), '15.14');
  assert.equal(extrairVersaoPgDump('pg_dump (PostgreSQL) 19'), '19');
});

test('extrairVersaoPgDump: texto estranho ou vazio vira null (não inventa versão)', () => {
  assert.equal(extrairVersaoPgDump(''), null);
  assert.equal(extrairVersaoPgDump(null), null);
  assert.equal(extrairVersaoPgDump(undefined), null);
  assert.equal(extrairVersaoPgDump('command not found'), null);
});

test('lerVersaoPgDump: chama "pg_dump --version" com timeout e devolve a versão', async () => {
  let chamada;
  const executar = (cmd, args, opcoes, cb) => {
    chamada = { cmd, args, opcoes };
    cb(null, 'pg_dump (PostgreSQL) 18.1 (Debian 18.1-1.pgdg120+2)\n');
  };
  assert.equal(await lerVersaoPgDump({ executar, timeoutMs: 1234 }), '18.1');
  assert.equal(chamada.cmd, 'pg_dump');
  assert.deepEqual(chamada.args, ['--version']);
  assert.equal(chamada.opcoes.timeout, 1234);
});

test('lerVersaoPgDump: binário ausente ou erro do executável resolve null, sem rejeitar', async () => {
  const semBinario = (cmd, args, opcoes, cb) => cb(Object.assign(new Error('spawn pg_dump ENOENT'), { code: 'ENOENT' }));
  assert.equal(await lerVersaoPgDump({ executar: semBinario }), null);
  const estoura = () => { throw new Error('boom'); };
  assert.equal(await lerVersaoPgDump({ executar: estoura }), null);
});

test('lerVersaoPgDump: com um comando que não existe de verdade, resolve null', async () => {
  assert.equal(await lerVersaoPgDump({ comando: 'pg_dump-que-nao-existe-am', timeoutMs: 2000 }), null);
});

test('logarVersoesBoot: registra Node e pg_dump com o prefixo [BOOT]', async () => {
  const linhas = [];
  const log = { log: (m) => linhas.push(['log', m]), warn: (m) => linhas.push(['warn', m]) };
  const executar = (c, a, o, cb) => cb(null, 'pg_dump (PostgreSQL) 18.1 (Debian 18.1-1.pgdg120+2)');
  const versao = await logarVersoesBoot({ log, executar });
  assert.equal(versao, '18.1');
  assert.deepEqual(linhas, [['log', `[BOOT] Node ${process.version}`], ['log', '[BOOT] pg_dump 18.1']]);
});

test('logarVersoesBoot: sem pg_dump avisa em warn e não derruba o boot', async () => {
  const linhas = [];
  const log = { log: (m) => linhas.push(['log', m]), warn: (m) => linhas.push(['warn', m]) };
  const executar = (c, a, o, cb) => cb(new Error('ENOENT'));
  const versao = await logarVersoesBoot({ log, executar });
  assert.equal(versao, null);
  assert.equal(linhas[1][0], 'warn');
  assert.match(linhas[1][1], /^\[BOOT\] pg_dump não encontrado/);
});
