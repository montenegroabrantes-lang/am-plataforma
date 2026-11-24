import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aplicarAcervoConhecimento } from './acervoConhecimento.js';

// Camada de conhecimento (23/11/2026): a migração só acrescenta (nada de DROP TABLE/DELETE/UPDATE em
// dado existente) e pode reexecutar sem erro (IF NOT EXISTS; constraints recriadas com DROP ... IF EXISTS).
// Conferida também contra Postgres real (PGlite), rodando duas vezes sobre o esquema antigo do acervo.
test('migração do acervo: aditiva, idempotente e com as tabelas e colunas da fase 1', async () => {
  const sqls = [];
  await aplicarAcervoConhecimento({ execute: async sql => { sqls.push(sql.replace(/\s+/g, ' ').trim()); return { rows: [] }; } });
  for (const s of sqls) {
    assert.doesNotMatch(s, /\b(DROP TABLE|DELETE FROM|UPDATE \w+ SET|TRUNCATE|DROP COLUMN)\b/i, s);
    if (/^(CREATE TABLE|CREATE INDEX)/.test(s)) assert.match(s, /IF NOT EXISTS/, s);
    if (/ADD COLUMN/.test(s)) assert.match(s, /ADD COLUMN IF NOT EXISTS/, s);
    if (/ADD CONSTRAINT (\w+)/.test(s)) {
      const nome = s.match(/ADD CONSTRAINT (\w+)/)[1];
      assert.ok(sqls.indexOf(`ALTER TABLE teses_acervo DROP CONSTRAINT IF EXISTS ${nome}`) > -1, `${nome} recriada sem DROP IF EXISTS`);
    }
  }
  const tudo = sqls.join('\n');
  for (const coluna of ['tese_mae_id', 'status', 'status_motivo', 'skill_slug']) assert.match(tudo, new RegExp(`teses_acervo ADD COLUMN IF NOT EXISTS ${coluna} `));
  for (const coluna of ['data_decisao', 'resultado_por_pedido']) assert.match(tudo, new RegExp(`acervo_pecas ADD COLUMN IF NOT EXISTS ${coluna} `));
  for (const tabela of ['acervo_argumentos', 'acervo_argumentos_precedentes', 'acervo_pecas_argumentos', 'acervo_pecas_precedentes']) assert.match(tudo, new RegExp(`CREATE TABLE IF NOT EXISTS ${tabela} \\(`));
  assert.match(tudo, /'ativa','em_risco','suspensa','superada'/);
  assert.match(tudo, /'fundamento','defesa_fazenda','resposta','preliminar','calculo'/);
  assert.match(tudo, /'em_teste','aprovado','abandonado'/);
});
