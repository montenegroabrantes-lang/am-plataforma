import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-cbc';
const KEY_HEX   = process.env.ENCRYPTION_KEY; // 64 hex chars = 32 bytes

function key() {
  if (!KEY_HEX || KEY_HEX.length !== 64) {
    throw new Error('ENCRYPTION_KEY ausente ou inválida. Deve ter 64 caracteres hex (32 bytes).');
  }
  return Buffer.from(KEY_HEX, 'hex');
}

export function encrypt(texto) {
  const iv         = randomBytes(16);
  const cipher     = createCipheriv(ALGORITHM, key(), iv);
  const encrypted  = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

export function decrypt(blob) {
  const [ivHex, encHex] = blob.split(':');
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}
