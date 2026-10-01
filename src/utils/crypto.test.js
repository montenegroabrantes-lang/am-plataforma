import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

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

function blobCbc(texto) {
  const keyBuf = Buffer.from(KEY_HEX, 'hex');
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', keyBuf, iv);
  const enc = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${enc.toString('hex')}`;
}

test('decrypt lê formato legado CBC (iv:ciphertext) sem prefixo e avisa no log (uma vez por processo)', () => {
  // Simula uma credencial antiga gravada em AES-256-CBC
  const avisos = [];
  const original = console.warn;
  console.warn = (...a) => avisos.push(a.join(' '));
  try {
    assert.equal(decrypt(blobCbc('credencial-antiga')), 'credencial-antiga');
    assert.equal(decrypt(blobCbc('outra-credencial')), 'outra-credencial');
  } finally { console.warn = original; }
  assert.equal(avisos.length, 1, 'avisa só na primeira leitura CBC');
  assert.match(avisos[0], /legado CBC/);
  assert.ok(!avisos[0].includes('credencial-antiga'), 'o aviso não traz o conteúdo');
});

// ── S-10 (fase 1): o decrypt aprende "gcm:v1:"; o encrypt continua gravando "gcm:" ──
// Valor gcm:v1 FIXO (gerado uma vez com AES-256-GCM, a chave de teste 'a'*64 e o texto 'valor-versionado-ficticio'):
// prova que a leitura funciona com um blob que não foi produzido pelo encrypt deste código.
const V1_FIXO = 'gcm:v1:0123456789abcdef01234567:22382172dad6d70f84097c2dd22676db:ee5572fcb64bf4935e0d18fc28dc6bbfdb2d4ae67b2fdc9c66';

test('decrypt lê o formato versionado gcm:v1:iv:tag:ct (mesma chave)', () => {
  assert.equal(decrypt(V1_FIXO), 'valor-versionado-ficticio');
  assert.equal(V1_FIXO.split(':').length, 5);
});

test('gcm:v1 adulterado (ciphertext, tag ou iv) é detectado', () => {
  const [p, v, iv, tag, ct] = V1_FIXO.split(':');
  const troca = (h) => h.slice(0, -2) + (h.slice(-2) === 'ff' ? '00' : 'ff');
  assert.throws(() => decrypt([p, v, iv, tag, troca(ct)].join(':')));
  assert.throws(() => decrypt([p, v, iv, troca(tag), ct].join(':')));
  assert.throws(() => decrypt([p, v, troca(iv), tag, ct].join(':')));
});

test('o encrypt AINDA grava "gcm:" (4 partes), nunca "gcm:v1:" — reverter a onda continua seguro', () => {
  for (let i = 0; i < 5; i++) {
    const blob = encrypt(`texto-${i}`);
    assert.ok(blob.startsWith('gcm:') && !blob.startsWith('gcm:v1:'), blob.slice(0, 10));
    assert.equal(blob.split(':').length, 4);
  }
  const fonte = readFileSync(new URL('./crypto.js', import.meta.url), 'utf8');
  assert.ok(!/return\s+`gcm:v1:/.test(fonte), 'encrypt não pode devolver o formato v1 nesta fase');
});

test('gcm legado (4 partes) continua lido depois da mudança', () => {
  const blob = encrypt('legado-gcm');
  assert.equal(blob.split(':').length, 4);
  assert.equal(decrypt(blob), 'legado-gcm');
});

test('decrypt rejeita entrada que não é string', () => {
  assert.throws(() => decrypt(null));
  assert.throws(() => decrypt(123));
});
