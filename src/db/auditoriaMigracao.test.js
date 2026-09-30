import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SQL_AUDITORIA_AUTOR, SQL_AUDITORIA_IMUTAVEL, migrarAuditoriaAutor, protegerAuditoria,
} from './auditoriaMigracao.js';

// S-13 — a migração da auditoria tem de ser idempotente e NÃO destrutiva: só acrescenta colunas,
// preenche o retrato do autor onde está vazio, cria índices e uma trava contra UPDATE/DELETE.
// Não há Postgres neste ambiente: o SQL é conferido como texto (a execução real é a do boot, e a
// verificação num Postgres 18 local vazio fica na lista de ações humanas).

const normalizar = sql => sql.replace(/\s+/g, ' ').trim();
const todos = [...SQL_AUDITORIA_AUTOR, ...SQL_AUDITORIA_IMUTAVEL].map(normalizar);

test('nenhuma instrução apaga dado ou estrutura de dados', () => {
  const destrutivo = /\b(DROP\s+(TABLE|COLUMN|INDEX|SCHEMA|DATABASE)|DELETE\s+FROM|TRUNCATE\s+TABLE|ALTER\s+TABLE\s+\S+\s+DROP|UPDATE\s+logs_auditoria\s+SET\s+(usuario_id|acao|entidade|valor_antes|valor_depois|ip|criado_em))/i;
  for (const sql of todos) assert.equal(destrutivo.test(sql), false, sql);
});

test('o único DROP é o do próprio trigger (para recriá-lo) e sempre com IF EXISTS', () => {
  const drops = todos.filter(s => /\bDROP\b/i.test(s));
  assert.equal(drops.length, 2);
  for (const d of drops) assert.match(d, /^DROP TRIGGER IF EXISTS trg_logs_auditoria_(imutavel|sem_truncate) ON logs_auditoria$/);
});

test('idempotente: colunas e índices com IF NOT EXISTS; função com OR REPLACE; trigger recriado', () => {
  for (const sql of SQL_AUDITORIA_AUTOR.map(normalizar)) {
    if (/^ALTER TABLE/.test(sql)) assert.match(sql, /ADD COLUMN IF NOT EXISTS/);
    if (/^CREATE INDEX/.test(sql)) assert.match(sql, /^CREATE INDEX IF NOT EXISTS/);
  }
  assert.match(normalizar(SQL_AUDITORIA_IMUTAVEL[0]), /^CREATE OR REPLACE FUNCTION logs_auditoria_somente_insercao\(\)/);
  const criacoes = SQL_AUDITORIA_IMUTAVEL.map(normalizar).filter(s => s.startsWith('CREATE TRIGGER'));
  assert.equal(criacoes.length, 2);
});

test('acrescenta usuario_nome e usuario_email, preenche o retrato só onde está vazio e indexa', () => {
  const [colNome, colEmail, preenche, idxCriado, idxAcao] = SQL_AUDITORIA_AUTOR.map(normalizar);
  assert.match(colNome, /ADD COLUMN IF NOT EXISTS usuario_nome TEXT/);
  assert.match(colEmail, /ADD COLUMN IF NOT EXISTS usuario_email TEXT/);
  assert.match(preenche, /^UPDATE logs_auditoria l SET usuario_nome = u\.nome, usuario_email = u\.email FROM usuarios u WHERE u\.id = l\.usuario_id AND l\.usuario_nome IS NULL$/);
  assert.match(idxCriado, /idx_logs_auditoria_criado ON logs_auditoria \(criado_em DESC\)/);
  assert.match(idxAcao, /idx_logs_auditoria_acao ON logs_auditoria \(acao, criado_em DESC\)/);
});

