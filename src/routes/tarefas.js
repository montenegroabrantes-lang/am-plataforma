import { Router } from 'express';
import { db }      from '../db/index.js';
import { apenasMaster } from '../middleware/auth.js';
import { criarEventoCalendar, atualizarEventoCalendar, deletarEventoCalendar } from '../services/calendar/index.js';

export const tarefasRouter = Router();

// GET /api/tarefas — lista tarefas do usuário (ou todas para Master)
tarefasRouter.get('/', async (req, res) => {
  const { status, urgencia, cliente_id, produto_id, atribuido_a, prazo_dias, prazo_de, prazo_ate, tipo, processo_id, page = 1, limite = 100 } = req.query;
  const offset = (Number(page) - 1) * Number(limite);

  const params = [];
  const condicoes = ["t.status NOT IN ('cancelada')"];

  if (prazo_dias !== undefined) {
    const dias = Number(prazo_dias);
    if (dias === 0) {
      condicoes.push(`t.prazo_data = CURRENT_DATE`);
    } else if (Number.isInteger(dias) && dias > 0) {
      condicoes.push(`t.prazo_data BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '${dias} days'`);
    }
    condicoes.push(`t.status NOT IN ('concluida','cancelada')`);
  } else if (status) {
    params.push(status); condicoes.push(`t.status = $${params.length}`);
  }
  if (processo_id) { params.push(processo_id); condicoes.push(`t.processo_id = $${params.length}`); }
  if (tipo)      { params.push(tipo);     condicoes.push(`t.tipo = $${params.length}`); }
  else if (!processo_id) condicoes.push(`t.publicacao_id IS NULL`); // prazos de publicação só aparecem na aba própria (tipo=prazo) ou no detalhe do processo
  if (prazo_de)  { params.push(prazo_de); condicoes.push(`t.prazo_data >= $${params.length}::date`); }
  if (prazo_ate) { params.push(prazo_ate); condicoes.push(`t.prazo_data <= $${params.length}::date`); }
  if (urgencia)    { params.push(urgencia);    condicoes.push(`t.urgencia = $${params.length}`); }
  if (cliente_id)  { params.push(cliente_id);  condicoes.push(`cl.id = $${params.length}`); }
  if (produto_id)  { params.push(produto_id);  condicoes.push(`pr.id = $${params.length}`); }
  if (atribuido_a) { params.push(atribuido_a); condicoes.push(`t.atribuido_a = $${params.length}`); }

  // Não-master só vê as próprias tarefas
  // Master vê tudo, inclusive tarefas de prazo sem atribuição (geradas por publicações)
  if (req.user.perfil !== 'master') {
    params.push(req.user.id);
    condicoes.push(`(t.atribuido_a = $${params.length} OR t.validado_por = $${params.length})`);
  }

  // COUNT antes de adicionar LIMIT/OFFSET
  const [{ total }] = await db.query(
    `SELECT COUNT(*) AS total
     FROM tarefas t
     LEFT JOIN processos p  ON p.id = t.processo_id
     LEFT JOIN usuarios u   ON u.id = t.atribuido_a
     LEFT JOIN usuarios m   ON m.id = t.validado_por
     LEFT JOIN cliente_produtos cp ON cp.id = t.cliente_produto_id
     LEFT JOIN clientes cl  ON cl.id = cp.cliente_id
     LEFT JOIN produtos pr  ON pr.id = cp.produto_id
     WHERE ${condicoes.join(' AND ')}`,
    params
  );

  params.push(Number(limite), offset);

  const rows = await db.query(
    `SELECT t.*, COALESCE(p.numero, pub.numero_processo) AS processo_numero, COALESCE(p.tribunal, pub.tribunal) AS tribunal,
            u.nome AS atribuido_nome, m.nome AS validador_nome, ass.nome AS assinado_nome,
            cl.id AS cliente_id, cl.nome AS cliente_nome, cl.cpf AS cliente_cpf,
            pr.id AS produto_id, pr.nome AS produto_nome
     FROM tarefas t
     LEFT JOIN processos p    ON p.id = t.processo_id
     LEFT JOIN publicacoes pub ON pub.id = t.publicacao_id
     LEFT JOIN usuarios u   ON u.id = t.atribuido_a
     LEFT JOIN usuarios m   ON m.id = t.validado_por
     LEFT JOIN usuarios ass ON ass.id = t.assinado_por
     LEFT JOIN cliente_produtos cp ON cp.id = t.cliente_produto_id
     LEFT JOIN clientes cl  ON cl.id = cp.cliente_id
     LEFT JOIN produtos pr  ON pr.id = cp.produto_id
     WHERE ${condicoes.join(' AND ')}
     ORDER BY
       CASE t.urgencia WHEN 'CRITICO' THEN 1 WHEN 'ALTO' THEN 2 WHEN 'MEDIO' THEN 3 ELSE 4 END,
       t.prazo_data ASC NULLS LAST
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({ ok: true, tarefas: rows, total: Number(total), page: Number(page), limite: Number(limite) });
});

// POST /api/tarefas — cria tarefa (Master atribui ao Junior)
tarefasRouter.post('/', apenasMaster, async (req, res) => {
  const { processo_id, tipo, descricao, instrucao, atribuido_a, urgencia, prazo_data } = req.body;

  if (!tipo || !descricao) {
    return res.status(400).json({ ok: false, erro: 'tipo e descricao são obrigatórios.' });
  }

  const [nova] = await db.query(
    `INSERT INTO tarefas (processo_id, tipo, descricao, instrucao, atribuido_a, validado_por, urgencia, prazo_data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      processo_id || null, tipo, descricao, instrucao || null,
      atribuido_a || null, req.user.id,
      urgencia || 'MEDIO', prazo_data || null,
    ]
  );

  // Se tem prazo_data, cria evento no Calendar em background
  if (prazo_data && processo_id) {
    const proc = await db.queryOne(`SELECT numero, tribunal, vara FROM processos WHERE id = $1`, [processo_id]).catch(() => null);
    criarEventoCalendar({
      titulo:    `${tipo} — ${proc?.numero || descricao}`,
      dataHora:  new Date(`${prazo_data}T08:00:00`),
      tipo,
      vara:      proc?.vara,
      tribunal:  proc?.tribunal,
      processoId: processo_id,
      descricao: `Tarefa: ${descricao}`,
    }).then(eventId => {
      if (eventId) db.execute(`UPDATE tarefas SET calendar_event_id = $1 WHERE id = $2`, [eventId, nova.id]).catch(() => {});
    }).catch(() => {});
  }

  res.status(201).json({ ok: true, tarefa: nova });
});

