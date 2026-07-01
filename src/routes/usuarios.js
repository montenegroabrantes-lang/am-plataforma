import { Router } from 'express';
import bcrypt      from 'bcrypt';
import { db }      from '../db/index.js';
import { apenasMaster } from '../middleware/auth.js';
import { registrarAuditoria } from '../middleware/auditoria.js';

export const usuariosRouter = Router();

// GET /api/usuarios — lista usuários do mesmo Master (ou todos, se Master 01)
usuariosRouter.get('/', async (req, res) => {
  const { id, perfil, pode_marcar_restrito } = req.user;

  let rows;
  if (pode_marcar_restrito) {
    // Master 01 vê todos
    rows = await db.query(
      `SELECT id, nome, email, perfil, master_id, pode_marcar_restrito, ativo, criado_em, ultimo_acesso
       FROM usuarios ORDER BY perfil, nome`
    );
  } else if (perfil === 'master') {
    // Master 02 vê a si mesmo e seus juniors
    rows = await db.query(
      `SELECT id, nome, email, perfil, master_id, pode_marcar_restrito, ativo, criado_em, ultimo_acesso
       FROM usuarios WHERE id = $1 OR master_id = $1 ORDER BY perfil, nome`,
      [id]
    );
  } else {
    // Junior vê apenas a si mesmo
    rows = await db.query(
      `SELECT id, nome, email, perfil, master_id, pode_marcar_restrito, ativo, criado_em, ultimo_acesso
       FROM usuarios WHERE id = $1`,
      [id]
    );
  }

  res.json({ ok: true, usuarios: rows });
});

// POST /api/usuarios — cria novo usuário (apenas Master)
usuariosRouter.post('/', apenasMaster, async (req, res) => {
  const { nome, email, senha, perfil, master_id } = req.body;

  if (!nome || !email || !senha || !perfil) {
    return res.status(400).json({ ok: false, erro: 'nome, email, senha e perfil são obrigatórios.' });
  }

  if (!['master', 'junior'].includes(perfil)) {
    return res.status(400).json({ ok: false, erro: 'Perfil inválido.' });
  }

  // Junior deve ter master_id
  if (perfil === 'junior' && !master_id) {
    return res.status(400).json({ ok: false, erro: 'Junior precisa de master_id.' });
  }

  const hash = await bcrypt.hash(senha, 12);

  try {
    const [novo] = await db.query(
      `INSERT INTO usuarios (nome, email, senha_hash, perfil, master_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nome, email, perfil, master_id`,
      [nome.trim(), email.toLowerCase().trim(), hash, perfil, master_id ?? null]
    );

    await registrarAuditoria({
      usuarioId: req.user.id, acao: 'criar', entidade: 'usuario',
      entidadeId: novo.id, valorDepois: novo, ip: req._ip,
    });

    res.status(201).json({ ok: true, usuario: novo });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ ok: false, erro: 'Email já cadastrado.' });
    throw e;
  }
});

// PATCH /api/usuarios/me — o próprio usuário atualiza seu WhatsApp
usuariosRouter.patch('/me', async (req, res) => {
  const { whatsapp } = req.body;
  const phone = whatsapp ? String(whatsapp).replace(/\D/g, '') : null;
  await db.execute(
    `UPDATE usuarios SET whatsapp = $1 WHERE id = $2`,
    [phone || null, req.user.id]
  );
  res.json({ ok: true });
});

// PATCH /api/usuarios/:id — atualiza nome, email ou ativo
usuariosRouter.patch('/:id', apenasMaster, async (req, res) => {
  const { id } = req.params;
  const { nome, email, ativo } = req.body;

  const antes = await db.queryOne('SELECT * FROM usuarios WHERE id = $1', [id]);
  if (!antes) return res.status(404).json({ ok: false, erro: 'Usuário não encontrado.' });

  const novoNome  = nome  ?? antes.nome;
  const novoEmail = email ? email.toLowerCase().trim() : antes.email;
  const novoAtivo = ativo !== undefined ? ativo : antes.ativo;

  await db.execute(
    'UPDATE usuarios SET nome = $1, email = $2, ativo = $3 WHERE id = $4',
    [novoNome, novoEmail, novoAtivo, id]
  );

  await registrarAuditoria({
    usuarioId: req.user.id, acao: 'editar', entidade: 'usuario',
    entidadeId: id, valorAntes: antes, valorDepois: { nome: novoNome, email: novoEmail, ativo: novoAtivo },
    ip: req._ip,
  });

  res.json({ ok: true });
});

