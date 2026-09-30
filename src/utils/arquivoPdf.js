// S-24 — upload de documentos: só PDF, com limite de tamanho por perfil.

const MB = 1024 * 1024;

// Assinatura de um PDF: os 5 primeiros bytes são "%PDF-". O nome do arquivo e o Content-Type vêm
// do navegador (quem envia escolhe), então só o conteúdo vale.
const ASSINATURA_PDF = Buffer.from('%PDF-');

export function ehPdf(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= ASSINATURA_PDF.length
    && buffer.subarray(0, ASSINATURA_PDF.length).equals(ASSINATURA_PDF);
}

// Master 20 MB (o limite de sempre); júnior 10 MB. Perfil desconhecido recebe o menor.
export const LIMITES_UPLOAD = { master: 20 * MB, junior: 10 * MB };
export const LIMITE_MAXIMO_UPLOAD = Math.max(...Object.values(LIMITES_UPLOAD));

export const limiteDeUploadDoPerfil = perfil =>
  (Object.hasOwn(LIMITES_UPLOAD, perfil) ? LIMITES_UPLOAD[perfil] : Math.min(...Object.values(LIMITES_UPLOAD)));
