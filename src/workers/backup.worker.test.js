import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { gerarDumpComprimido, backupTemTamanhoPlausivel } from './backup.worker.js';

function scriptFalso(dir, nome, conteudo) {
  const arquivo = path.join(dir, nome);
  writeFileSync(arquivo, `#!/bin/sh\n${conteudo}\n`);
  chmodSync(arquivo, 0o755);
  return arquivo;
}

test('backupTemTamanhoPlausivel rejeita gzip vazio (20 bytes) e aceita dump real', () => {
  assert.equal(backupTemTamanhoPlausivel(20), false);
  assert.equal(backupTemTamanhoPlausivel(0), false);
  assert.equal(backupTemTamanhoPlausivel(1023), false);
  assert.equal(backupTemTamanhoPlausivel(1024), true);
  assert.equal(backupTemTamanhoPlausivel(500000), true);
});

test('gerarDumpComprimido rejeita quando o comando pg_dump não existe', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'am-backup-test-'));
  try {
    const destino = path.join(dir, 'saida.sql.gz');
    await assert.rejects(
      gerarDumpComprimido('postgres://fake', destino, { comando: path.join(dir, 'pg_dump-inexistente') }),
      /Falha ao iniciar/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gerarDumpComprimido rejeita e propaga o stderr quando pg_dump falha (ex.: mismatch de versão)', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'am-backup-test-'));
  try {
    const fakePgDump = scriptFalso(
      dir,
      'pg_dump',
      `echo "pg_dump: error: aborting because of server version mismatch" >&2\nexit 1`
    );
    const destino = path.join(dir, 'saida.sql.gz');

    await assert.rejects(
      gerarDumpComprimido('postgres://fake', destino, { comando: fakePgDump }),
      /server version mismatch/
    );

    // reproduz o bug original: mesmo com pg_dump falhando, o pipe ainda escreve um gzip
    // "válido" (porém vazio) em disco — é exatamente esse arquivo que ia parar no Drive.
    const conteudo = readFileSync(destino);
    assert.ok(conteudo.length > 0, 'gzip de entrada vazia ainda é gravado no destino');
    assert.equal(gunzipSync(conteudo).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gerarDumpComprimido resolve e o arquivo descomprime para o dump real quando pg_dump funciona', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'am-backup-test-'));
  try {
    // Conteúdo com alta entropia (hash aleatório por linha) para não comprimir bem demais —
    // um dump real de dezenas de tabelas também não fica perto dos 20 bytes do bug original.
    const dumpFalso = Array.from({ length: 100 }, (_, i) =>
      `CREATE TABLE tabela_${i} (id uuid PRIMARY KEY, hash text DEFAULT '${randomBytes(24).toString('hex')}');`
    ).join('\n') + '\n';
    const fakePgDump = scriptFalso(dir, 'pg_dump', `printf '%s' "${dumpFalso}"`);
    const destino = path.join(dir, 'saida.sql.gz');

    await gerarDumpComprimido('postgres://fake', destino, { comando: fakePgDump });

    const bytesGravados = readFileSync(destino);
    const descomprimido = gunzipSync(bytesGravados).toString('utf8');
    assert.equal(descomprimido, dumpFalso);
    assert.ok(backupTemTamanhoPlausivel(bytesGravados.length), `esperado >= 1024 bytes, veio ${bytesGravados.length}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
