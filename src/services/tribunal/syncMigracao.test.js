import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DDL_SYNC_R06, aplicarMigracaoSyncR06 } from './syncMigracao.js';

const lerFonte = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

// Banco falso que entende "ADD COLUMN IF NOT EXISTS": guarda as colunas e recusa a repetição SEM o IF NOT EXISTS.
function bancoFalso(colunasExistentes = []) {
  const colunas = new Set(colunasExistentes);
  const chamadas = [];
  return {
    colunas, chamadas,
    async execute(sql) {
      chamadas.push(sql);
      const m = sql.match(/ALTER TABLE (\w+) ADD COLUMN (IF NOT EXISTS )?(\w+) (\w+)/);
      if (!m) throw new Error(`comando inesperado: ${sql}`);
      const chave = `${m[1]}.${m[3]}`;
      if (colunas.has(chave) && !m[2]) throw new Error(`column "${m[3]}" of relation "${m[1]}" already exists`);
      colunas.add(chave);
    },
  };
}

test('migração R-06: só acrescenta colunas anuláveis, com IF NOT EXISTS — sem DROP, DELETE, UPDATE, DEFAULT nem NOT NULL', () => {
  assert.equal(DDL_SYNC_R06.length, 4);
  for (const ddl of DDL_SYNC_R06) {
    assert.match(ddl, /^ALTER TABLE \w+ ADD COLUMN IF NOT EXISTS \w+ (TIMESTAMPTZ|INTEGER)$/);
    assert.doesNotMatch(ddl, /DROP|DELETE|UPDATE|TRUNCATE|DEFAULT|NOT NULL|UNIQUE|INDEX/i);
  }
});

test('migração R-06: idempotente — rodar duas vezes (ou com as colunas já existentes) não falha', async () => {
  const banco = bancoFalso();
  await aplicarMigracaoSyncR06(banco);
  await aplicarMigracaoSyncR06(banco);
  assert.deepEqual([...banco.colunas].sort(), [
    'processos.datajud_atualizado_em', 'sync_execucoes.casados', 'sync_execucoes.hits', 'sync_execucoes.status_http',
  ]);
  const jaExistem = bancoFalso(['processos.datajud_atualizado_em', 'sync_execucoes.status_http']);
  await aplicarMigracaoSyncR06(jaExistem);
  assert.equal(jaExistem.chamadas.length, 4);
});

test('toda coluna nova que o sync usa está na migração', () => {
  const declaradas = DDL_SYNC_R06.map(d => d.match(/ADD COLUMN IF NOT EXISTS (\w+)/)[1]);
  assert.deepEqual([...declaradas].sort(), ['casados', 'datajud_atualizado_em', 'hits', 'status_http']);
  const sync = lerFonte('./sync.js');
  const exec = lerFonte('./syncExecucao.js');
  assert.match(sync, /datajud_atualizado_em/);
  for (const col of ['status_http', 'hits', 'casados']) assert.match(exec, new RegExp(col));
});

test('index.js aplica a migração pelo mecanismo versionado (migrar) e uma falha dela não impede o boot', () => {
  const fonte = lerFonte('../../index.js');
  assert.match(fonte, /migrar\('2026_09_30_sync_datajud_r06', \(\) => aplicarMigracaoSyncR06\(db\)\)/);
  assert.match(fonte, /aplicarMigracaoSyncR06\(db\)\)\s*\n\s*\.catch\(e => console\.warn/);
  assert.match(fonte, /import \{ aplicarMigracaoSyncR06 \} from '\.\/services\/tribunal\/syncMigracao\.js'/);
});
