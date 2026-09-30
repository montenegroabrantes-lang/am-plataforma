import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aplicarMigracoesS10, apagarCredencialPjeLigado } from './migracoesS10.js';

// S-10 — senha/2FA do PJe guardados sem uso. A limpeza é destrutiva e depende da decisão D5,
// por isso fica atrás da flag APAGAR_CREDENCIAL_PJE_ATIVO (desligada por padrão).

function ambiente() {
  const sqls = [];          // tudo o que foi executado, na ordem
  const executadas = new Set(); // "schema_migrations"
  const txs = [];
  const db = {
    async execute(sql) { sqls.push({ onde: 'db', sql: sql.replace(/\s+/g, ' ').trim() }); return { rowCount: 0 }; },
    async transaction(fn) {
      const tx = {
        async execute(sql, params) {
          const s = sql.replace(/\s+/g, ' ').trim();
          sqls.push({ onde: 'tx', sql: s, params });
          return { rowCount: s.startsWith('UPDATE credenciais_tribunal') ? 1 : 0 };
        },
      };
      txs.push(tx);
      return fn(tx);
    },
  };
  const migrar = async (nome, fn) => { if (executadas.has(nome)) return; await fn(); executadas.add(nome); };
  return { db, migrar, sqls, executadas };
}

test('flag desligada (padrão): só torna senha_enc opcional; NADA é apagado e a migração destrutiva nem é registrada', async () => {
  const { db, migrar, sqls, executadas } = ambiente();
  await aplicarMigracoesS10({ db, migrar, env: {} });
  assert.deepEqual([...executadas], ['2026_10_S10_senha_pje_opcional']);
  assert.equal(sqls.length, 1);
  assert.match(sqls[0].sql, /ALTER COLUMN senha_enc DROP NOT NULL/);
  assert.ok(!sqls.some(q => /UPDATE|DELETE|DROP TABLE|DROP COLUMN/i.test(q.sql)));
});

test('flag com qualquer valor diferente de "true" continua desligada', async () => {
  for (const valor of ['', 'false', '0', 'sim', 'yes', 'TRUEE', undefined]) {
    const { db, migrar, sqls } = ambiente();
    await aplicarMigracoesS10({ db, migrar, env: { APAGAR_CREDENCIAL_PJE_ATIVO: valor } });
    assert.ok(!sqls.some(q => /UPDATE/i.test(q.sql)), `valor ${valor}`);
  }
  assert.equal(apagarCredencialPjeLigado({ APAGAR_CREDENCIAL_PJE_ATIVO: ' TRUE ' }), true);
});

test('flag ligada: limpa senha, 2FA e cookie numa transação, mantém CPF/OAB/ativo e audita só a contagem', async () => {
  const { db, migrar, sqls, executadas } = ambiente();
  await aplicarMigracoesS10({ db, migrar, env: { APAGAR_CREDENCIAL_PJE_ATIVO: 'true' } });
  assert.deepEqual([...executadas], ['2026_10_S10_senha_pje_opcional', '2026_10_S10_apagar_credencial_pje']);
  // a coluna tem que ficar opcional ANTES da limpeza (senão o UPDATE ... = NULL falharia)
  assert.match(sqls[0].sql, /DROP NOT NULL/);
  const update = sqls.find(q => q.onde === 'tx' && /^UPDATE credenciais_tribunal/.test(q.sql));
  assert.ok(update, 'UPDATE dentro da transação');
  assert.match(update.sql, /SET senha_enc = NULL, totp_secret = NULL, sessao_cookie = NULL/);
  for (const preservado of ['cpf', 'oab', 'ativo', 'tribunal']) assert.ok(!new RegExp(`\\b${preservado}\\s*=`, 'i').test(update.sql.split('WHERE')[0]), `${preservado} não é alterado`);
  assert.ok(!sqls.some(q => /DELETE|DROP COLUMN|DROP TABLE|TRUNCATE/i.test(q.sql)), 'não apaga linhas nem colunas');
  const auditoria = sqls.find(q => q.onde === 'tx' && /INSERT INTO logs_auditoria/.test(q.sql));
  assert.ok(auditoria, 'auditoria na MESMA transação');
  assert.equal(auditoria.params[1], 'apagar_credencial_tribunal');
  assert.deepEqual(JSON.parse(auditoria.params[5]), { linhas_limpas: 1 });
});

