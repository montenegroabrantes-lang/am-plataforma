import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// AES-256-GCM (autenticado) — protege contra padding oracle e adulteração silenciosa.
// Formato novo: "gcm:<iv_hex>:<authTag_hex>:<ciphertext_hex>"
// Formato legado (CBC): "<iv_hex>:<ciphertext_hex>" — ainda lido para não invalidar credenciais existentes.
const GCM_ALGO = 'aes-256-gcm';
const CBC_ALGO = 'aes-256-cbc';
const KEY_HEX  = process.env.ENCRYPTION_KEY; // 64 hex chars = 32 bytes

function key() {
  if (!KEY_HEX || KEY_HEX.length !== 64) {
    throw new Error('ENCRYPTION_KEY ausente ou inválida. Deve ter 64 caracteres hex (32 bytes).');
  }
  return Buffer.from(KEY_HEX, 'hex');
}

export function encrypt(texto) {
  const iv       = randomBytes(12);              // 12 bytes é o tamanho recomendado p/ GCM
  const cipher   = createCipheriv(GCM_ALGO, key(), iv);
  const encrypted = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  const authTag   = cipher.getAuthTag();
  return `gcm:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(blob) {
  if (typeof blob !== 'string') throw new Error('decrypt: blob inválido');

  // Formato novo: gcm:iv:authTag:ciphertext
  if (blob.startsWith('gcm:')) {
    const [, ivHex, tagHex, encHex] = blob.split(':');
    const decipher = createDecipheriv(GCM_ALGO, key(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const dec = Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]);
    return dec.toString('utf8');
  }

  // Formato legado CBC: iv:ciphertext — só leitura; tudo que é re-salvo vira GCM.
  const [ivHex, encHex] = blob.split(':');
  const decipher = createDecipheriv(CBC_ALGO, key(), Buffer.from(ivHex, 'hex'));
  const dec = Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]);
  return dec.toString('utf8');
}
