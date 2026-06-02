import { Router } from 'express';
import { db }      from '../db/index.js';
import { registrarAuditoria } from '../middleware/auditoria.js';
import { apenasMaster }       from '../middleware/auth.js';

export const processosRouter = Router();

// Filtro de visibilidade: restritos só para pode_marcar_restrito
function filtroVisibilidade(user) {
  if (user.pode_marcar_restrito) return '';
  return `AND (p.visibilidade = 'normal')`;
}

// Filtro de master: usa parâmetros para evitar SQL injection
function filtroMaster(user, params) {
  if (user.pode_marcar_restrito) return '';
  const masterId = user.perfil === 'master' ? user.id : user.master_id;
  params.push(masterId);
  return `AND (p.master_responsavel_id = $${params.length} OR p.compartilhado = true)`;
}

// Verifica se o user tem acesso ao processo (para GET/PATCH/DELETE /:id)
function podeAcessarProcesso(user, processo) {
  if (user.pode_marcar_restrito) return true;
  const masterId = user.perfil === 'master' ? user.id : user.master_id;
  return processo.master_responsavel_id === masterId || processo.compartilhado === true;
}

const FILTROS_PERIODO = {
  '7d':     `AND (SELECT MAX(data_movimentacao) FROM movimentacoes WHERE processo_id = p.id) >= NOW() - INTERVAL '7 days'`,
  '30d':    `AND (SELECT MAX(data_movimentacao) FROM movimentacoes WHERE processo_id = p.id) >= NOW() - INTERVAL '30 days'`,
  'sem30d': `AND (SELECT MAX(data_movimentacao) FROM movimentacoes WHERE processo_id = p.id) < NOW() - INTERVAL '30 days'`,
  'sem60d': `AND (SELECT MAX(data_movimentacao) FROM movimentacoes WHERE processo_id = p.id) < NOW() - INTERVAL '60 days'`,
};

const ETAPA_WHERE = {
  'Pagamento':               `(p.situacao_atual IN ('rpv_paga','pagamento_realizado') OR p.status_rpv = 'paga' OR p.status_alvara = 'pagamento_realizado')`,
  'Arquivado':               `p.situacao_atual IN ('arquivado','autos_baixados')`,
  'Alvará':                  `(p.tipo_requisicao = 'alvara' OR p.situacao_atual IN ('aguardando_alvara','alvara_expedido'))`,
  'Precatório':              `(p.tipo_requisicao = 'precatorio' OR p.situacao_atual IN ('em_precatorio','minuta_precatorio_juntada','precatorio_assinado','precatorio_remetido','precatorio_incluido_fila'))`,
  'RPV':                     `(p.tipo_requisicao = 'rpv' OR p.situacao_atual IN ('aguardando_rpv','em_rpv','rpv_expedida'))`,
  'Cumprimento de Sentença': `p.situacao_atual IN ('cumprimento_sentenca','calculos_apresentados','fazenda_intimada_impugnar','impugnacao_fazenda_apresentada','calculos_homologados')`,
  'Recurso':                 `p.situacao_atual IN ('em_recurso','em_segundo_grau','aguardando_baixa')`,
  'Sentença':                `p.situacao_atual IN ('concluso_sentenca','sentenca_proferida','sentenca_publicada')`,
  'Contestação':             `p.situacao_atual IN ('contestacao_apresentada','impugnacao_contestacao','manifestacao_provas')`,
  'Inicial':                 `p.situacao_atual IN ('em_conhecimento','aguardando_contestacao')`,
  'Sem classificação':       `p.situacao_atual IS NULL`,
};

