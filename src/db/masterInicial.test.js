import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { garantirMasterInicial } from './masterInicial.js';

// S-06 — o migrate.js (pre-deploy) deixa de regravar senha/e-mail de Master a cada deploy.
// Só cria o primeiro Master de uma instalação nova; nunca altera um existente.

function bancoFalso({ masters = 0 } = {}) {
  const escritas = [];
  return {
    escritas,
    async queryOne(sql) {
      assert.match(sql, /FROM usuarios WHERE perfil = 'master'/);
      return masters > 0 ? { id: 'master-existente' } : null;
    },
    async execute(sql, params) { escritas.push({ sql: sql.replace(/\s+/g, ' ').trim(), params }); return { rowCount: 1 }; },
  };
}
const ENV_COM_VARIAVEIS = { MASTER_NOME: 'Fulana de Tal', MASTER_EMAIL: '  Fulana@Exemplo.Test ', MASTER_SENHA: 'senha-ficticia-123' };

test('já existe Master: não lê a senha, não calcula hash e não escreve nada (nem com as variáveis preenchidas)', async () => {
  const db = bancoFalso({ masters: 1 });
  let hashes = 0;
  const logs = [];
  const r = await garantirMasterInicial({ db, env: ENV_COM_VARIAVEIS, hashSenha: async () => { hashes++; return 'x'; }, log: m => logs.push(m) });
  assert.equal(r, 'existente');
  assert.equal(hashes, 0);
  assert.deepEqual(db.escritas, []);
  assert.ok(!logs.join(' ').toLowerCase().includes('senha') && !logs.join(' ').toLowerCase().includes('e-mail'), 'o log não fala de senha nem de e-mail de Master');
});

test('vários Masters e e-mail da variável diferente de todos: continua sem escrever (antes trocava o e-mail do mais antigo)', async () => {
  const db = bancoFalso({ masters: 3 });
  const r = await garantirMasterInicial({ db, env: { ...ENV_COM_VARIAVEIS, MASTER_EMAIL: 'outro@exemplo.test' }, hashSenha: async () => 'x', log: () => {} });
  assert.equal(r, 'existente');
  assert.deepEqual(db.escritas, []);
});

test('instalação nova (nenhum Master) com as variáveis: cria o Master, e-mail normalizado, perfil master', async () => {
  const db = bancoFalso({ masters: 0 });
  const r = await garantirMasterInicial({ db, env: ENV_COM_VARIAVEIS, hashSenha: async (s) => `hash(${s})`, log: () => {} });
  assert.equal(r, 'criado');
  assert.equal(db.escritas.length, 1);
  assert.match(db.escritas[0].sql, /^INSERT INTO usuarios/);
  assert.match(db.escritas[0].sql, /'master'/);
  assert.deepEqual(db.escritas[0].params, ['Fulana de Tal', 'fulana@exemplo.test', 'hash(senha-ficticia-123)']);
  assert.ok(!/UPDATE/i.test(db.escritas[0].sql));
});

test('nenhum Master e sem variáveis: não cria nada e avisa', async () => {
  for (const env of [{}, { MASTER_EMAIL: 'a@exemplo.test' }, { MASTER_SENHA: 'x' }]) {
    const db = bancoFalso({ masters: 0 });
    const logs = [];
    const r = await garantirMasterInicial({ db, env, hashSenha: async () => { throw new Error('não devia calcular hash'); }, log: m => logs.push(m) });
    assert.equal(r, 'sem_variaveis');
    assert.deepEqual(db.escritas, []);
    assert.equal(logs.length, 1);
  }
});

test('migrate.js e os scripts de deploy não têm mais nenhum UPDATE de senha/e-mail de usuário', () => {
  const migrate = readFileSync(new URL('../../migrate.js', import.meta.url), 'utf8');
  assert.ok(!/UPDATE\s+usuarios\s+SET\s+senha_hash/i.test(migrate), 'migrate.js não pode regravar senha');
  assert.ok(!/UPDATE\s+usuarios\s+SET[^`]*email/i.test(migrate), 'migrate.js não pode trocar e-mail');
  assert.ok(migrate.includes('garantirMasterInicial'), 'migrate.js usa a função que só cria');
  assert.ok(!/MASTER_SENHA/.test(migrate), 'migrate.js não lê MASTER_SENHA diretamente');
});

test('reset-senha.js e seed.js têm a trava --confirmo em produção', () => {
  const reset = readFileSync(new URL('../../reset-senha.js', import.meta.url), 'utf8');
  const seed = readFileSync(new URL('./seed.js', import.meta.url), 'utf8');
  for (const [nome, fonte] of [['reset-senha.js', reset], ['seed.js', seed]]) {
    assert.ok(fonte.includes('confirmacaoEmProducaoOk()'), `${nome} chama a trava`);
    // a trava tem que vir ANTES de qualquer leitura de MASTER_* ou escrita no banco
    assert.ok(fonte.indexOf('confirmacaoEmProducaoOk()') < fonte.indexOf('process.env.MASTER_SENHA'), `${nome}: trava antes de ler a senha`);
  }
});
