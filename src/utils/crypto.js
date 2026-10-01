import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// AES-256-GCM (autenticado) — protege contra padding oracle e adulteração silenciosa.
// Formato atual de escrita: "gcm:<iv_hex>:<authTag_hex>:<ciphertext_hex>"
// Formato versionado (S-10, só LEITURA por enquanto): "gcm:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>" — prepara a
// rotação de chave. A ESCRITA continua em "gcm:" de propósito: só depois que esta leitura estiver em produção
// o encrypt passa a gravar "gcm:v1:" (senão, revertido este deploy, o que foi gravado ficaria ilegível).
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

let avisouCbc = false;

export function decrypt(blob) {
  if (typeof blob !== 'string') throw new Error('decrypt: blob inválido');

  // Formatos GCM: gcm:iv:authTag:ciphertext (atual) e gcm:v1:iv:authTag:ciphertext (versionado, mesma chave).
  // "v1" não é hexadecimal, então nunca se confunde com o iv do formato atual.
  if (blob.startsWith('gcm:')) {
    const partes = blob.split(':');
    const [ivHex, tagHex, encHex] = partes[1] === 'v1' ? partes.slice(2) : partes.slice(1);
    const decipher = createDecipheriv(GCM_ALGO, key(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const dec = Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]);
    return dec.toString('utf8');
  }

  // Formato legado CBC: iv:ciphertext — só leitura; tudo que é re-salvo vira GCM.
  // Avisa uma vez por processo, para dar para ver no log se ainda sobrou dado nesse formato.
  if (!avisouCbc) {
    avisouCbc = true;
    console.warn('[crypto] Lido um valor no formato legado CBC (só leitura). Regrave-o para migrar para GCM.');
  }
  const [ivHex, encHex] = blob.split(':');
  const decipher = createDecipheriv(CBC_ALGO, key(), Buffer.from(ivHex, 'hex'));
  const dec = Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]);
  return dec.toString('utf8');
}
