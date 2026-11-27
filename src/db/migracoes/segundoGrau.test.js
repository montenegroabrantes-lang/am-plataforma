import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aplicarSegundoGrau } from './segundoGrau.js';

test('migração do 2º grau: só acrescenta e pode reexecutar', async () => {
  const sqls = [];
  await aplicarSegundoGrau({ execute: async sql => { sqls.push(sql.replace(/\s+/g, ' ').trim()); } });
  for (const s of sqls) {
    assert.doesNotMatch(s, /\b(DROP|DELETE FROM|UPDATE \w+ SET|TRUNCATE)\b/i, s);
    assert.match(s, /^(CREATE (TABLE|INDEX) IF NOT EXISTS|ALTER TABLE precatorios ADD COLUMN IF NOT EXISTS)/, s);
  }
  const tudo = sqls.join('\n');
  assert.match(tudo, /precatorio_andamentos_unico UNIQUE \(precatorio_id, data, texto\)/);
  assert.match(tudo, /precatorio_id UUID NOT NULL REFERENCES precatorios\(id\) ON DELETE CASCADE/);
  for (const c of ['pje_acesso', 'pje_lido_em', 'pje_classe', 'pje_orgao', 'pje_relator']) assert.match(tudo, new RegExp(`ADD COLUMN IF NOT EXISTS ${c} `));
});
