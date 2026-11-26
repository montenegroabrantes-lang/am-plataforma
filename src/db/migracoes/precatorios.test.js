import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aplicarPrecatorios } from './precatorios.js';

// Versão 2.0, etapa 2 (25/11/2026): precatório como entidade. Só acrescenta e pode reexecutar.
test('migração de precatórios: aditiva, idempotente, número único e etapas do plano', async () => {
  const sqls = [];
  await aplicarPrecatorios({ execute: async sql => { sqls.push(sql.replace(/\s+/g, ' ').trim()); return { rows: [] }; } });
  for (const s of sqls) {
    assert.doesNotMatch(s, /\b(DROP TABLE|DELETE FROM|UPDATE \w+ SET|TRUNCATE|DROP COLUMN|ALTER TABLE)\b/i, s);
    assert.match(s, /^CREATE (TABLE|INDEX) IF NOT EXISTS/, s);
  }
  const tudo = sqls.join('\n');
  assert.match(tudo, /CREATE TABLE IF NOT EXISTS precatorios \(/);
  assert.match(tudo, /CONSTRAINT precatorios_numero_unico UNIQUE \(numero\)/);
  assert.match(tudo, /processo_origem_id UUID REFERENCES processos\(id\) ON DELETE SET NULL/);
  assert.match(tudo, /etapa IN \('minuta_juntada','assinado','remetido','autuado','incluido_orcamento','aguardando_pagamento','pagamento_disponibilizado','alvara_levantado','repasse_cliente'\)/);
  assert.match(tudo, /precatorio_id UUID NOT NULL REFERENCES precatorios\(id\) ON DELETE CASCADE/);
});
