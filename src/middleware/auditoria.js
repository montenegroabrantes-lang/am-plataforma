import { db } from '../db/index.js';

// Registra ações destrutivas no log de auditoria
export function auditar(req, _res, next) {
  req._ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
  next();
}

export async function registrarAuditoria({ usuarioId, acao, entidade, entidadeId, valorAntes, valorDepois, ip }) {
  try {
    await db.execute(
      `INSERT INTO logs_auditoria (usuario_id, acao, entidade, entidade_id, valor_antes, valor_depois, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        usuarioId  ?? null,
        acao,
        entidade,
        entidadeId ?? null,
        valorAntes  ? JSON.stringify(valorAntes)  : null,
        valorDepois ? JSON.stringify(valorDepois) : null,
        ip ?? null,
      ]
    );
  } catch (err) {
    // Log nunca pode derrubar o request principal
    console.error('[Auditoria] Falha ao registrar:', err.message);
  }
}
