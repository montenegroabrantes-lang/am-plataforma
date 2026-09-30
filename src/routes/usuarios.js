import { Router } from 'express';
import bcrypt      from 'bcrypt';
import { db }      from '../db/index.js';
import { apenasMaster } from '../middleware/auth.js';
import { registrarAuditoria } from '../middleware/auditoria.js';
import { uuidValido } from '../utils/validacao.js';
import { invalidarSessao } from '../middleware/sessao.js';
import { derrubarSessoes, revogarSessoesDoUsuario, SENHA_MIN, SENHA_MAX } from '../services/sessao.js';

export const usuariosRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const emailNormalizado = (v) => String(v ?? '').trim().toLowerCase();
const emailValido = (v) => v.length <= 254 && EMAIL_RE.test(v);

// S-05: hierarquia. O Master 01 (pode_marcar_restrito) altera qualquer usuário; o Master comum, só a
// si mesmo e aos próprios juniores (master_id = ele); outro Master, só o Master 01.
function podeAlterar(logado, alvo) {
  if (logado.pode_marcar_restrito) return true;
  if (alvo.id === logado.id) return true;
  return alvo.perfil === 'junior' && alvo.master_id === logado.id;
}
const negarHierarquia = (res, alvo, acaoMaster, acaoJunior) => res.status(403).json({
  ok: false,
  erro: alvo.perfil === 'master'
    ? `Apenas o Master principal pode ${acaoMaster} outro master.`
    : `Você só pode ${acaoJunior}.`,
});

