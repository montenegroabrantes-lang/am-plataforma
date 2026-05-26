import { Router } from 'express';
import { db }      from '../db/index.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import { apenasMaster }    from '../middleware/auth.js';

export const credenciaisRouter = Router();

// GET /api/credenciais — lista credenciais do usuário autenticado (sem expor senhas)
credenciaisRouter.get('/', async (req, res) => {
  const userId = req.user.perfil === 'master' ? req.user.id : req.user.master_id;

  const rows = await db.query(
    `SELECT id, tribunal, grau, sistema, cpf, sessao_expira, ativo
     FROM credenciais_tribunal WHERE usuario_id = $1 ORDER BY tribunal, grau`,
    [userId]
  );

  res.json({ ok: true, credenciais: rows });
});

// POST /api/credenciais — cadastra credencial de tribunal (apenas Master)
credenciaisRouter.post('/', apenasMaster, async (req, res) => {
  const { tribunal, grau = '1', sistema, cpf, senha, totp_secret } = req.body;

  if (!tribunal || !sistema || !cpf || !senha) {
    return res.status(400).json({ ok: false, erro: 'tribunal, sistema, cpf e senha são obrigatórios.' });
  }

  const senhaEnc = encrypt(senha);
  const totpEnc  = totp_secret ? encrypt(totp_secret) : null;

  try {
    const [nova] = await db.query(
      `INSERT INTO credenciais_tribunal (usuario_id, tribunal, grau, sistema, cpf, senha_enc, totp_secret)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (usuario_id, tribunal, grau) DO UPDATE
         SET sistema = $4, cpf = $5, senha_enc = $6, totp_secret = $7, ativo = true
       RETURNING id, tribunal, grau, sistema, cpf, ativo`,
      [req.user.id, tribunal, grau, sistema, cpf, senhaEnc, totpEnc]
    );
    res.status(201).json({ ok: true, credencial: nova });
  } catch (e) {
    throw e;
  }
});

// DELETE /api/credenciais/:id (apenas Master)
credenciaisRouter.delete('/:id', apenasMaster, async (req, res) => {
  await db.execute(
    'UPDATE credenciais_tribunal SET ativo = false WHERE id = $1 AND usuario_id = $2',
    [req.params.id, req.user.id]
  );
  res.json({ ok: true });
});

// Exporta função auxiliar para serviços internos lerem credenciais descriptografadas
export async function lerCredencial(usuarioId, tribunal) {
  const cred = await db.queryOne(
    `SELECT * FROM credenciais_tribunal WHERE usuario_id = $1 AND tribunal = $2 AND ativo = true`,
    [usuarioId, tribunal]
  );
  if (!cred) return null;
  return {
    ...cred,
    senha:      decrypt(cred.senha_enc),
    totp_secret: cred.totp_secret ? decrypt(cred.totp_secret) : null,
  };
}