const ETAPA_CASE = `
  CASE
    WHEN p.situacao_atual IN ('rpv_paga','pagamento_realizado') OR p.status_rpv = 'paga' OR p.status_alvara = 'pagamento_realizado' THEN 'Pagamento'
    WHEN p.situacao_atual IN ('arquivado','autos_baixados') THEN 'Arquivado'
    WHEN p.tipo_requisicao = 'alvara' OR p.situacao_atual IN ('aguardando_alvara','alvara_expedido') THEN 'Alvará'
    WHEN p.tipo_requisicao = 'precatorio' OR p.situacao_atual IN ('em_precatorio','minuta_precatorio_juntada','precatorio_assinado','precatorio_remetido','precatorio_incluido_fila') THEN 'Precatório'
    WHEN p.tipo_requisicao = 'rpv' OR p.situacao_atual IN ('aguardando_rpv','em_rpv','rpv_expedida') THEN 'RPV'
    WHEN p.situacao_atual IN ('cumprimento_sentenca','calculos_apresentados','fazenda_intimada_impugnar','impugnacao_fazenda_apresentada','calculos_homologados') THEN 'Cumprimento de Sentença'
    WHEN p.situacao_atual IN ('em_recurso','em_segundo_grau','aguardando_baixa') THEN 'Recurso'
    WHEN p.situacao_atual IN ('concluso_sentenca','sentenca_proferida','sentenca_publicada') THEN 'Sentença'
    WHEN p.situacao_atual IN ('contestacao_apresentada','impugnacao_contestacao','manifestacao_provas') THEN 'Contestação'
    WHEN p.situacao_atual IN ('em_conhecimento','aguardando_contestacao') THEN 'Inicial'
    ELSE 'Sem classificação'
  END
`;