// PATCH /api/tarefas/:id/concluir-com-numero — conclui tarefa de protocolo inserindo número CNJ
tarefasRouter.patch('/:id/concluir-com-numero', async (req, res) => {
  const { numero_processo, periodo_fim, vinculo_id } = req.body;

  const CNJ_RE = /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/;
  if (!numero_processo || !CNJ_RE.test(numero_processo.trim())) {
    return res.status(400).json({ ok: false, erro: 'Número inválido. Use o formato CNJ: 0000000-00.0000.0.00.0000' });
  }
  const numeroLimpo = numero_processo.trim();

  const tarefa = await db.queryOne(
    `SELECT t.*, cp.cliente_id, cp.produto_id, pr.nome AS produto_nome,
            cl.nome AS cliente_nome, cl.polo_passivo AS cliente_polo_passivo
     FROM tarefas t
     JOIN cliente_produtos cp ON cp.id = t.cliente_produto_id
     JOIN clientes cl ON cl.id = cp.cliente_id
     JOIN produtos pr ON pr.id = cp.produto_id
     WHERE t.id = $1`,
    [req.params.id]
  );

  if (!tarefa) return res.status(404).json({ ok: false, erro: 'Tarefa não encontrada.' });
  if (tarefa.status === 'concluida') return res.status(409).json({ ok: false, erro: 'Tarefa já concluída.' });
  if (tarefa.tipo !== 'protocolar') return res.status(400).json({ ok: false, erro: 'Esta tarefa não é do tipo protocolar.' });

  // Se vinculo_id fornecido, usa polo_passivo daquele vínculo
  if (vinculo_id) {
    const vinc = await db.queryOne(
      `SELECT polo_passivo FROM cliente_vinculos WHERE id = $1 AND cliente_id = $2`,
      [vinculo_id, tarefa.cliente_id]
    );
    if (vinc) tarefa.cliente_polo_passivo = vinc.polo_passivo;
  }

  // Detecta tribunal pelo segmento CNJ (NNNNNNN-DD.AAAA.J.TT.OOOO)
  const segmentos = numeroLimpo.split(/[-.]/).filter(Boolean);
  // posições: 0=7dig, 1=2dig, 2=ano, 3=J, 4=TT, 5=OOOO
  const J  = segmentos[3];
  const TT = segmentos[4];
  let tribunal = 'TJPB', sistema = 'pje';
  if (J === '4') { tribunal = 'TRF5'; sistema = 'pje'; }
  else if (J === '8' && TT === '15') { tribunal = 'TJPB'; sistema = 'pje'; }

  const masterId = req.user.perfil === 'master' ? req.user.id : req.user.master_id;

  const pgClient = await db.pool.connect();
  let processoId;
  try {
    await pgClient.query('BEGIN');

    // Verifica duplicidade
    const existente = await pgClient.query('SELECT id FROM processos WHERE numero = $1', [numeroLimpo]);
    if (existente.rows[0]) {
      processoId = existente.rows[0].id;
    } else {
      const r = await pgClient.query(
        `INSERT INTO processos (numero, tribunal, sistema, grau, cliente_id, produto_id,
                                master_responsavel_id, polo_passivo, periodo_fim, sync_status)
         VALUES ($1,$2,$3,'1',$4,$5,$6,$7,$8,'aguardando_primeira_captura')
         RETURNING id`,
        [numeroLimpo, tribunal, sistema, tarefa.cliente_id, tarefa.produto_id,
         masterId, tarefa.cliente_polo_passivo || null, periodo_fim || null]
      );
      processoId = r.rows[0].id;
    }

    await pgClient.query(
      `UPDATE tarefas SET status='concluida', numero_processo_inserido=$1,
       processo_id=$2, concluida_em=NOW() WHERE id=$3`,
      [numeroLimpo, processoId, req.params.id]
    );

    await pgClient.query('COMMIT');
  } catch (e) {
    await pgClient.query('ROLLBACK');
    throw e;
  } finally {
    pgClient.release();
  }

  // Enfileira sync (fora da transação)
  try {
    const { sincronizarProcesso } = await import('../services/tribunal/sync.js');
    sincronizarProcesso(processoId).catch(e => console.error('[Protocolo] Sync falhou:', e.message));
    console.log(`[Protocolo] Sync iniciado para ${numeroLimpo} (${processoId})`);
  } catch { /* sync via worker se disponível */ }

  const { registrarAuditoria } = await import('../middleware/auditoria.js');
  await registrarAuditoria({
    usuarioId: req.user.id, acao: 'protocolar', entidade: 'processo',
    entidadeId: processoId, valorDepois: { numero: numeroLimpo }, ip: req._ip,
  });

  res.json({ ok: true, processo_id: processoId, numero: numeroLimpo });
});