test('a função recusa DELETE e TRUNCATE e só deixa passar o preenchimento inicial do retrato', () => {
  const funcao = normalizar(SQL_AUDITORIA_IMUTAVEL[0]);
  // só o ramo UPDATE tem exceção, e ela exige nome/e-mail vazios e todas as outras colunas iguais
  assert.match(funcao, /IF TG_OP = 'UPDATE' THEN IF OLD\.usuario_nome IS NULL AND OLD\.usuario_email IS NULL AND ROW\(NEW\.id, NEW\.usuario_id, NEW\.acao, NEW\.entidade, NEW\.entidade_id, NEW\.valor_antes, NEW\.valor_depois, NEW\.ip, NEW\.criado_em\) IS NOT DISTINCT FROM ROW\(OLD\.id, OLD\.usuario_id, OLD\.acao, OLD\.entidade, OLD\.entidade_id, OLD\.valor_antes, OLD\.valor_depois, OLD\.ip, OLD\.criado_em\) THEN RETURN NEW; END IF; END IF;/);
  assert.match(funcao, /RAISE EXCEPTION 'logs_auditoria é somente de inserção \(% bloqueado\)', TG_OP USING ERRCODE = 'insufficient_privilege'/);
  // o RAISE vem depois do ramo UPDATE e vale para DELETE e TRUNCATE (o TRUNCATE nem lê OLD/NEW)
  assert.ok(funcao.indexOf('RAISE EXCEPTION') > funcao.indexOf("RETURN NEW"));
  const gatilhos = SQL_AUDITORIA_IMUTAVEL.map(normalizar).filter(s => s.startsWith('CREATE TRIGGER'));
  assert.match(gatilhos[0], /BEFORE UPDATE OR DELETE ON logs_auditoria FOR EACH ROW EXECUTE FUNCTION logs_auditoria_somente_insercao\(\)/);
  assert.match(gatilhos[1], /BEFORE TRUNCATE ON logs_auditoria FOR EACH STATEMENT EXECUTE FUNCTION logs_auditoria_somente_insercao\(\)/);
});

test('o preenchimento do retrato roda ANTES de existir a trava (e a trava é uma migração à parte)', () => {
  // migrações separadas: se a trava falhar, o INSERT do log (que depende das colunas) continua funcionando
  assert.equal(SQL_AUDITORIA_AUTOR.some(s => /TRIGGER/i.test(s)), false);
  assert.equal(SQL_AUDITORIA_IMUTAVEL.some(s => /ADD COLUMN/i.test(s)), false);
});

test('cada migração roda numa única transação, na ordem, e o erro propaga (não é marcada como feita)', async () => {
  const registro = [];
  const bancoFalso = (falharEm = null) => ({
    async transaction(fn) {
      registro.push('BEGIN');
      const tx = { async execute(sql) { registro.push(normalizar(sql)); if (falharEm && sql.includes(falharEm)) throw new Error('falhou'); } };
      try { const r = await fn(tx); registro.push('COMMIT'); return r; } catch (e) { registro.push('ROLLBACK'); throw e; }
    },
  });

  await migrarAuditoriaAutor(bancoFalso());
  assert.deepEqual(registro, ['BEGIN', ...SQL_AUDITORIA_AUTOR.map(normalizar), 'COMMIT']);

  registro.length = 0;
  await protegerAuditoria(bancoFalso());
  assert.deepEqual(registro, ['BEGIN', ...SQL_AUDITORIA_IMUTAVEL.map(normalizar), 'COMMIT']);

  registro.length = 0;
  await assert.rejects(protegerAuditoria(bancoFalso('BEFORE TRUNCATE')), /falhou/);
  assert.equal(registro.at(-1), 'ROLLBACK');
});

test('o boot registra as duas migrações pelo mecanismo migrar(); só a das colunas é obrigatória', () => {
  const index = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  assert.match(index, /await migrar\('2026_10_S13_auditoria_autor', \(\) => migrarAuditoriaAutor\(db\)\);/);
  // a trava é defesa extra: se falhar, avisa e o boot segue (o log continua sendo gravado)
  assert.match(index, /await migrar\('2026_10_S13_auditoria_imutavel', \(\) => protegerAuditoria\(db\)\)\s*\.catch\(/);
  // a das colunas NÃO engole o erro: sem elas o INSERT do log falharia em silêncio
  assert.equal(/migrarAuditoriaAutor\(db\)\)\s*\.catch/.test(index), false);
});

test('A1 (revisão): o gatilho de só-inserção é criado DEPOIS de todas as migrações obrigatórias (S-03 e R-06)', () => {
  const index = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  const pos = (marca) => index.indexOf(marca);
  const gatilho = pos("migrar('2026_10_S13_auditoria_imutavel'");
  assert.ok(gatilho > 0);
  assert.ok(gatilho > pos("migrar('2026_10_S03_sessao_revogavel'"), 'depois da migração da sessão');
  assert.ok(gatilho > pos("migrar('2026_09_30_sync_datajud_r06'"), 'depois da migração do sync');
  assert.ok(gatilho < pos('dbOk = true'), 'antes de liberar as rotas');
});
