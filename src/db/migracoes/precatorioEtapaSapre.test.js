import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aplicarEtapaSapre } from './precatorioEtapaSapre.js';
import { ETAPAS } from '../../services/precatorios/regras.js';

test('etapa SAPRE: só troca a trava de etapas, com a lista completa e na ordem certa', async () => {
  const sqls = [];
  await aplicarEtapaSapre({ execute: async sql => { sqls.push(sql.replace(/\s+/g, ' ').trim()); } });
  assert.equal(sqls.length, 2);
  assert.equal(sqls[0], 'ALTER TABLE precatorios DROP CONSTRAINT IF EXISTS precatorios_etapa_check');
  assert.match(sqls[1], /^ALTER TABLE precatorios ADD CONSTRAINT precatorios_etapa_check CHECK \(etapa IN \('minuta_juntada','enviado_sapre','assinado','remetido','autuado',/);
  for (const s of sqls) assert.doesNotMatch(s, /\b(DROP TABLE|DELETE FROM|UPDATE \w+ SET|TRUNCATE|DROP COLUMN)\b/i);
  for (const e of ETAPAS) assert.ok(sqls[1].includes(`'${e.chave}'`));
});

test('a etapa nova fica entre a minuta e a assinatura', () => {
  const chaves = ETAPAS.map(e => e.chave);
  assert.deepEqual(chaves.slice(0, 3), ['minuta_juntada', 'enviado_sapre', 'assinado']);
  assert.equal(ETAPAS[1].nome, 'Enviado ao SAPRE');
});