// PATCH /api/tarefas/:id/responsavel — troca responsável e prazo (Master)
tarefasRouter.patch('/:id/responsavel', apenasMaster, async (req, res) => {
  const { atribuido_a, prazo_data } = req.body;
  const [tarefa] = await db.query(
    `UPDATE tarefas SET atribuido_a = $1, prazo_data = COALESCE($2::date, prazo_data) WHERE id = $3 RETURNING *`,
    [atribuido_a || null, prazo_data || null, req.params.id]
  );

  // Mantém o evento do Calendar em dia quando o prazo muda
  if (prazo_data && tarefa) {
    if (tarefa.calendar_event_id) {
      atualizarEventoCalendar(tarefa.calendar_event_id, { dataHora: new Date(`${prazo_data}T08:00:00`) }).catch(() => {});
    } else {
      const proc = tarefa.processo_id
        ? await db.queryOne(`SELECT numero, tribunal, vara FROM processos WHERE id = $1`, [tarefa.processo_id]).catch(() => null)
        : null;
      criarEventoCalendar({
        titulo:    `${tarefa.tipo} — ${proc?.numero || tarefa.descricao}`,
        dataHora:  new Date(`${prazo_data}T08:00:00`),
        tipo:      tarefa.tipo,
        vara:      proc?.vara,
        tribunal:  proc?.tribunal,
        processoId: tarefa.processo_id,
        descricao: `Tarefa: ${tarefa.descricao}`,
      }).then(eventId => {
        if (eventId) db.execute(`UPDATE tarefas SET calendar_event_id = $1 WHERE id = $2`, [eventId, tarefa.id]).catch(() => {});
      }).catch(() => {});
    }
  }

  res.json({ ok: true });
});