test('roda uma única vez: no boot seguinte (flag ainda ligada) não repete a limpeza', async () => {
  const { db, migrar, sqls } = ambiente();
  await aplicarMigracoesS10({ db, migrar, env: { APAGAR_CREDENCIAL_PJE_ATIVO: 'true' } });
  const antes = sqls.length;
  await aplicarMigracoesS10({ db, migrar, env: { APAGAR_CREDENCIAL_PJE_ATIVO: 'true' } });
  assert.equal(sqls.length, antes);
});

test('ligar a flag depois (deploy posterior) ainda executa a limpeza: ela não foi "gasta" com a flag desligada', async () => {
  const { db, migrar, sqls } = ambiente();
  await aplicarMigracoesS10({ db, migrar, env: {} });
  assert.ok(!sqls.some(q => /^UPDATE/.test(q.sql)));
  await aplicarMigracoesS10({ db, migrar, env: { APAGAR_CREDENCIAL_PJE_ATIVO: 'true' } });
  assert.ok(sqls.some(q => /^UPDATE credenciais_tribunal/.test(q.sql)));
});

test('falha na limpeza propaga (a migração real não é marcada como feita e tenta de novo no próximo boot)', async () => {
  const { db, migrar, executadas } = ambiente();
  db.transaction = async () => { throw new Error('falha simulada'); };
  await assert.rejects(aplicarMigracoesS10({ db, migrar, env: { APAGAR_CREDENCIAL_PJE_ATIVO: 'true' } }), /falha simulada/);
  assert.ok(!executadas.has('2026_10_S10_apagar_credencial_pje'));
});

// ── código: nada mais lê nem grava a senha/2FA/cookie do PJe ─────────────────
const SRC = fileURLToPath(new URL('..', import.meta.url));
function arquivosJs(dir) {
  return readdirSync(dir).flatMap(nome => {
    const p = path.join(dir, nome);
    if (statSync(p).isDirectory()) return arquivosJs(p);
    return p.endsWith('.js') && !p.endsWith('.test.js') ? [p] : [];
  });
}

test('rota /api/credenciais removida: arquivo, import e montagem sumiram (a migração agora é o único código que toca nesses campos)', () => {
  assert.equal(existsSync(new URL('../routes/credenciais.js', import.meta.url)), false);
  const index = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  assert.ok(!/credenciaisRouter|routes\/credenciais|\/api\/credenciais/.test(index));
  assert.ok(index.includes('aplicarMigracoesS10'), 'a migração está ligada no boot');
  for (const arq of arquivosJs(SRC)) {
    assert.ok(!/routes\/credenciais\.js/.test(readFileSync(arq, 'utf8')), `${path.relative(SRC, arq)} ainda importa a rota removida`);
  }
});

test('nenhum código de produção lê ou grava senha_enc / sessao_cookie de credenciais_tribunal (só a migração)', () => {
  const tocam = arquivosJs(SRC)
    .filter(arq => /senha_enc|sessao_cookie/.test(readFileSync(arq, 'utf8')))
    .map(arq => path.relative(SRC, arq));
  assert.deepEqual(tocam, [path.join('db', 'migracoesS10.js')]);
});

test('a separação de sócios do sync usa só o CPF de credenciais_tribunal (continua funcionando sem a senha)', () => {
  const sync = readFileSync(new URL('../services/tribunal/sync.js', import.meta.url), 'utf8');
  const trecho = sync.slice(sync.indexOf('async function resolverSeparacaoSocios'), sync.indexOf('async function registrarFalhaSyncProcesso'));
  assert.match(trecho, /JOIN credenciais_tribunal ct/);
  assert.match(trecho, /ct\.cpf = ANY/);
  assert.ok(!/senha|totp|cookie/i.test(trecho));
});
