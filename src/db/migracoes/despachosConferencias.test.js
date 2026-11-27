import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aplicarDespachosConferencias } from './despachosConferencias.js';

test('migração das conferências: só acrescenta e pode reexecutar', async () => {
  const sqls = [];
  await aplicarDespachosConferencias({ execute: async sql => { sqls.push(sql.replace(/\s+/g, ' ').trim()); } });
  for (const s of sqls) {
    assert.doesNotMatch(s, /\b(DROP|DELETE FROM|UPDATE \w+ SET|TRUNCATE)\b/i, s);
    assert.match(s, /^(CREATE (TABLE|UNIQUE INDEX) IF NOT EXISTS|ALTER TABLE despachos_itens ADD COLUMN IF NOT EXISTS)/, s);
  }
  const tudo = sqls.join('\n');
  assert.match(tudo, /\(processo_id, tipo, referencia\) WHERE desfeito_em IS NULL/);
  assert.match(tudo, /resposta IN \('confirmado','descartado'\)/);
  for (const c of ['conferencia_tipo', 'conferencia_ref', 'conferencia_id']) assert.match(tudo, new RegExp(`ADD COLUMN IF NOT EXISTS ${c} `));
});
