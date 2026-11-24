import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aplicarAcervoCobertura } from './acervoCobertura.js';

test('migração da cobertura: aditiva e idempotente', async () => {
  const sqls = [];
  await aplicarAcervoCobertura({ execute: async sql => { sqls.push(sql.replace(/\s+/g, ' ').trim()); return { rows: [] }; } });
  for (const s of sqls) {
    assert.doesNotMatch(s, /\b(DROP TABLE|DELETE FROM|UPDATE \w+ SET|TRUNCATE|DROP COLUMN)\b/i, s);
    if (/ADD COLUMN/.test(s)) assert.match(s, /ADD COLUMN IF NOT EXISTS/, s);
    if (/^CREATE INDEX/.test(s)) assert.match(s, /IF NOT EXISTS/, s);
  }
  const tudo = sqls.join('\n');
  assert.match(tudo, /produtos ADD COLUMN IF NOT EXISTS tese_acervo_id UUID REFERENCES teses_acervo\(id\) ON DELETE SET NULL/);
  assert.match(tudo, /acervo_pecas ADD COLUMN IF NOT EXISTS retroativa BOOLEAN NOT NULL DEFAULT false/);
});
