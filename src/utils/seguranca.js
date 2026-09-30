import { createHash, timingSafeEqual } from 'crypto';

// Comparação de chaves/segredos em tempo constante (S-08).
// Compara o SHA-256 das duas pontas: o tempo não depende de onde a primeira diferença está
// nem do tamanho da chave recebida (comparar Buffers de tamanhos diferentes exigiria um
// `if (a.length !== b.length)` que revelaria o tamanho da chave esperada).
// Vazio/ausente de qualquer lado nunca é igual — servidor sem chave configurada não aceita ninguém.
export function mesmaChave(recebida, esperada) {
  if (!recebida || !esperada) return false;
  const a = createHash('sha256').update(String(recebida)).digest();
  const b = createHash('sha256').update(String(esperada)).digest();
  return timingSafeEqual(a, b);
}
