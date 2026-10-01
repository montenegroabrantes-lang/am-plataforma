// S-05 / D-S4 — migração do aprovador do re-protocolo. Sem banco: `conexao` é um dublê que registra o SQL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aplicarAprovadorReprotocolo } from './aprovadorReprotocolo.js';

function conexaoFalsa({ casam = [] } = {}) {
  const sqls = [];
  return {
    sqls,
    async execute(sql, params) { sqls.push({ tipo: 'execute', sql, params }); return { rowCount: 1 }; },
    async query(sql, params) { sqls.push({ tipo: 'query', sql, params }); return casam; },
  };
}

test('cria a coluna (aditivo, idempotente) e marca só Master ativo cujo e-mail está na variável, sem repetir marcados', async () => {
  const c = conexaoFalsa({ casam: [{ id: 'u-lu' }] });
  const r = await aplicarAprovadorReprotocolo({ conexao: c, emails: [' Luciano@X.com ', 'luciano@x.com', ''] });
  assert.deepEqual(r.marcados, ['u-lu']);
  const [alter, update, log] = c.sqls;
  assert.match(alter.sql, /ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS aprova_reprotocolo BOOLEAN NOT NULL DEFAULT false/);
  assert.match(update.sql, /ativo = true/);
  assert.match(update.sql, /perfil = 'master'/);
  assert.match(update.sql, /aprova_reprotocolo = false/);
  assert.match(update.sql, /lower\(email\) = ANY\(\$1::text\[\]\)/);
  assert.deepEqual(update.params, [['luciano@x.com']], 'e-mails normalizados e sem duplicata');
  assert.match(log.sql, /INSERT INTO logs_auditoria/);
  assert.equal(log.params[0], 'u-lu');
  assert.match(log.params[1], /migracao_S05/);
});

test('nunca desmarca nem apaga: nenhum comando destrutivo, nem quando ninguém casa', async () => {
  for (const casam of [[{ id: 'a' }, { id: 'b' }], []]) {
    const c = conexaoFalsa({ casam });
    await aplicarAprovadorReprotocolo({ conexao: c, emails: ['x@x.com'] });
    for (const { sql } of c.sqls) {
      assert.doesNotMatch(sql, /DROP|DELETE|TRUNCATE/i);
      assert.doesNotMatch(sql, /aprova_reprotocolo = false\s*(,|WHERE\s+id)/i, 'não há UPDATE que desmarque');
    }
  }
});

test('variável vazia: cria a coluna, não marca ninguém (padrão seguro) e não consulta usuários', async () => {
  const c = conexaoFalsa();
  const r = await aplicarAprovadorReprotocolo({ conexao: c, emails: [] });
  assert.deepEqual(r.marcados, []);
  assert.equal(c.sqls.length, 1);
  assert.match(c.sqls[0].sql, /ADD COLUMN IF NOT EXISTS aprova_reprotocolo/);
});

test('nenhum Master ativo casou: nada é marcado e nenhum log é gravado', async () => {
  const c = conexaoFalsa({ casam: [] });
  const r = await aplicarAprovadorReprotocolo({ conexao: c, emails: ['desativado@x.com'] });
  assert.deepEqual(r.marcados, []);
  assert.equal(c.sqls.filter(s => /logs_auditoria/.test(s.sql)).length, 0);
});
