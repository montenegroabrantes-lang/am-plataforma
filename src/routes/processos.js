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
  'hoje':   `AND (SELECT MAX(data_movimentacao) FROM movimentacoes WHERE processo_id = p.id) >= (NOW() AT TIME ZONE 'America/Sao_Paulo')::date`,
  '7d':     `AND (SELECT MAX(data_movimentacao) FROM movimentacoes WHERE processo_id = p.id) >= NOW() - INTERVAL '7 days'`,
  '30d':    `AND (SELECT MAX(data_movimentacao) FROM movimentacoes WHERE processo_id = p.id) >= NOW() - INTERVAL '30 days'`,
  'sem30d': `AND (SELECT MAX(data_movimentacao) FROM movimentacoes WHERE processo_id = p.id) < NOW() - INTERVAL '30 days'`,
  'sem60d': `AND (SELECT MAX(data_movimentacao) FROM movimentacoes WHERE processo_id = p.id) < NOW() - INTERVAL '60 days'`,
};

// Formato CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO (com pontuação) ou só dígitos (20 chars)
const CNJ_FORMATADO = /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/;
const CNJ_PURO      = /^\d{20}$/;
function validarNumeroCNJ(numero) {
  const limpo = String(numero || '').trim();
  return CNJ_FORMATADO.test(limpo) || CNJ_PURO.test(limpo.replace(/\D/g, ''));
}

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
  const anoAtual = new Date().getFullYear();
  if (ano && Number.isInteger(anoNum) && anoNum >= 1990 && anoNum <= anoAtual + 1) {
    params.push(anoNum); condicoes.push(`AND EXTRACT(YEAR FROM p.data_distribuicao) = $${params.length}`);
  }
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

  // JOIN LATERAL evita 3 subqueries por linha — uma única busca da última movimentação.
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
            ult.data_movimentacao AS ultima_movimentacao,
            ult.texto             AS ultima_mov_texto,
            EXTRACT(DAY FROM NOW() - ult.data_movimentacao)::int AS dias_parado,
            ${ETAPA_CASE} AS etapa
     FROM processos p
     LEFT JOIN clientes c  ON c.id  = p.cliente_id
     LEFT JOIN produtos  pr ON pr.id = p.produto_id
     LEFT JOIN LATERAL (
       SELECT data_movimentacao, texto
       FROM movimentacoes
       WHERE processo_id = p.id
       ORDER BY data_movimentacao DESC
       LIMIT 1
     ) ult ON true
     WHERE ${where}
     ORDER BY p.urgente DESC, ult.data_movimentacao DESC NULLS LAST
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
    `SELECT p.numero, c.nome AS cliente_nome, p.situacao_atual,
            (SELECT MAX(m.data_movimentacao) FROM movimentacoes m WHERE m.processo_id = p.id) AS ultima_movimentacao
     FROM processos p
     LEFT JOIN clientes c ON c.id = p.cliente_id
     WHERE ${condicoes.filter(Boolean).join(' ')}
     ORDER BY p.urgente DESC, ultima_movimentacao DESC NULLS LAST
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
      `SELECT iniciado_em, concluido_em, total, via_datajud, falhas, novas_movimentacoes
       FROM sync_execucoes ORDER BY iniciado_em DESC LIMIT 1`
    ).catch(() => null);
    const emAndamento = lockAtivo && ultima && !ultima.concluido_em;
    const travado     = lockAtivo && (!ultima || ultima.concluido_em);
    res.json({ ok: true, lock_ativo: !!lockAtivo, em_andamento: emAndamento, travado, ultima_execucao: ultima || null });
  } catch (err) {
    res.json({ ok: false, lock_ativo: false, em_andamento: false, travado: false, ultima_execucao: null });
  }
});

// GET /api/processos/preview-datajud?numero=X&tribunal=Y
// Consulta o DataJud sem salvar — usado pelo modal de cadastro para pré-preencher campos
processosRouter.get('/preview-datajud', async (req, res) => {
  const { numero, tribunal } = req.query;
  if (!numero || !tribunal) {
    return res.status(400).json({ ok: false, erro: 'numero e tribunal são obrigatórios.' });
  }
  if (!validarNumeroCNJ(numero)) {
    return res.status(400).json({ ok: false, erro: 'Número fora do padrão CNJ.' });
  }
  try {
    const { consultarProcesso } = await import('../services/tribunal/datajud.js');
    const resultado = await consultarProcesso(tribunal, numero.trim());
    if (!resultado) return res.json({ ok: true, encontrado: false });
    res.json({ ok: true, encontrado: true, dados: resultado.dados });
  } catch (err) {
    console.warn('[Preview DataJud]', err.message);
    res.status(502).json({ ok: false, erro: 'Falha ao consultar DataJud.' });
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

  if (!numero || !tribunal) {
    return res.status(400).json({ ok: false, erro: 'numero e tribunal são obrigatórios.' });
  }
  if (!validarNumeroCNJ(numero)) {
    return res.status(400).json({ ok: false, erro: 'Número fora do padrão CNJ (NNNNNNN-DD.AAAA.J.TR.OOOO).' });
  }
  if (!['1','2'].includes(grau)) {
    return res.status(400).json({ ok: false, erro: 'grau deve ser 1 ou 2.' });
  }
  // Inferir sistema pelo tribunal se não enviado: TRF → eproc, TJ → pje
  const TRF = new Set(['TRF1','TRF3','TRF4','TRF5','TRF6']);
  const sistemaFinal = sistema || (TRF.has(tribunal) ? 'eproc' : 'pje');
  if (!['pje','eproc'].includes(sistemaFinal)) {
    return res.status(400).json({ ok: false, erro: 'sistema deve ser pje ou eproc.' });
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
      [numero.trim(), tribunal, sistemaFinal, grau, vara ?? null, acao ?? null,
       polo_ativo ?? null, polo_passivo ?? null,
       cliente_id ?? null, produto_id ?? null, masterId]
    );

    await registrarAuditoria({
      usuarioId: req.user.id, acao: 'criar', entidade: 'processo',
      entidadeId: novo.id, valorDepois: novo, ip: req._ip,
    });

    // Enfileira sync individual imediato pelo DataJud (fila separada, não bloqueia o lote)
    try {
      const { enfileirarSincronizarProcesso } = await import('../workers/index.js');
      await enfileirarSincronizarProcesso(novo.id);
    } catch { /* Redis indisponível — sync acontece no próximo ciclo horário */ }

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

// POST /api/processos/importar-painel — desativado (Puppeteer bloqueado pelos tribunais)
processosRouter.post('/importar-painel', apenasMaster, (req, res) => {
  res.status(410).json({ ok: false, erro: 'Importação via PJe desativada. Cadastre processos manualmente pelo número.' });
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
      // Remove jobs manuais pendentes (nunca toca nos jobs do scheduler — têm ID com prefixo 'repeat:')
      const pendentes = await syncQueue.getJobs(['waiting', 'delayed']).catch(() => []);
      for (const j of pendentes) {
        if (j.name === 'sincronizar-todos' && !String(j.id).startsWith('repeat:')) {
          await j.remove().catch(() => {});
        }
      }
      await syncQueue.add('sincronizar-todos', {}, { removeOnComplete: 5, removeOnFail: 5 });
      console.log('[Sync] Sync manual de todos os processos enfileirado');
      return res.json({ ok: true, status: 'enfileirado', mensagem: 'Sync iniciado. Pode levar alguns minutos dependendo do número de processos.' });
    }
  } catch (err) {
    console.warn('[Sync] Redis indisponível para enfileirar:', err.message);
  }

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
  // Só marca como revisado se a situação realmente mudou
  if (req.body.situacao_atual && req.body.situacao_atual !== dono.situacao_atual) {
    updates.push(`requer_revisao = false`);
  }
  updates.push(`atualizado_em = NOW()`);
  params.push(req.params.id);

  await db.execute(`UPDATE processos SET ${updates.join(', ')} WHERE id = $${params.length}`, params);

  // Registra histórico se mudou situação
  if (req.body.situacao_atual && req.body.situacao_atual !== dono.situacao_atual) {
    await db.execute(
      `INSERT INTO historico_situacao (processo_id, situacao_anterior, situacao_nova, etapa_anterior, etapa_nova, usuario_id, fonte)
       VALUES ($1,$2,$3,$4,$5,$6,'manual')`,
      [req.params.id, dono.situacao_atual, req.body.situacao_atual, dono.etapa_atual, req.body.etapa_atual || null, req.user.id]
    ).catch(err => console.warn(`[Situacao] historico_situacao falhou ${req.params.id}:`, err.message));
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
    ).catch(err => console.warn(`[Classificar] historico_situacao falhou ${req.params.id}:`, err.message));
  }

  res.json({ ok: true, resultado, requer_revisao: resultado.confianca === 'BAIXA' });
});

// ── COMPLETAR POLOS ──────────────────────────────────────────
// Estado persistido em Redis com TTL — sobrevive a restart e funciona com múltiplas instâncias.
const POLOS_KEY = 'polos:progress';
const POLOS_TTL = 24 * 3600; // 24h

async function lerPolosProgress() {
  try {
    const { redis } = await import('../cache/redis.js');
    const raw = await redis.get(POLOS_KEY);
    if (!raw) return { rodando: false, total: 0, ok: 0, erros: 0, iniciado_em: null, finalizado_em: null };
    return JSON.parse(raw);
  } catch {
    return { rodando: false, total: 0, ok: 0, erros: 0, iniciado_em: null, finalizado_em: null };
  }
}
async function salvarPolosProgress(estado) {
  try {
    const { redis } = await import('../cache/redis.js');
    await redis.set(POLOS_KEY, JSON.stringify(estado), 'EX', POLOS_TTL);
  } catch (err) { console.warn('[Polos] Falha ao salvar progresso:', err.message); }
}

processosRouter.get('/completar-polos/progresso', apenasMaster, async (req, res) => {
  res.json({ ok: true, progresso: await lerPolosProgress() });
});

// Força destravar o flag se travado (job pendurado por crash do puppeteer, etc)
processosRouter.post('/completar-polos/reset', apenasMaster, async (req, res) => {
  try {
    const { redis } = await import('../cache/redis.js');
    await redis.del('polos:progress');
    res.json({ ok: true, mensagem: 'Flag de polos resetado.' });
  } catch (err) {
    res.status(500).json({ ok: false, erro: err.message });
  }
});

// Completa polo_ativo/passivo via DataJud (sem browser, sem Puppeteer)
processosRouter.post('/completar-polos', apenasMaster, async (req, res) => {
  const force = req.body?.force === true || req.query?.force === 'true';
  const atual = await lerPolosProgress();
  if (atual.rodando && !force) {
    return res.json({ ok: false, mensagem: 'Já em andamento. Use force=true para destravar.', progresso: atual });
  }

  const estadoInicial = {
    rodando: true, etapa: 'datajud', total: 0, ok: 0, erros: 0, sem_dados: 0,
    iniciado_em: new Date(), finalizado_em: null,
  };
  await salvarPolosProgress(estadoInicial);
  res.json({ ok: true, mensagem: 'Completar polos via DataJud iniciado.' });

  setImmediate(async () => {
    let snapshot = estadoInicial;
    try {
      const { preencherPolosDataJud } = await import('../services/tribunal/sync.js');
      const resultado = await preencherPolosDataJud(async (prog) => {
        snapshot = { ...snapshot, ...prog, etapa: 'datajud' };
        await salvarPolosProgress(snapshot);
      });
      snapshot = { ...snapshot, ...resultado };
      console.log(`[Polos] DataJud: ${resultado.ok} OK, ${resultado.sem_dados} sem dados`);
    } catch (e) {
      console.error('[Polos] Erro:', e.message);
    } finally {
      await salvarPolosProgress({ ...snapshot, rodando: false, etapa: 'concluido', finalizado_em: new Date() });
    }
  });
});

// Estado de classificação em lote — também persistido em Redis
const CLASSIF_KEY = 'classif:progress';
const CLASSIF_TTL = 24 * 3600;

async function lerClassifProgress() {
  try {
    const { redis } = await import('../cache/redis.js');
    const raw = await redis.get(CLASSIF_KEY);
    if (!raw) return { rodando: false, total: 0, ok: 0, erros: 0, pulados: 0, iniciado_em: null, finalizado_em: null, ultimo_erro: null };
    return JSON.parse(raw);
  } catch {
    return { rodando: false, total: 0, ok: 0, erros: 0, pulados: 0, iniciado_em: null, finalizado_em: null, ultimo_erro: null };
  }
}
async function salvarClassifProgress(estado) {
  try {
    const { redis } = await import('../cache/redis.js');
    await redis.set(CLASSIF_KEY, JSON.stringify(estado), 'EX', CLASSIF_TTL);
  } catch (err) { console.warn('[Classif] Falha ao salvar progresso:', err.message); }
}

// GET /api/processos/classificar-lote/progresso
processosRouter.get('/classificar-lote/progresso', apenasMaster, async (req, res) => {
  res.json({ ok: true, progresso: await lerClassifProgress() });
});

// POST /api/processos/classificar-lote — classifica em paralelo com rastreamento de progresso
processosRouter.post('/classificar-lote', apenasMaster, async (req, res) => {
  const atual = await lerClassifProgress();
  if (atual.rodando) {
    return res.json({ ok: false, mensagem: 'Classificação já em andamento.', progresso: atual });
  }

  const estadoInicial = { rodando: true, total: 0, ok: 0, erros: 0, pulados: 0, iniciado_em: new Date(), finalizado_em: null, ultimo_erro: null };
  await salvarClassifProgress(estadoInicial);

  const forcar       = req.body?.forcar === true;
  const concorrencia = Math.min(Number(req.body?.concorrencia) || 5, 10);

  res.json({ ok: true, mensagem: 'Classificação em lote iniciada.', forcar, concorrencia });

  setImmediate(async () => {
    let snapshot = estadoInicial;
    let inflightWrite = Promise.resolve();
    function persistir() {
      inflightWrite = inflightWrite.then(() => salvarClassifProgress(snapshot)).catch(() => {});
    }

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

      snapshot = { ...snapshot, total: processos.length };
      persistir();
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
              ).catch(err => console.warn(`[Lote] historico_situacao falhou ${proc.numero}:`, err.message));
            }

            snapshot.ok++;
          } catch (e) {
            console.error(`[Lote] Erro em ${proc.numero}:`, e.message);
            snapshot.erros++;
            snapshot.ultimo_erro = `${proc.numero}: ${e.message}`;
          }
        }));

        persistir();
        if (i + concorrencia < processos.length) {
          await new Promise(r => setTimeout(r, 500));
        }
      }

      console.log(`[Lote] Concluído: ${snapshot.ok} ok, ${snapshot.erros} erros de ${processos.length} processos`);
    } catch (e) {
      console.error('[Lote] Erro geral:', e.message);
      snapshot.ultimo_erro = e.message;
    } finally {
      snapshot = { ...snapshot, rodando: false, finalizado_em: new Date() };
      await inflightWrite.catch(() => {});
      await salvarClassifProgress(snapshot);
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
