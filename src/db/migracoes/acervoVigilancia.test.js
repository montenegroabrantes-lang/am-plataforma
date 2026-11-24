import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aplicarAcervoVigilancia } from './acervoVigilancia.js';

// Fase 2 (24/11/2026): vigilância jurisprudencial e decisao_id da peça. Só acrescenta e pode reexecutar.
// Conferida também contra Postgres real (PGlite), rodando duas vezes depois da fase 1.
test('migração da vigilância: aditiva, idempotente, com tabelas e decisao_id', async () => {
  const sqls = [];
  await aplicarAcervoVigilancia({ execute: async sql => { sqls.push(sql.replace(/\s+/g, ' ').trim()); return { rows: [] }; } });
  for (const s of sqls) {
    assert.doesNotMatch(s, /\b(DROP TABLE|DELETE FROM|UPDATE \w+ SET|TRUNCATE|DROP COLUMN)\b/i, s);
    if (/^(CREATE TABLE|CREATE INDEX)/.test(s)) assert.match(s, /IF NOT EXISTS/, s);
    if (/ADD COLUMN/.test(s)) assert.match(s, /ADD COLUMN IF NOT EXISTS/, s);
  }
  const tudo = sqls.join('\n');
  for (const t of ['acervo_vigilancia', 'acervo_vigilancia_teses', 'acervo_vigilancia_historico']) assert.match(tudo, new RegExp(`CREATE TABLE IF NOT EXISTS ${t} \\(`));
  assert.match(tudo, /acervo_pecas ADD COLUMN IF NOT EXISTS decisao_id UUID REFERENCES acervo_precedentes\(id\) ON DELETE SET NULL/);
  assert.match(tudo, /referencia TEXT NOT NULL UNIQUE/);
});