// GET /api/usuarios — lista usuários do mesmo Master (ou todos, se Master 01)
usuariosRouter.get('/', async (req, res) => {
  const { id, perfil, pode_marcar_restrito } = req.user;

  let rows;
  if (pode_marcar_restrito) {
    // Master 01 vê todos
    rows = await db.query(
      `SELECT id, nome, email, perfil, master_id, pode_marcar_restrito, aprova_reprotocolo, ativo, criado_em, ultimo_acesso
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
    // Junior vê a si mesmo e os demais usuários do mesmo Master (para indicar responsáveis)
    rows = await db.query(
      `SELECT id, nome, email, perfil, master_id, pode_marcar_restrito, ativo, criado_em, ultimo_acesso
       FROM usuarios WHERE id = $1 OR master_id = $2 OR id = $2 ORDER BY perfil, nome`,
      [id, req.user.master_id]
    );
  }

  res.json({ ok: true, usuarios: rows });
});

// POST /api/usuarios — cria novo usuário (apenas Master)
usuariosRouter.post('/', apenasMaster, async (req, res) => {
  const { nome, email, senha, perfil, master_id } = req.body || {};

  if (!nome || !email || !senha || !perfil) {
    return res.status(400).json({ ok: false, erro: 'nome, email, senha e perfil são obrigatórios.' });
  }
  if (typeof nome !== 'string' || typeof email !== 'string' || typeof senha !== 'string') {
    return res.status(400).json({ ok: false, erro: 'nome, email e senha devem ser texto.' });
  }

  if (!['master', 'junior'].includes(perfil)) {
    return res.status(400).json({ ok: false, erro: 'Perfil inválido.' });
  }

  // S-05: só o Master 01 cria outro Master (senão qualquer Master criaria um igual a ele e a hierarquia
  // de PATCH/senha seria contornável).
  if (perfil === 'master' && !req.user.pode_marcar_restrito) {
    return res.status(403).json({ ok: false, erro: 'Apenas o Master principal pode criar outro master.' });
  }

  // Junior deve ter master_id
  if (perfil === 'junior' && !master_id) {
    return res.status(400).json({ ok: false, erro: 'Junior precisa de master_id.' });
  }
  if (perfil === 'junior') {
    if (!uuidValido(master_id)) return res.status(400).json({ ok: false, erro: 'master_id inválido.' });
    // S-05: o Master comum só cria júnior vinculado a ele mesmo; o Master 01, a qualquer Master ativo.
    if (!req.user.pode_marcar_restrito && master_id !== req.user.id) {
      return res.status(403).json({ ok: false, erro: 'Você só pode criar juniores vinculados a você.' });
    }
    if (master_id !== req.user.id) {
      const responsavel = await db.queryOne(`SELECT id FROM usuarios WHERE id = $1 AND perfil = 'master' AND ativo = true`, [master_id]);
      if (!responsavel) return res.status(400).json({ ok: false, erro: 'Master responsável inexistente ou inativo.' });
    }
  }

  const emailNovo = emailNormalizado(email);
  if (!emailValido(emailNovo)) return res.status(400).json({ ok: false, erro: 'E-mail inválido.' });

  // A senha inicial é provisória (a pessoa cria a própria no primeiro acesso), mas já segue o mínimo do sistema.
  if (typeof senha !== 'string' || senha.length < SENHA_MIN || senha.length > SENHA_MAX) {
    return res.status(400).json({ ok: false, erro: `A senha deve ter entre ${SENHA_MIN} e ${SENHA_MAX} caracteres.` });
  }

  const hash = await bcrypt.hash(senha, 12);

  try {
    const [novo] = await db.query(
      `INSERT INTO usuarios (nome, email, senha_hash, perfil, master_id, senha_temporaria)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING id, nome, email, perfil, master_id`,
      [nome.trim(), emailNovo, hash, perfil, perfil === 'junior' ? master_id : null]
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

// PATCH /api/usuarios/:id — atualiza nome, email, ativo ou (só o Master 01) a marcação de aprovador do re-protocolo
usuariosRouter.patch('/:id', apenasMaster, async (req, res) => {
  const { id } = req.params;
  if (!uuidValido(id)) return res.status(400).json({ ok: false, erro: 'ID inválido.' });
  const { nome, email, ativo, aprova_reprotocolo: aprova } = req.body || {};

  const antes = await db.queryOne('SELECT id, nome, email, perfil, master_id, ativo, aprova_reprotocolo, criado_em FROM usuarios WHERE id = $1', [id]);
  if (!antes) return res.status(404).json({ ok: false, erro: 'Usuário não encontrado.' });

  // S-05: hierarquia — outro Master só o Master 01 altera; o Master comum, só os próprios juniores
  if (!podeAlterar(req.user, antes)) return negarHierarquia(res, antes, 'alterar', 'alterar os seus próprios juniores');

  if (ativo !== undefined && typeof ativo !== 'boolean') return res.status(400).json({ ok: false, erro: 'ativo deve ser true ou false.' });
  // Ninguém desativa a si mesmo (e ninguém se reativa por aqui): o `ativo` da própria conta é de outra pessoa
  if (ativo !== undefined && ativo !== antes.ativo && id === req.user.id) {
    return res.status(403).json({ ok: false, erro: 'Você não pode alterar o status da própria conta.' });
  }
  if (nome !== undefined && (typeof nome !== 'string' || !nome.trim())) return res.status(400).json({ ok: false, erro: 'nome inválido.' });

  let novoEmail = antes.email;
  if (email !== undefined && email !== null && email !== '') {
    novoEmail = emailNormalizado(email);
    if (typeof email !== 'string' || !emailValido(novoEmail)) return res.status(400).json({ ok: false, erro: 'E-mail inválido.' });
  }

  const novoNome  = nome !== undefined ? nome.trim() : antes.nome;
  const novoAtivo = ativo !== undefined ? ativo : antes.ativo;

  // D-S4: quem aprova o re-protocolo é marcado no cadastro — só o Master 01, e só num Master ativo
  let novoAprova = antes.aprova_reprotocolo;
  if (aprova !== undefined) {
    if (typeof aprova !== 'boolean') return res.status(400).json({ ok: false, erro: 'aprova_reprotocolo deve ser true ou false.' });
    if (!req.user.pode_marcar_restrito) return res.status(403).json({ ok: false, erro: 'Apenas o Master principal define quem aprova o re-protocolo.' });
    if (aprova && (antes.perfil !== 'master' || !novoAtivo)) return res.status(400).json({ ok: false, erro: 'Só um Master ativo pode ser aprovador do re-protocolo.' });
    novoAprova = aprova;
  }

  try {
    await db.execute(
      'UPDATE usuarios SET nome = $1, email = $2, ativo = $3, aprova_reprotocolo = $4 WHERE id = $5',
      [novoNome, novoEmail, novoAtivo, novoAprova, id]
    );
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ ok: false, erro: 'Email já cadastrado.' });
    throw e;
  }

  // Desativar/reativar ou trocar o e-mail derruba todas as sessões da conta (sobe a versão e revoga os refresh).
  if (novoAtivo !== antes.ativo || novoEmail !== antes.email) await derrubarSessoes(id);
  else invalidarSessao(id); // nome mudou: só renova o cache

  await registrarAuditoria({
    usuarioId: req.user.id, acao: 'editar', entidade: 'usuario',
    entidadeId: id, valorAntes: antes, valorDepois: { nome: novoNome, email: novoEmail, ativo: novoAtivo },
    ip: req._ip,
  });
  if (novoAprova !== antes.aprova_reprotocolo) {
    await registrarAuditoria({
      usuarioId: req.user.id, acao: 'definir_aprovador_reprotocolo', entidade: 'usuario',
      entidadeId: id, valorAntes: { aprova_reprotocolo: antes.aprova_reprotocolo }, valorDepois: { aprova_reprotocolo: novoAprova },
      ip: req._ip,
    });
  }

  res.json({ ok: true });
});

// PATCH /api/usuarios/:id/senha — redefine senha (Master). A senha vira PROVISÓRIA: a pessoa cria a própria no
// próximo login, e as sessões abertas dela caem. O log não guarda o valor.
usuariosRouter.patch('/:id/senha', apenasMaster, async (req, res) => {
  const { senha } = req.body || {};
  if (!uuidValido(req.params.id)) return res.status(400).json({ ok: false, erro: 'ID inválido.' });
  if (typeof senha !== 'string' || senha.length < SENHA_MIN) return res.status(400).json({ ok: false, erro: `Senha mínima ${SENHA_MIN} caracteres.` });
  if (senha.length > SENHA_MAX) return res.status(400).json({ ok: false, erro: `Senha máxima ${SENHA_MAX} caracteres.` });

  const alvo = await db.queryOne('SELECT id, perfil, master_id FROM usuarios WHERE id = $1', [req.params.id]);
  if (!alvo) return res.status(404).json({ ok: false, erro: 'Usuário não encontrado.' });
  // S-05: mesma hierarquia do PATCH — outro Master só o Master 01; o Master comum, só os próprios juniores
  if (!podeAlterar(req.user, alvo)) return negarHierarquia(res, alvo, 'redefinir a senha de', 'redefinir a senha dos seus próprios juniores');

  const hash = await bcrypt.hash(senha, 12);
  const alterado = await db.queryOne(
    'UPDATE usuarios SET senha_hash = $1, senha_temporaria = true, sessao_versao = sessao_versao + 1 WHERE id = $2 RETURNING id',
    [hash, alvo.id]
  );
  if (!alterado) return res.status(404).json({ ok: false, erro: 'Usuário não encontrado.' });
  await revogarSessoesDoUsuario(alvo.id);
  // Auditoria SEM o valor (nem a senha nem o hash): só quem redefiniu a senha de quem.
  await registrarAuditoria({
    usuarioId: req.user.id, acao: 'redefinir_senha', entidade: 'usuario', entidadeId: alvo.id,
    valorDepois: { alvo_perfil: alvo.perfil, propria: alvo.id === req.user.id }, ip: req._ip,
  });
  res.json({ ok: true });
});

// DELETE /api/usuarios/:id — exclui usuário (apenas Master com pode_marcar_restrito)
usuariosRouter.delete('/:id', apenasMaster, async (req, res) => {
  if (!req.user.pode_marcar_restrito) return res.status(403).json({ ok: false, erro: 'Apenas o Master principal pode excluir usuários.' });
  const alvo = await db.queryOne('SELECT id, nome, email, perfil, ativo FROM usuarios WHERE id = $1', [req.params.id]);
  if (!alvo) return res.status(404).json({ ok: false, erro: 'Usuário não encontrado.' });
  if (alvo.id === req.user.id) return res.status(400).json({ ok: false, erro: 'Não é possível excluir a própria conta.' });

  // S-13 / D-S3: quem já tem registro na trilha de auditoria (todo usuário que já entrou tem o
  // `login`) não é excluído: o autor não pode ser apagado do log, e o log agora só aceita INSERT.
  // A conta é desativada, o que tira o acesso do mesmo jeito. A exclusão fica para conta sem uso.
  const historico = await db.queryOne('SELECT 1 AS existe FROM logs_auditoria WHERE usuario_id = $1 LIMIT 1', [req.params.id]);
  if (historico) {
    return res.status(409).json({ ok: false, erro: 'Este usuário tem histórico de ações no sistema e não pode ser excluído. Desative a conta em vez de excluir.' });
  }

  // Tudo numa única transação: as anulações de FK, a exclusão e o log de
  // auditoria caem juntos ou nenhum cai -- antes, uma queda no meio (ex.: pool
  // sem conexão livre) podia deixar FKs anuladas com o usuário ainda existindo,
  // ou excluir o usuário e perder o registro de quem fez a exclusão.
  const uid = req.params.id;
  let vinculado = false;
  await db.transaction(async (tx) => {
    await Promise.all([
      tx.execute(`UPDATE tarefas        SET atribuido_a           = NULL WHERE atribuido_a           = $1`, [uid]),
      tx.execute(`UPDATE tarefas        SET validado_por          = NULL WHERE validado_por          = $1`, [uid]),
      tx.execute(`UPDATE processos      SET master_responsavel_id = NULL WHERE master_responsavel_id = $1`, [uid]),
      tx.execute(`UPDATE publicacoes    SET lido_por              = NULL WHERE lido_por              = $1`, [uid]),
      tx.execute(`UPDATE publicacoes    SET triado_por            = NULL WHERE triado_por            = $1`, [uid]),
      tx.execute(`UPDATE usuarios       SET master_id             = NULL WHERE master_id             = $1`, [uid]),
      tx.execute(`UPDATE clientes       SET master_responsavel_id = NULL WHERE master_responsavel_id = $1`, [uid]),
      tx.execute(`UPDATE clientes       SET cadastrado_por        = NULL WHERE cadastrado_por        = $1`, [uid]),
      tx.execute(`UPDATE configuracoes  SET atualizado_por        = NULL WHERE atualizado_por        = $1`, [uid]),
      tx.execute(`UPDATE documentos     SET enviado_por           = NULL WHERE enviado_por           = $1`, [uid]),
      tx.execute(`UPDATE leads          SET master_responsavel_id = NULL WHERE master_responsavel_id = $1`, [uid]),
      tx.execute(`UPDATE leads          SET atribuido_a           = NULL WHERE atribuido_a           = $1`, [uid]),
      tx.execute(`UPDATE audiencias     SET advogado_id           = NULL WHERE advogado_id           = $1`, [uid]),
      tx.execute(`UPDATE pecas          SET aprovada_por          = NULL WHERE aprovada_por          = $1`, [uid]),
      tx.execute(`UPDATE honorarios     SET master_responsavel_id = NULL WHERE master_responsavel_id = $1`, [uid]),
      tx.execute(`UPDATE honorarios     SET registrado_por        = NULL WHERE registrado_por        = $1`, [uid]),
      tx.execute(`DELETE FROM credenciais_tribunal WHERE usuario_id = $1`, [uid]),
      tx.execute(`DELETE FROM notas WHERE autor_id = $1`, [uid]),
    ]);

    await tx.execute('DELETE FROM usuarios WHERE id = $1', [uid]);
    await registrarAuditoria({ usuarioId: req.user.id, acao: 'excluir', entidade: 'usuario', entidadeId: uid, valorAntes: alvo, ip: req._ip }, tx);
  }).catch((e) => {
    // Ainda há registro que aponta para este usuário (ex.: chave de API): o Postgres recusa a exclusão.
    if (e.code !== '23503') throw e;
    vinculado = true;
  });
  if (vinculado) {
    return res.status(409).json({ ok: false, erro: 'Este usuário está ligado a outros registros do sistema e não pode ser excluído. Desative a conta em vez de excluir.' });
  }
  invalidarSessao(uid); // as linhas de sessoes_refresh caem junto (ON DELETE CASCADE); só falta limpar o cache

  res.json({ ok: true });
});