// PATCH /api/tarefas/:id/observacao — salva observação livre
tarefasRouter.patch('/:id/observacao', async (req, res) => {
  const { observacao } = req.body;
  await db.execute(
    `UPDATE tarefas SET observacao = $1 WHERE id = $2`,
    [observacao || null, req.params.id]
  );
  res.json({ ok: true });
});

// PATCH /api/tarefas/:id/status — atualiza status da tarefa
tarefasRouter.patch('/:id/status', async (req, res, next) => {
  try {
    const { status, observacao_devolucao, justificativa_cancelamento } = req.body;
    const validos = ['pendente','em_execucao','aguardando_validacao','concluida','devolvida','cancelada'];

    if (!validos.includes(status)) {
      return res.status(400).json({ ok: false, erro: `Status inválido. Válidos: ${validos.join(', ')}` });
    }

    const tarefa = await db.queryOne('SELECT * FROM tarefas WHERE id = $1', [req.params.id]);
    if (!tarefa) return res.status(404).json({ ok: false, erro: 'Tarefa não encontrada.' });

    if (req.user.perfil === 'junior' && ['concluida','devolvida','cancelada'].includes(status)) {
      return res.status(403).json({ ok: false, erro: 'Apenas o Master pode concluir, devolver ou cancelar tarefas.' });
    }

    if (status === 'cancelada' && !justificativa_cancelamento?.trim()) {
      return res.status(400).json({ ok: false, erro: 'Justificativa é obrigatória para cancelar a tarefa.' });
    }

    const concluida_em = status === 'concluida' ? new Date() : null;

    await db.execute(
      `UPDATE tarefas SET status = $1, observacao_devolucao = $2, concluida_em = $3,
       justificativa_cancelamento = $4 WHERE id = $5`,
      [status, observacao_devolucao || null, concluida_em, justificativa_cancelamento || null, req.params.id]
    );

    // Remove evento do Calendar se tarefa concluída ou cancelada
    if (['concluida', 'cancelada'].includes(status) && tarefa.calendar_event_id) {
      deletarEventoCalendar(tarefa.calendar_event_id).catch(() => {});
    }

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/tarefas/lote-assinatura — A envia vários processos de uma vez para B conferir e assinar
// body: { numeros: ["0000000-00.0000.0.00.0000", ...], atribuido_a, descricao, urgencia?, prazo_data? }
tarefasRouter.post('/lote-assinatura', apenasMaster, async (req, res) => {
  const { numeros, atribuido_a, descricao, urgencia, prazo_data } = req.body;

  if (!Array.isArray(numeros) || numeros.length === 0) {
    return res.status(400).json({ ok: false, erro: 'Informe ao menos um número de processo.' });
  }
  if (!atribuido_a) return res.status(400).json({ ok: false, erro: 'Informe quem vai conferir e assinar.' });
  if (!descricao?.trim()) return res.status(400).json({ ok: false, erro: 'Descreva o ato praticado (ex: Impugnação juntada).' });
  if (atribuido_a === req.user.id) {
    return res.status(400).json({ ok: false, erro: 'Quem envia para assinatura não pode ser o próprio assinante.' });
  }

  // Resolve números (com ou sem máscara) para processos cadastrados
  const numerosLimpos = [...new Set(numeros.map(n => String(n).replace(/\D/g, '')).filter(Boolean))];
  const procs = await db.query(
    `SELECT id, numero, REGEXP_REPLACE(numero, '[^0-9]', '', 'g') AS numero_limpo
     FROM processos
     WHERE REGEXP_REPLACE(numero, '[^0-9]', '', 'g') = ANY($1)`,
    [numerosLimpos]
  );
  const mapa = new Map(procs.map(p => [p.numero_limpo, p]));

  const criadas = [];
  const nao_encontrados = [];

  for (const limpo of numerosLimpos) {
    const proc = mapa.get(limpo);
    if (!proc) { nao_encontrados.push(limpo); continue; }
    const [t] = await db.query(
      `INSERT INTO tarefas (processo_id, tipo, descricao, atribuido_a, validado_por, urgencia, prazo_data)
       VALUES ($1, 'assinatura', $2, $3, $4, $5, $6)
       RETURNING id`,
      [proc.id, `${descricao.trim()} — ${proc.numero}`, atribuido_a, req.user.id,
       urgencia || 'ALTO', prazo_data || null]
    );
    criadas.push({ id: t.id, processo: proc.numero });
  }

  res.status(201).json({ ok: true, criadas: criadas.length, nao_encontrados, tarefas: criadas });
});

// PATCH /api/tarefas/:id/assinar — B confirma que conferiu e assinou a peça no PJe
tarefasRouter.patch('/:id/assinar', apenasMaster, async (req, res) => {
  const tarefa = await db.queryOne(`SELECT * FROM tarefas WHERE id = $1`, [req.params.id]);
  if (!tarefa) return res.status(404).json({ ok: false, erro: 'Tarefa não encontrada.' });
  if (tarefa.tipo !== 'assinatura') return res.status(400).json({ ok: false, erro: 'Esta tarefa não é de assinatura.' });
  if (tarefa.status === 'concluida') return res.status(409).json({ ok: false, erro: 'Tarefa já assinada.' });
  // Quem enviou para assinatura não pode assinar a própria peça
  if (tarefa.validado_por === req.user.id) {
    return res.status(403).json({ ok: false, erro: 'Quem enviou a peça não pode assiná-la. Outro usuário deve conferir e assinar.' });
  }

  await db.execute(
    `UPDATE tarefas SET status = 'concluida', assinado_por = $1, assinado_em = NOW(), concluida_em = NOW()
     WHERE id = $2`,
    [req.user.id, req.params.id]
  );

  if (tarefa.calendar_event_id) deletarEventoCalendar(tarefa.calendar_event_id).catch(() => {});

  res.json({ ok: true });
});

// POST /api/tarefas/sincronizar-calendar — cria no Google Calendar os eventos
// de prazos/tarefas ativos que ainda não têm calendar_event_id (backfill).
tarefasRouter.post('/sincronizar-calendar', apenasMaster, async (req, res) => {
  const pendentes = await db.query(
    `SELECT t.*, p.numero AS processo_numero, p.tribunal, p.vara
     FROM tarefas t
     LEFT JOIN processos p ON p.id = t.processo_id
     WHERE t.prazo_data IS NOT NULL
       AND t.status NOT IN ('concluida','cancelada')
       AND t.calendar_event_id IS NULL
     ORDER BY t.prazo_data ASC`
  );

  let criados = 0, falhas = 0;

  for (const t of pendentes) {
    try {
      const eventId = await criarEventoCalendar({
        titulo:    t.tipo === 'prazo' ? `${t.descricao}` : `${t.tipo} — ${t.processo_numero || t.descricao}`,
        dataHora:  new Date(`${new Date(t.prazo_data).toISOString().slice(0, 10)}T08:00:00`),
        tipo:      t.tipo,
        vara:      t.vara,
        tribunal:  t.tribunal,
        processoId: t.processo_id,
        descricao: `Tarefa: ${t.descricao}`,
      });
      if (eventId) {
        await db.execute(`UPDATE tarefas SET calendar_event_id = $1 WHERE id = $2`, [eventId, t.id]);
        criados++;
      } else {
        falhas++;
      }
    } catch (e) {
      console.warn(`[Calendar] Falha ao sincronizar tarefa ${t.id}:`, e.message);
      falhas++;
    }
  }

  res.json({ ok: true, total: pendentes.length, criados, falhas });
});
