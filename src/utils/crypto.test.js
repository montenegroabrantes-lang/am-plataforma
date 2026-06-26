import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, randomBytes } from 'node:crypto';

// Chave de teste (32 bytes / 64 hex) — definida ANTES de importar o módulo,
// pois crypto.js captura process.env.ENCRYPTION_KEY no carregamento.
const KEY_HEX = 'a'.repeat(64);
process.env.ENCRYPTION_KEY = KEY_HEX;

const { encrypt, decrypt } = await import('./crypto.js');

test('encrypt → decrypt devolve o texto original (round-trip GCM)', () => {
  const original = 'senha-do-tribunal-123!@#';
  const blob = encrypt(original);
  assert.equal(decrypt(blob), original);
});

test('formato novo usa prefixo "gcm:" com iv:authTag:ciphertext', () => {
  const blob = encrypt('x');
  assert.ok(blob.startsWith('gcm:'), `esperado prefixo gcm:, veio ${blob.slice(0, 8)}`);
  assert.equal(blob.split(':').length, 4); // gcm + iv + tag + ciphertext
});

test('cada encrypt gera IV diferente (não é determinístico)', () => {
  assert.notEqual(encrypt('mesmo'), encrypt('mesmo'));
});

test('adulteração do ciphertext é detectada (authTag GCM)', () => {
  const blob = encrypt('dado-sensivel');
  const [prefixo, iv, tag, ct] = blob.split(':');
  // Inverte o último byte do ciphertext
  const ctAdulterado = ct.slice(0, -2) + (ct.slice(-2) === 'ff' ? '00' : 'ff');
  const blobRuim = [prefixo, iv, tag, ctAdulterado].join(':');
  assert.throws(() => decrypt(blobRuim));
});

test('decrypt lê formato legado CBC (iv:ciphertext) sem prefixo', () => {
  // Simula uma credencial antiga gravada em AES-256-CBC
  const keyBuf = Buffer.from(KEY_HEX, 'hex');
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', keyBuf, iv);
  const enc = Buffer.concat([cipher.update('credencial-antiga', 'utf8'), cipher.final()]);
  const blobLegado = `${iv.toString('hex')}:${enc.toString('hex')}`;

  assert.equal(decrypt(blobLegado), 'credencial-antiga');
});

test('decrypt rejeita entrada que não é string', () => {
  assert.throws(() => decrypt(null));
  assert.throws(() => decrypt(123));
});
