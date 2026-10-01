import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';

// Lote S / S-16 — a troca do bcrypt 5 pelo 6 não pode trancar ninguém para fora: os hashes que
// já estão gravados em usuarios.senha_hash (custo 12) têm de continuar conferindo. Os dois
// hashes abaixo foram gerados com o bcrypt 5.1.1 (a biblioteca de antes da troca) para uma
// senha fictícia; o teste vale para qualquer versão instalada e prova a compatibilidade
// quando o bcrypt novo estiver em node_modules.
const SENHA_FICTICIA = 'senha-ficticia-g6-2026';
const HASH_2B_BCRYPT_5 = '$2b$12$XL4waDDu/.V.5wDPtLPYZ.uIpVanLw5dsSwYDk5WvMUldvk9NDhpe';
const HASH_2A_BCRYPT_5 = '$2a$12$yuUt33OoIB2Ng3bpBcHJ7e7KTCyiLdH7s.hAdPl5./jQZ4l5I6DoO';

test('hash $2b$12$ gerado pela biblioteca antiga confere com a instalada', async () => {
  assert.equal(await bcrypt.compare(SENHA_FICTICIA, HASH_2B_BCRYPT_5), true);
});

test('hash legado $2a$12$ também confere', async () => {
  assert.equal(await bcrypt.compare(SENHA_FICTICIA, HASH_2A_BCRYPT_5), true);
});

test('senha errada, maiúscula trocada ou vazia não conferem com o hash antigo', async () => {
  assert.equal(await bcrypt.compare('senha-ficticia-g6-2027', HASH_2B_BCRYPT_5), false);
  assert.equal(await bcrypt.compare(SENHA_FICTICIA.toUpperCase(), HASH_2B_BCRYPT_5), false);
  assert.equal(await bcrypt.compare('', HASH_2B_BCRYPT_5), false);
});

test('hash novo continua no formato $2b$12$ e confere (o login grava assim)', async () => {
  const hash = await bcrypt.hash(SENHA_FICTICIA, 12);
  assert.match(hash, /^\$2b\$12\$[./A-Za-z0-9]{53}$/);
  assert.equal(await bcrypt.compare(SENHA_FICTICIA, hash), true);
  assert.equal(await bcrypt.compare('outra-senha', hash), false);
  assert.notEqual(hash, await bcrypt.hash(SENHA_FICTICIA, 12), 'o sal precisa ser aleatório');
});

test('a API que o código usa (hash, compare, genSalt, hashSync, compareSync) existe', () => {
  for (const nome of ['hash', 'compare', 'genSalt', 'hashSync', 'compareSync']) {
    assert.equal(typeof bcrypt[nome], 'function', nome);
  }
});
