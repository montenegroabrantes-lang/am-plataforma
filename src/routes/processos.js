import { Router } from 'express';
import { db }      from '../db/index.js';
import { registrarAuditoria } from '../middleware/auditoria.js';
import { apenasMaster }       from '../middleware/auth.js';

export const processosRouter = Router();

// Filtro de visibilidade: restritos só para pode_marcar_restrito
function filtroVisibilidade(user) {
  if (user.pode_marcar_restrito) return ''; // Master 01 vê tudo
  return `AND (p.visibilidade = 'normal')`;
}

// Filtro de master: cada Master vê só seus processos (ou compartilhados)
function filtroMaster(user) {
  if (user.pode_marcar_restrito) return ''; // Master 01 vê tudo
  if (user.perfil === 'master') {
    return `AND (p.master_responsavel_id = '${user.id}' OR p.compartilhado = true)`;
  }
  // Junior herda visibilidade do seu Master
  return `AND (p.master_responsavel_id = '${user.master_id}' OR p.compartilhado = true)`;
}

// GET /api/processos
processosRouter.get('/', async (req, res) => {
  // Aceita tanto 'page' quanto 'pagina' (compatibilidade com frontend)
  const { status, tribunal, busca, limite = 30 } = req.query;
  const page   = Number(req.query.page || req.query.pagina || 1);
  const offset = (page - 1) * Number(limite);

  const condicoes = ['1=1', filtroMaster(req.user), filtroVisibilidade(req.user)];
  const params    = [];

  if (status)   { params.push(status);   condicoes.push(`p.status = $${params.length}`); }
  if (tribunal) { params.push(tribunal); condicoes.push(`p.tribunal = $${params.length}`); }
  if (busca)    {
    params.push(`%${busca}%`);
    params.push(`%${busca}%`);
    condicoes.push(`(p.numero ILIKE $${params.length - 1} OR c.nome ILIKE $${params.length})`);
  }

  // Total para paginação
  const [{ total }] = await db.query(
    `SELECT COUNT(*) AS total
     FROM processos p
     LEFT JOIN clientes c ON c.id = p.cliente_id
     WHERE ${condicoes.join(' ')}`,
    params
  );

  params.push(Number(limite), offset);

  const rows = await db.query(
    `SELECT p.id, p.numero, p.tribunal, p.sistema, p.vara, p.status,
            p.visibilidade, p.compartilhado, p.master_responsavel_id,
            p.valor_causa, p.valor_rpv, p.importado_pje, p.criado_em,
            c.nome AS cliente_nome, c.cpf AS cliente_cpf,
            pr.nome AS produto_nome,
            u.nome AS master_nome,
            (SELECT texto FROM movimentacoes WHERE processo_id = p.id ORDER BY data_movimentacao DESC LIMIT 1) AS ultima_movimentacao,
            (SELECT diagnostico_urgencia FROM movimentacoes WHERE processo_id = p.id ORDER BY data_movimentacao DESC LIMIT 1) AS urgencia
     FROM processos p
     LEFT JOIN clientes c  ON c.id = p.cliente_id
     LEFT JOIN produtos  pr ON pr.id = p.produto_id
     LEFT JOIN usuarios  u  ON u.id = p.master_responsavel_id
     WHERE ${condicoes.join(' ')}
     ORDER BY p.atualizado_em DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({ ok: true, processos: rows, total: Number(total), page, limite: Number(limite) });
});

// GET /api/processos/:id
processosRouter.get('/:id', async (req, res) => {
  const p = await db.queryOne(
    `SELECT p.*, c.nome AS cliente_nome, c.cpf AS cliente_cpf, c.whatsapp AS cliente_whatsapp,
            pr.nome AS produto_nome, u.nome AS master_nome
     FROM processos p
     LEFT JOIN clientes c  ON c.id = p.cliente_id
     LEFT JOIN produtos  pr ON pr.id = p.produto_id
     LEFT JOIN usuarios  u  ON u.id = p.master_responsavel_id
     WHERE p.id = $1`,
    [req.params.id]
  );

  if (!p) return res.status(404).json({ ok: false, erro: 'Processo não encontrado.' });

  // Não expõe restrito para quem não pode ver
  if (p.visibilidade === 'restrito' && !req.user.pode_marcar_restrito) {
    return res.status(403).json({ ok: false, erro: 'Processo restrito.' });
  }

  res.json({ ok: true, processo: p });
});

// POST /api/processos — cadastro manual por número
processosRouter.post('/', async (req, res) => {
  const { numero, tribunal, sistema, grau = '1', cliente_id, produto_id, master_responsavel_id,
          vara, acao, polo_ativo, polo_passivo } = req.body;

  if (!numero || !tribunal || !sistema) {
    return res.status(400).json({ ok: false, erro: 'numero, tribunal e sistema são obrigatórios.' });
  }
  if (!['1','2'].includes(grau)) {
    return res.status(400).json({ ok: false, erro: 'grau deve ser 1 ou 2.' });
  }

  // Master responsável: quem cadastrou (ou o informado, se Master 01)
  const masterId = req.user.pode_marcar_restrito && master_responsavel_id
    ? master_responsavel_id
    : (req.user.perfil === 'master' ? req.user.id : req.user.master_id);

  try {
    const [novo] = await db.query(
      `INSERT INTO processos (numero, tribunal, sistema, grau, vara, acao, polo_ativo, polo_passivo,
                              cliente_id, produto_id, master_responsavel_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, numero, tribunal, sistema, grau`,
      [numero.trim(), tribunal, sistema, grau, vara ?? null, acao ?? null,
       polo_ativo ?? null, polo_passivo ?? null,
       cliente_id ?? null, produto_id ?? null, masterId]
    );

    await registrarAuditoria({
      usuarioId: req.user.id, acao: 'criar', entidade: 'processo',
      entidadeId: novo.id, valorDepois: novo, ip: req._ip,
    });

    res.status(201).json({ ok: true, processo: novo });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ ok: false, erro: 'Número de processo já cadastrado.' });
    throw e;
  }
});

// PATCH /api/processos/:id
processosRouter.patch('/:id', async (req, res) => {
  const campos  = ['status', 'vara', 'juiz', 'valor_causa', 'valor_rpv', 'tipo_execucao', 'polo_passivo', 'polo_ativo', 'acao', 'notas'];
  const updates = [];
  const params  = [];

  for (const campo of campos) {
    if (req.body[campo] !== undefined) {
      params.push(req.body[campo]);
      updates.push(`${campo} = $${params.length}`);
    }
  }

  // Visibilidade: só Master 01 pode marcar restrito
  if (req.body.visibilidade !== undefined) {
    if (req.body.visibilidade === 'restrito' && !req.user.pode_marcar_restrito) {
      return res.status(403).json({ ok: false, erro: 'Apenas Master 01 pode marcar processos como restritos.' });
    }
    params.push(req.body.visibilidade);
    updates.push(`visibilidade = $${params.length}`);
  }

  if (updates.length === 0) return res.status(400).json({ ok: false, erro: 'Nenhum campo para atualizar.' });

  params.push(req.params.id);
  updates.push(`atualizado_em = NOW()`);

  await db.execute(
    `UPDATE processos SET ${updates.join(', ')} WHERE id = $${params.length}`,
    params
  );

  res.json({ ok: true });
});

// POST /api/processos/importar-painel — importa todos os processos do painel PJe/eProc
processosRouter.post('/importar-painel', apenasMaster, async (req, res) => {
  const { importarDosPaineis } = await import('../services/tribunal/sync.js');
  try {
    const importados = await importarDosPaineis(req.user.id);

    // Dispara sync imediato para buscar detalhes dos processos recém-importados
    if (importados.length > 0) {
      try {
        const { syncQueue } = await import('../workers/index.js');
        if (syncQueue) {
          await syncQueue.add('sincronizar-todos', {}, { delay: 3_000, removeOnComplete: 5 });
          console.log(`[Importar Painel] Sync imediato enfileirado para ${importados.length} processo(s) novos`);
        }
      } catch { /* Redis pode não estar disponível — sync automático assume */ }
    }

    res.json({ ok: true, importados: importados.length, processos: importados });
  } catch (err) {
    console.error('[Importar Painel]', err.message);
    res.status(500).json({ ok: false, erro: err.message });
  }
});

// POST /api/processos/sync-todos — dispara sync de todos os processos ativos imediatamente
processosRouter.post('/sync-todos', apenasMaster, async (req, res) => {
  try {
    const { syncQueue } = await import('../workers/index.js');
    if (syncQueue) {
      // Remove jobs pendentes do mesmo tipo para não empilhar
      await syncQueue.obliterate({ force: false }).catch(() => {});
      await syncQueue.add('sincronizar-todos', {}, { removeOnComplete: 5, removeOnFail: 5 });
      console.log('[Sync] Sync manual de todos os processos enfileirado');
      return res.json({ ok: true, status: 'enfileirado', mensagem: 'Sync iniciado. Pode levar alguns minutos dependendo do número de processos.' });
    }
  } catch { /* Redis indisponível */ }

  // Fallback: roda direto (bloqueia a requisição — evitar em produção com 800+ processos)
  try {
    const { sincronizarTodos } = await import('../services/tribunal/sync.js');
    const resultado = await sincronizarTodos();
    if (resultado?.ignorado) return res.json({ ok: true, ignorado: true, motivo: resultado.motivo });
    const ok   = resultado.filter(r => r.ok).length;
    const fail = resultado.filter(r => !r.ok).length;
    res.json({ ok: true, total: resultado.length, sincronizados: ok, falhas: fail });
  } catch (err) {
    console.error('[Sync todos]', err.message);
    res.status(500).json({ ok: false, erro: err.message });
  }
});

// POST /api/processos/:id/sync — enfileira sync individual (não bloqueia — Puppeteer leva 60-90s)
processosRouter.post('/:id/sync', async (req, res) => {
  const { id } = req.params;
  try {
    const { syncQueue } = await import('../workers/index.js');
    if (syncQueue) {
      await syncQueue.add('sincronizar-processo', { processoId: id }, {
        removeOnComplete: 5,
        removeOnFail: 10,
      });
      console.log(`[Sync individual] enfileirado: ${id}`);
      return res.json({ ok: true, status: 'enfileirado' });
    }
  } catch { /* Redis indisponível — fallback síncrono */ }

  // Fallback sem Redis: roda direto mas pode exceder timeout HTTP do proxy
  try {
    const { sincronizarProcesso } = await import('../services/tribunal/sync.js');
    const resultado = await sincronizarProcesso(id);
    res.json({ ok: true, ...resultado });
  } catch (err) {
    console.error('[Sync individual]', err.message);
    res.status(500).json({ ok: false, erro: err.message });
  }
});

// DELETE /api/processos/:id — apenas Master
processosRouter.delete('/:id', apenasMaster, async (req, res) => {
  const antes = await db.queryOne('SELECT * FROM processos WHERE id = $1', [req.params.id]);
  if (!antes) return res.status(404).json({ ok: false, erro: 'Processo não encontrado.' });

  await db.execute('DELETE FROM processos WHERE id = $1', [req.params.id]);

  await registrarAuditoria({
    usuarioId: req.user.id, acao: 'excluir', entidade: 'processo',
    entidadeId: req.params.id, valorAntes: antes, ip: req._ip,
  });

  res.json({ ok: true });
});
