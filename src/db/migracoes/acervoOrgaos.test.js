import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aplicarAcervoOrgaos } from './acervoOrgaos.js';

// Fase 3 (24/11/2026): órgão julgador. Só acrescenta e pode reexecutar; conferida também contra Postgres real (PGlite).
test('migração do órgão julgador: aditiva, idempotente, única por tribunal + nome', async () => {
  const sqls = [];
  await aplicarAcervoOrgaos({ execute: async sql => { sqls.push(sql.replace(/\s+/g, ' ').trim()); return { rows: [] }; } });
  for (const s of sqls) {
    assert.doesNotMatch(s, /\b(DROP TABLE|DELETE FROM|UPDATE \w+ SET|TRUNCATE|DROP COLUMN)\b/i, s);
    if (/^(CREATE TABLE|CREATE INDEX)/.test(s)) assert.match(s, /IF NOT EXISTS/, s);
    if (/ADD COLUMN/.test(s)) assert.match(s, /ADD COLUMN IF NOT EXISTS/, s);
  }
  const tudo = sqls.join('\n');
  assert.match(tudo, /CREATE TABLE IF NOT EXISTS acervo_orgaos \(/);
  assert.match(tudo, /CONSTRAINT acervo_orgaos_unico UNIQUE \(tribunal, nome\)/);
  assert.match(tudo, /acervo_pecas ADD COLUMN IF NOT EXISTS orgao_julgador_id UUID REFERENCES acervo_orgaos\(id\) ON DELETE SET NULL/);
});