// PATCH /api/usuarios/:id/senha — redefine senha (Master)
usuariosRouter.patch('/:id/senha', apenasMaster, async (req, res) => {
  const { senha } = req.body;
  if (!senha || senha.length < 8) return res.status(400).json({ ok: false, erro: 'Senha mínima 8 caracteres.' });
  const hash = await bcrypt.hash(senha, 12);
  await db.execute('UPDATE usuarios SET senha_hash = $1 WHERE id = $2', [hash, req.params.id]);
  res.json({ ok: true });
});

// DELETE /api/usuarios/:id — exclui usuário (apenas Master com pode_marcar_restrito)
usuariosRouter.delete('/:id', apenasMaster, async (req, res) => {
  if (!req.user.pode_marcar_restrito) return res.status(403).json({ ok: false, erro: 'Apenas o Master principal pode excluir usuários.' });
  const alvo = await db.queryOne('SELECT * FROM usuarios WHERE id = $1', [req.params.id]);
  if (!alvo) return res.status(404).json({ ok: false, erro: 'Usuário não encontrado.' });
  if (alvo.id === req.user.id) return res.status(400).json({ ok: false, erro: 'Não é possível excluir a própria conta.' });

  // Anula todas as referências FK antes de excluir
  const uid = req.params.id;
  await db.execute(`UPDATE tarefas        SET atribuido_a            = NULL WHERE atribuido_a            = $1`, [uid]);
  await db.execute(`UPDATE tarefas        SET validado_por           = NULL WHERE validado_por           = $1`, [uid]);
  await db.execute(`UPDATE processos      SET master_responsavel_id  = NULL WHERE master_responsavel_id  = $1`, [uid]);
  await db.execute(`UPDATE publicacoes    SET lido_por               = NULL WHERE lido_por               = $1`, [uid]);
  await db.execute(`UPDATE usuarios       SET master_id              = NULL WHERE master_id              = $1`, [uid]);
  await db.execute(`UPDATE clientes       SET master_responsavel_id  = NULL WHERE master_responsavel_id  = $1`, [uid]);
  await db.execute(`UPDATE clientes       SET cadastrado_por         = NULL WHERE cadastrado_por         = $1`, [uid]);
  await db.execute(`UPDATE configuracoes  SET atualizado_por         = NULL WHERE atualizado_por         = $1`, [uid]);
  await db.execute(`UPDATE documentos     SET enviado_por            = NULL WHERE enviado_por            = $1`, [uid]);
  await db.execute(`UPDATE leads          SET master_responsavel_id  = NULL WHERE master_responsavel_id  = $1`, [uid]);
  await db.execute(`UPDATE leads          SET atribuido_a            = NULL WHERE atribuido_a            = $1`, [uid]);
  await db.execute(`UPDATE logs_auditoria SET usuario_id             = NULL WHERE usuario_id             = $1`, [uid]);
  await db.execute(`UPDATE audiencias  SET advogado_id            = NULL WHERE advogado_id            = $1`, [uid]);
  await db.execute(`UPDATE pecas       SET aprovada_por           = NULL WHERE aprovada_por           = $1`, [uid]);
  await db.execute(`UPDATE honorarios  SET master_responsavel_id  = NULL WHERE master_responsavel_id  = $1`, [uid]);
  await db.execute(`UPDATE honorarios  SET registrado_por         = NULL WHERE registrado_por         = $1`, [uid]);
  // Deleta registros onde usuario_id é NOT NULL (não pode ser anulado)
  await db.execute(`DELETE FROM credenciais_tribunal WHERE usuario_id = $1`, [uid]);
  await db.execute(`DELETE FROM notas WHERE autor_id = $1`, [uid]);

  await db.execute('DELETE FROM usuarios WHERE id = $1', [uid]);
  await registrarAuditoria({ usuarioId: req.user.id, acao: 'excluir', entidade: 'usuario', entidadeId: uid, valorAntes: alvo, ip: req._ip });
  res.json({ ok: true });
});
