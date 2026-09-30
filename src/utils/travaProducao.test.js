import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ambienteDeProducao, confirmacaoEmProducaoOk } from './travaProducao.js';

// S-06 — reset-senha.js e seed.js só rodam em produção com --confirmo.

const argv = (...extras) => ['node', 'reset-senha.js', ...extras];

test('ambienteDeProducao: NODE_ENV=production ou banco que não é da própria máquina', () => {
  assert.equal(ambienteDeProducao({ NODE_ENV: 'production' }), true);
  assert.equal(ambienteDeProducao({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://u:p@localhost:5432/am' }), true);
  assert.equal(ambienteDeProducao({ DATABASE_URL: 'postgresql://u:p@banco.exemplo.internal:5432/am' }), true);
  assert.equal(ambienteDeProducao({ DATABASE_URL: 'postgresql://u:p@monorail.proxy.exemplo.net:12345/railway' }), true);
  assert.equal(ambienteDeProducao({ DATABASE_URL: 'isto-nao-e-uma-url' }), true); // ilegível: na dúvida, produção
});

test('ambienteDeProducao: desenvolvimento local não é produção', () => {
  assert.equal(ambienteDeProducao({}), false);
  assert.equal(ambienteDeProducao({ NODE_ENV: 'development' }), false);
  assert.equal(ambienteDeProducao({ DATABASE_URL: 'postgresql://u:p@localhost:5432/am' }), false);
  assert.equal(ambienteDeProducao({ DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/am' }), false);
  assert.equal(ambienteDeProducao({ DATABASE_URL: 'postgresql://u:p@[::1]:5432/am' }), false);
});

test('em produção, sem --confirmo: recusa e avisa (sem revelar valor nenhum)', () => {
  const avisos = [];
  const ok = confirmacaoEmProducaoOk({ argv: argv(), env: { NODE_ENV: 'production', MASTER_SENHA: 'segredo-fictício' }, aviso: m => avisos.push(m) });
  assert.equal(ok, false);
  assert.ok(avisos.some(m => m.includes('--confirmo')));
  assert.ok(!avisos.join('\n').includes('segredo-fictício'));
});

test('em produção, com --confirmo: segue', () => {
  assert.equal(confirmacaoEmProducaoOk({ argv: argv('--confirmo'), env: { NODE_ENV: 'production' }, aviso: () => {} }), true);
  assert.equal(confirmacaoEmProducaoOk({ argv: argv('--outra', '--confirmo'), env: { DATABASE_URL: 'postgresql://u:p@banco.exemplo.internal/am' }, aviso: () => {} }), true);
});

test('--confirmo só vale como argumento do script, não como o nome do interpretador ou do arquivo', () => {
  assert.equal(confirmacaoEmProducaoOk({ argv: ['--confirmo', 'reset-senha.js'], env: { NODE_ENV: 'production' }, aviso: () => {} }), false);
});

test('fora de produção: segue sem --confirmo', () => {
  assert.equal(confirmacaoEmProducaoOk({ argv: argv(), env: { DATABASE_URL: 'postgresql://u:p@localhost:5432/am' }, aviso: () => { throw new Error('não devia avisar'); } }), true);
});

// Os scripts de verdade, em processo separado: em produção sem --confirmo saem com código 1 ANTES de
// tocar no banco (não há DATABASE_URL aqui; se passassem da trava, tentariam conectar e falhariam de outro jeito).
const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
for (const script of ['reset-senha.js', 'src/db/seed.js']) {
  test(`${script}: em produção sem --confirmo recusa (exit 1) e não vaza a senha`, () => {
    const r = spawnSync(process.execPath, [script], {
      cwd: RAIZ, encoding: 'utf8', timeout: 30000,
      env: { PATH: process.env.PATH, NODE_ENV: 'production', MASTER_EMAIL: 'mestre@exemplo.test', MASTER_SENHA: 'senha-ficticia-xyz' },
    });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /--confirmo/);
    assert.ok(!(r.stdout + r.stderr).includes('senha-ficticia-xyz'));
    assert.ok(!/resetada|criado/i.test(r.stdout), 'nada foi feito');
  });
}