// GET /api/processos
processosRouter.get('/', async (req, res) => {
  const {
    status, tribunal, vara, polo_passivo, ano, busca, situacao_atual, urgente,
    localizacao_processual, tipo_requisicao, periodo,
    produto_id, etapa, tempo_parado_min,
    limite = 30,
  } = req.query;
  const page   = Number(req.query.page || req.query.pagina || 1);
  const offset = (page - 1) * Number(limite);

  const params    = [];
  const condicoes = ['1=1', filtroMaster(req.user, params), filtroVisibilidade(req.user)];

  if (status)                { params.push(status);                condicoes.push(`AND p.status = $${params.length}`); }
  if (tribunal)              { params.push(tribunal);              condicoes.push(`AND p.tribunal = $${params.length}`); }
  if (vara)                  { params.push(`%${vara}%`);           condicoes.push(`AND p.vara ILIKE $${params.length}`); }
  if (polo_passivo)          { params.push(`%${polo_passivo}%`);   condicoes.push(`AND p.polo_passivo ILIKE $${params.length}`); }
  const anoNum = Number(ano);
  if (ano && !isNaN(anoNum)) { params.push(anoNum); condicoes.push(`AND EXTRACT(YEAR FROM p.data_distribuicao) = $${params.length}`); }
  if (situacao_atual)        { params.push(situacao_atual);        condicoes.push(`AND p.situacao_atual = $${params.length}`); }
  if (localizacao_processual){ params.push(localizacao_processual);condicoes.push(`AND p.localizacao_processual = $${params.length}`); }
  if (tipo_requisicao)       { params.push(tipo_requisicao);       condicoes.push(`AND p.tipo_requisicao = $${params.length}`); }
  if (produto_id)            { params.push(produto_id);            condicoes.push(`AND p.produto_id = $${params.length}`); }
  if (urgente === 'true') condicoes.push(`AND p.urgente = true`);
  if (periodo && FILTROS_PERIODO[periodo]) condicoes.push(FILTROS_PERIODO[periodo]);
  if (etapa && ETAPA_WHERE[etapa]) condicoes.push(`AND ${ETAPA_WHERE[etapa]}`);
  const tempoNum = Number(tempo_parado_min);
  if (tempo_parado_min && !isNaN(tempoNum)) {
    params.push(tempoNum);
    condicoes.push(`AND EXTRACT(DAY FROM NOW() - (SELECT MAX(data_movimentacao) FROM movimentacoes WHERE processo_id = p.id)) >= $${params.length}`);
  }
  if (busca) {
    params.push(`%${busca}%`, `%${busca}%`, `%${busca}%`, `%${busca}%`);
    condicoes.push(`AND (p.numero ILIKE $${params.length - 3} OR c.nome ILIKE $${params.length - 2} OR p.polo_ativo ILIKE $${params.length - 1} OR p.polo_passivo ILIKE $${params.length})`);
  }

  const where = condicoes.filter(Boolean).join(' ');

  const [{ total }] = await db.query(
    `SELECT COUNT(*) AS total
     FROM processos p
     LEFT JOIN clientes c ON c.id = p.cliente_id
     WHERE ${where}`,
    params
  );

  params.push(Number(limite), offset);

  const rows = await db.query(
    `SELECT p.id, p.numero, p.tribunal, p.vara, p.status, p.acao,
            p.polo_ativo, p.polo_passivo,
            p.visibilidade, p.compartilhado, p.master_responsavel_id,
            p.situacao_atual, p.urgente, p.etapa_atual, p.localizacao_processual,
            p.status_rpv, p.status_precatorio, p.status_alvara, p.tipo_requisicao,
            p.requer_revisao, p.classificado_por, p.classificado_em, p.criado_em,
            p.data_distribuicao,
            EXTRACT(YEAR FROM p.data_distribuicao)::int AS ano,
            c.nome AS cliente_nome,
            pr.nome AS produto_nome,
            (SELECT MAX(m.data_movimentacao) FROM movimentacoes m WHERE m.processo_id = p.id) AS ultima_movimentacao,
            (SELECT m.texto FROM movimentacoes m WHERE m.processo_id = p.id ORDER BY m.data_movimentacao DESC LIMIT 1) AS ultima_mov_texto,
            EXTRACT(DAY FROM NOW() - (SELECT MAX(m.data_movimentacao) FROM movimentacoes m WHERE m.processo_id = p.id))::int AS dias_parado,
            ${ETAPA_CASE} AS etapa
     FROM processos p
     LEFT JOIN clientes c  ON c.id  = p.cliente_id
     LEFT JOIN produtos  pr ON pr.id = p.produto_id
     WHERE ${where}
     ORDER BY p.urgente DESC, p.atualizado_em DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({ ok: true, processos: rows, total: Number(total), page, limite: Number(limite) });
});

// GET /api/processos/exportar — lista filtrada em texto para WhatsApp
processosRouter.get('/exportar', async (req, res) => {
  const { status, situacao_atual, urgente, tribunal, busca, localizacao_processual, tipo_requisicao, periodo } = req.query;
  const params    = [];
  const condicoes = ['1=1', filtroMaster(req.user, params), filtroVisibilidade(req.user)];

  if (status)                { params.push(status);                condicoes.push(`AND p.status = $${params.length}`); }
  if (tribunal)              { params.push(tribunal);              condicoes.push(`AND p.tribunal = $${params.length}`); }
  if (situacao_atual)        { params.push(situacao_atual);        condicoes.push(`AND p.situacao_atual = $${params.length}`); }
  if (localizacao_processual){ params.push(localizacao_processual);condicoes.push(`AND p.localizacao_processual = $${params.length}`); }
  if (tipo_requisicao)       { params.push(tipo_requisicao);       condicoes.push(`AND p.tipo_requisicao = $${params.length}`); }
  if (urgente === 'true') condicoes.push(`AND p.urgente = true`);
  if (periodo && FILTROS_PERIODO[periodo]) condicoes.push(FILTROS_PERIODO[periodo]);
  if (busca) {
    params.push(`%${busca}%`); params.push(`%${busca}%`); params.push(`%${busca}%`); params.push(`%${busca}%`);
    condicoes.push(`AND (p.numero ILIKE $${params.length-3} OR c.nome ILIKE $${params.length-2} OR p.polo_ativo ILIKE $${params.length-1} OR p.polo_passivo ILIKE $${params.length})`);
  }

  const rows = await db.query(
    `SELECT p.numero, c.nome AS cliente_nome, p.situacao_atual
     FROM processos p
     LEFT JOIN clientes c ON c.id = p.cliente_id
     WHERE ${condicoes.filter(Boolean).join(' ')}
     ORDER BY p.urgente DESC, p.atualizado_em DESC
     LIMIT 500`,
    params
  );

  const linhas = rows.map(r => {
    const situacao = r.situacao_atual
      ? r.situacao_atual.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
      : 'Sem classificação';
    return `${r.numero} | ${r.cliente_nome || '—'} | ${situacao}`;
  });

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(linhas.join('\n'));
});

// GET /api/processos/sync-status — status atual do sync (lock + última execução)
processosRouter.get('/sync-status', apenasMaster, async (req, res) => {
  try {
    const { redis } = await import('../cache/redis.js');
    const lockAtivo = await redis.exists('sync:global:lock').catch(() => 0);
    const ultima = await db.queryOne(
      `SELECT iniciado_em, concluido_em, total, via_datajud, via_mni, via_puppeteer, via_eproc, falhas
       FROM sync_execucoes ORDER BY iniciado_em DESC LIMIT 1`
    ).catch(() => null);
    const emAndamento = lockAtivo && ultima && !ultima.concluido_em;
    const travado     = lockAtivo && (!ultima || ultima.concluido_em);
    res.json({ ok: true, lock_ativo: !!lockAtivo, em_andamento: emAndamento, travado, ultima_execucao: ultima || null });
  } catch (err) {
    res.json({ ok: false, lock_ativo: false, em_andamento: false, travado: false, ultima_execucao: null });
  }
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

  if (!podeAcessarProcesso(req.user, p)) {
    return res.status(403).json({ ok: false, erro: 'Acesso negado a este processo.' });
  }

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
  const dono = await db.queryOne('SELECT master_responsavel_id, compartilhado FROM processos WHERE id = $1', [req.params.id]);
  if (!dono) return res.status(404).json({ ok: false, erro: 'Processo não encontrado.' });
  if (!podeAcessarProcesso(req.user, dono)) return res.status(403).json({ ok: false, erro: 'Acesso negado a este processo.' });

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
  const forcar = req.body?.force === true || req.query?.force === 'true';

  if (forcar) {
    try {
      const { redis } = await import('../cache/redis.js');
      await redis.del('sync:global:lock');
      console.log('[Sync] Lock removido por solicitação manual (force=true)');
    } catch { /* Redis indisponível */ }
  }

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
    const { enfileirarSincronizarProcesso } = await import('../workers/index.js');
    await enfileirarSincronizarProcesso(id);
    console.log(`[Sync individual] enfileirado: ${id}`);
    return res.json({ ok: true, status: 'enfileirado' });
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

// PATCH /api/processos/:id/urgente — marcar/desmarcar urgência
processosRouter.patch('/:id/urgente', async (req, res) => {
  const dono = await db.queryOne('SELECT master_responsavel_id, compartilhado FROM processos WHERE id = $1', [req.params.id]);
  if (!dono) return res.status(404).json({ ok: false, erro: 'Processo não encontrado.' });
  if (!podeAcessarProcesso(req.user, dono)) return res.status(403).json({ ok: false, erro: 'Acesso negado.' });

  const { urgente } = req.body;
  await db.execute(
    `UPDATE processos SET urgente = $1, classificado_por = $2, classificado_em = NOW(), atualizado_em = NOW() WHERE id = $3`,
    [!!urgente, req.user.id, req.params.id]
  );
  res.json({ ok: true });
});

// PATCH /api/processos/:id/situacao — classificação manual
processosRouter.patch('/:id/situacao', async (req, res) => {
  const dono = await db.queryOne('SELECT master_responsavel_id, compartilhado, situacao_atual, etapa_atual FROM processos WHERE id = $1', [req.params.id]);
  if (!dono) return res.status(404).json({ ok: false, erro: 'Processo não encontrado.' });
  if (!podeAcessarProcesso(req.user, dono)) return res.status(403).json({ ok: false, erro: 'Acesso negado.' });

  const campos  = ['situacao_atual','etapa_atual','localizacao_processual','tipo_requisicao',
                   'status_rpv','status_precatorio','status_alvara','valor_homologado','urgente'];
  const updates = [];
  const params  = [];

  for (const campo of campos) {
    if (req.body[campo] !== undefined) {
      params.push(req.body[campo]);
      updates.push(`${campo} = $${params.length}`);
    }
  }

  if (updates.length === 0) return res.status(400).json({ ok: false, erro: 'Nenhum campo para atualizar.' });

  // Detecta mudança de situação para registrar início
  if (req.body.situacao_atual && req.body.situacao_atual !== dono.situacao_atual) {
    updates.push(`data_inicio_situacao = NOW()`);
  }

  params.push(req.user.id);
  updates.push(`classificado_por = $${params.length}`);
  updates.push(`classificado_em = NOW()`);
  updates.push(`requer_revisao = false`);
  updates.push(`atualizado_em = NOW()`);
  params.push(req.params.id);

  await db.execute(`UPDATE processos SET ${updates.join(', ')} WHERE id = $${params.length}`, params);

  // Registra histórico se mudou situação
  if (req.body.situacao_atual && req.body.situacao_atual !== dono.situacao_atual) {
    await db.execute(
      `INSERT INTO historico_situacao (processo_id, situacao_anterior, situacao_nova, etapa_anterior, etapa_nova, usuario_id, fonte)
       VALUES ($1,$2,$3,$4,$5,$6,'manual')`,
      [req.params.id, dono.situacao_atual, req.body.situacao_atual, dono.etapa_atual, req.body.etapa_atual || null, req.user.id]
    ).catch(() => {});
  }

  res.json({ ok: true });
});

// POST /api/processos/:id/classificar — classifica com Claude
processosRouter.post('/:id/classificar', async (req, res) => {
  const processo = await db.queryOne(
    `SELECT p.*, pr.nome AS produto_nome FROM processos p LEFT JOIN produtos pr ON pr.id = p.produto_id WHERE p.id = $1`,
    [req.params.id]
  );
  if (!processo) return res.status(404).json({ ok: false, erro: 'Processo não encontrado.' });
  if (!podeAcessarProcesso(req.user, processo)) return res.status(403).json({ ok: false, erro: 'Acesso negado.' });

  const movimentacoes = await db.query(
    `SELECT texto, data_movimentacao FROM movimentacoes WHERE processo_id = $1 ORDER BY data_movimentacao DESC LIMIT 15`,
    [req.params.id]
  );

  const { ai } = await import('../services/ai/index.js');
  const resultado = await ai.classificar({
    numero: processo.numero, tribunal: processo.tribunal,
    produto: processo.produto_nome, movimentacoes,
    situacao_atual: processo.situacao_atual,
  });

  const situacaoMudou = resultado.situacao_atual && resultado.situacao_atual !== processo.situacao_atual;

  await db.execute(
    `UPDATE processos SET
       situacao_atual = COALESCE($1, situacao_atual),
       etapa_atual = COALESCE($2, etapa_atual),
       localizacao_processual = COALESCE($3, localizacao_processual),
       tipo_requisicao = COALESCE($4, tipo_requisicao),
       status_rpv = COALESCE($5, status_rpv),
       status_precatorio = COALESCE($6, status_precatorio),
       status_alvara = COALESCE($7, status_alvara),
       requer_revisao = $8,
       classificado_por = 'claude',
       classificado_em = NOW(),
       data_inicio_situacao = CASE WHEN $9 THEN NOW()::date ELSE data_inicio_situacao END,
       atualizado_em = NOW()
     WHERE id = $10`,
    [
      resultado.situacao_atual, resultado.etapa_atual, resultado.localizacao_processual,
      resultado.tipo_requisicao, resultado.status_rpv, resultado.status_precatorio,
      resultado.status_alvara, resultado.confianca === 'BAIXA',
      situacaoMudou, req.params.id,
    ]
  );

  if (situacaoMudou) {
    await db.execute(
      `INSERT INTO historico_situacao (processo_id, situacao_anterior, situacao_nova, etapa_anterior, etapa_nova, usuario_id, fonte)
       VALUES ($1,$2,$3,$4,$5,'claude','claude')`,
      [req.params.id, processo.situacao_atual, resultado.situacao_atual, processo.etapa_atual, resultado.etapa_atual]
    ).catch(() => {});
  }

  res.json({ ok: true, resultado, requer_revisao: resultado.confianca === 'BAIXA' });
});

// ── COMPLETAR POLOS ──────────────────────────────────────────
let polosProgress = { rodando: false, total: 0, ok: 0, erros: 0, iniciado_em: null, finalizado_em: null };

processosRouter.get('/completar-polos/progresso', apenasMaster, (req, res) => {
  res.json({ ok: true, progresso: polosProgress });
});

processosRouter.post('/completar-polos', apenasMaster, async (req, res) => {
  if (polosProgress.rodando) {
    return res.json({ ok: false, mensagem: 'Já em andamento.', progresso: polosProgress });
  }

  polosProgress = { rodando: true, total: 0, ok: 0, erros: 0, iniciado_em: new Date(), finalizado_em: null };
  res.json({ ok: true, mensagem: 'Completar polos iniciado.' });

  setImmediate(async () => {
    try {
      const { completarPolos } = await import('../services/tribunal/sync.js');
      await completarPolos((prog) => { Object.assign(polosProgress, prog); });
    } catch (e) {
      console.error('[Polos] Erro geral:', e.message);
    } finally {
      polosProgress.rodando = false;
      polosProgress.finalizado_em = new Date();
    }
  });
});

// Estado de progresso da classificação em lote (em memória)
let classifProgress = {
  rodando: false, total: 0, ok: 0, erros: 0, pulados: 0,
  iniciado_em: null, finalizado_em: null, ultimo_erro: null,
};

// GET /api/processos/classificar-lote/progresso
processosRouter.get('/classificar-lote/progresso', apenasMaster, (req, res) => {
  res.json({ ok: true, progresso: classifProgress });
});

// POST /api/processos/classificar-lote — classifica em paralelo com rastreamento de progresso
processosRouter.post('/classificar-lote', apenasMaster, async (req, res) => {
  if (classifProgress.rodando) {
    return res.json({ ok: false, mensagem: 'Classificação já em andamento.', progresso: classifProgress });
  }

  // Marca como rodando ANTES do setImmediate para evitar race condition com requisições simultâneas
  classifProgress = { rodando: true, total: 0, ok: 0, erros: 0, pulados: 0, iniciado_em: new Date(), finalizado_em: null, ultimo_erro: null };

  const forcar       = req.body?.forcar === true;
  const concorrencia = Math.min(Number(req.body?.concorrencia) || 5, 10);

  res.json({ ok: true, mensagem: 'Classificação em lote iniciada.', forcar, concorrencia });

  setImmediate(async () => {

    try {
      const masterId   = req.user.pode_marcar_restrito ? null : req.user.id;
      const loteParams = masterId ? [masterId] : [];
      const filtroM    = masterId ? `AND p.master_responsavel_id = $1` : '';
      const filtroPend = forcar ? '' : `AND (p.classificado_em IS NULL OR p.requer_revisao = true)`;

      const processos = await db.query(
        `SELECT p.id, p.numero, p.tribunal, p.situacao_atual, p.etapa_atual, pr.nome AS produto_nome
         FROM processos p
         LEFT JOIN produtos pr ON pr.id = p.produto_id
         WHERE p.status IN ('ativo','suspenso') ${filtroM} ${filtroPend}
         ORDER BY p.classificado_em ASC NULLS FIRST`,
        loteParams
      );

      classifProgress.total = processos.length;
      const { ai } = await import('../services/ai/index.js');

      for (let i = 0; i < processos.length; i += concorrencia) {
        const chunk = processos.slice(i, i + concorrencia);

        await Promise.allSettled(chunk.map(async (proc) => {
          try {
            const movs = await db.query(
              `SELECT texto, data_movimentacao FROM movimentacoes WHERE processo_id = $1 ORDER BY data_movimentacao DESC LIMIT 15`,
              [proc.id]
            );

            const resultado = await ai.classificar({
              numero: proc.numero, tribunal: proc.tribunal,
              produto: proc.produto_nome, movimentacoes: movs,
              situacao_atual: proc.situacao_atual,
            });

            const mudou = resultado.situacao_atual && resultado.situacao_atual !== proc.situacao_atual;

            await db.execute(
              `UPDATE processos SET
                 situacao_atual = COALESCE($1, situacao_atual),
                 etapa_atual = COALESCE($2, etapa_atual),
                 localizacao_processual = COALESCE($3, localizacao_processual),
                 tipo_requisicao = COALESCE($4, tipo_requisicao),
                 status_rpv = COALESCE($5, status_rpv),
                 status_precatorio = COALESCE($6, status_precatorio),
                 status_alvara = COALESCE($7, status_alvara),
                 requer_revisao = $8,
                 classificado_por = 'claude',
                 classificado_em = NOW(),
                 data_inicio_situacao = CASE WHEN $9 THEN NOW()::date ELSE data_inicio_situacao END,
                 atualizado_em = NOW()
               WHERE id = $10`,
              [
                resultado.situacao_atual, resultado.etapa_atual, resultado.localizacao_processual,
                resultado.tipo_requisicao, resultado.status_rpv, resultado.status_precatorio,
                resultado.status_alvara, resultado.confianca === 'BAIXA', mudou, proc.id,
              ]
            );

            if (mudou) {
              await db.execute(
                `INSERT INTO historico_situacao (processo_id, situacao_anterior, situacao_nova, etapa_anterior, etapa_nova, usuario_id, fonte)
                 VALUES ($1,$2,$3,$4,$5,'claude','claude')`,
                [proc.id, proc.situacao_atual, resultado.situacao_atual, proc.etapa_atual, resultado.etapa_atual]
              ).catch(() => {});
            }

            classifProgress.ok++;
          } catch (e) {
            console.error(`[Lote] Erro em ${proc.numero}:`, e.message);
            classifProgress.erros++;
            classifProgress.ultimo_erro = `${proc.numero}: ${e.message}`;
          }
        }));

        if (i + concorrencia < processos.length) {
          await new Promise(r => setTimeout(r, 500));
        }
      }

      console.log(`[Lote] Concluído: ${classifProgress.ok} ok, ${classifProgress.erros} erros de ${processos.length} processos`);
    } catch (e) {
      console.error('[Lote] Erro geral:', e.message);
      classifProgress.ultimo_erro = e.message;
    } finally {
      classifProgress.rodando = false;
      classifProgress.finalizado_em = new Date();
    }
  });
});

// DELETE /api/processos/:id — apenas Master
processosRouter.delete('/:id', apenasMaster, async (req, res) => {
  const antes = await db.queryOne('SELECT * FROM processos WHERE id = $1', [req.params.id]);
  if (!antes) return res.status(404).json({ ok: false, erro: 'Processo não encontrado.' });
  if (!podeAcessarProcesso(req.user, antes)) return res.status(403).json({ ok: false, erro: 'Acesso negado a este processo.' });

  await db.execute('DELETE FROM processos WHERE id = $1', [req.params.id]);

  await registrarAuditoria({
    usuarioId: req.user.id, acao: 'excluir', entidade: 'processo',
    entidadeId: req.params.id, valorAntes: antes, ip: req._ip,
  });

  res.json({ ok: true });
});
