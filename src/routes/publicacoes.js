import { Router } from 'express';
import { db }      from '../db/index.js';
import { apenasMaster } from '../middleware/auth.js';
import { criarEventoCalendar, atualizarEventoCalendar, deletarEventoCalendar } from '../services/calendar/index.js';
import { extrairPrazoPublicacao, prazoPlausivel } from '../services/publicacoes/extrairPrazo.js';
import { paginacaoSegura, uuidValido } from '../utils/validacao.js';

export const publicacoesRouter = Router();

const HOJE_ESCRITORIO_SQL = "(NOW() AT TIME ZONE 'America/Fortaleza')::date";
function publicacaoIdValido(id) {
  return /^\d+$/.test(String(id || ''));
}

function dataISOValida(data) {
  const match = String(data || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const ano = Number(match[1]), mes = Number(match[2]), dia = Number(match[3]);
  const normalizada = new Date(Date.UTC(ano, mes - 1, dia));
  return normalizada.getUTCFullYear() === ano && normalizada.getUTCMonth() === mes - 1 && normalizada.getUTCDate() === dia;
}

async function cancelarPrazoDaPublicacao(publicacaoId, motivo) {
  const tarefas = await db.query(
    `UPDATE tarefas
        SET status = 'cancelada', justificativa_cancelamento = COALESCE($2, justificativa_cancelamento)
      WHERE publicacao_id = $1 AND status NOT IN ('concluida','cancelada')
      RETURNING calendar_event_id`,
    [publicacaoId, motivo || 'Publicação cancelada na origem']
  );
  await Promise.allSettled(
    tarefas.filter(t => t.calendar_event_id).map(t => deletarEventoCalendar(t.calendar_event_id))
  );
}

// Tenta criar tarefa + evento Calendar com prazo extraído de uma publicação nova.
// processoId pode ser null (processo ainda não cadastrado) — a tarefa é criada mesmo assim.
async function criarTarefaDePublicacao(item, processoId) {
  if (!item.texto) return;
  try {
    const existente = await db.queryOne(`SELECT id FROM tarefas WHERE publicacao_id = $1`, [item.id]).catch(() => null);
    if (existente) return;
    const processoCadastrado = processoId
      ? await db.queryOne(`SELECT id, numero, tribunal, vara, master_responsavel_id FROM processos WHERE id = $1`, [processoId]).catch(() => null)
      : null;
    // Sem processo cadastrado ainda: usa o número bruto da própria publicação para o título/descrição
    const processo = processoCadastrado || (item.numeroprocessocommascara || item.numero_processo
      ? { numero: item.numeroprocessocommascara || item.numero_processo, tribunal: item.siglaTribunal, vara: null }
      : null);
    const prazo = extrairPrazoPublicacao(item.texto, item.data_disponibilizacao, processo);
    if (!prazo) return;
    if (!prazoPlausivel(prazo.dataEvento, item.data_disponibilizacao)) {
      console.warn(`[Publicações] Prazo implausível ignorado na publicação ${item.id}: ${prazo.dataEvento?.toISOString?.().slice(0, 10)}`);
      return;
    }

    const diasRestantes = Math.ceil((prazo.dataEvento - new Date()) / (1000 * 60 * 60 * 24));
    const urgencia = diasRestantes <= 2 ? 'CRITICO' : diasRestantes <= 5 ? 'ALTO' : diasRestantes <= 10 ? 'MEDIO' : 'BAIXO';

    const [tarefa] = await db.query(
      `INSERT INTO tarefas
         (processo_id, publicacao_id, tipo, descricao, urgencia, prazo_data, atribuido_a, validado_por, status, calendar_event_id)
       VALUES ($1,$2,'prazo',$3,$4,$5::date,$6,NULL,'pendente',NULL)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        processoId,
        item.id,
        prazo.titulo,
        urgencia,
        prazo.dataEvento.toISOString().slice(0, 10),
        processoCadastrado?.master_responsavel_id || null,
      ]
    );
    if (!tarefa) return;

    const eventId = await criarEventoCalendar({
      titulo:    prazo.titulo,
      dataHora:  prazo.dataEvento,
      tipo:      prazo.titulo,
      vara:      processo?.vara,
      tribunal:  processo?.tribunal || item.siglaTribunal,
      processoId,
      descricao: prazo.descricao,
    }).catch(() => null);
    if (eventId) await db.execute(`UPDATE tarefas SET calendar_event_id = $1 WHERE id = $2`, [eventId, tarefa.id]);
  } catch (err) {
    console.warn('[Publicações] Erro ao criar evento/tarefa:', err.message);
  }
}

// GET /api/publicacoes — lista publicações com filtros
publicacoesRouter.get('/', async (req, res) => {
  const { lido, processo_id, tribunal, dias, visao, janela, busca, page, limite } = req.query;
  const { pagina, limite: limiteSeguro, offset } = paginacaoSegura(page, limite || 100);
  const visaoEfetiva = ['abertos', 'triagem', 'encerrados', 'todas'].includes(visao)
    ? visao
    : (processo_id ? 'todas' : 'abertos');

  const params    = [];
  const condicoes = ['p.cancelada = false'];

  if (lido === 'true')  condicoes.push('p.lido = true');
  if (lido === 'false') condicoes.push('p.lido = false');
  if (processo_id) { params.push(processo_id); condicoes.push(`p.processo_id = $${params.length}`); }
  if (tribunal)    { params.push(tribunal);    condicoes.push(`p.tribunal = $${params.length}`); }
  if (busca?.trim()) {
    params.push(`%${busca.trim()}%`);
    condicoes.push(`(COALESCE(pr.numero,p.numero_processo,'') ILIKE $${params.length} OR COALESCE(c.nome,'') ILIKE $${params.length} OR COALESCE(p.orgao,'') ILIKE $${params.length} OR COALESCE(p.texto,'') ILIKE $${params.length})`);
  }
  if (dias !== undefined) {
    const d = Number(dias);
    if (d === 0) {
      condicoes.push(`p.data_disponibilizacao = ${HOJE_ESCRITORIO_SQL}`);
    } else if (Number.isInteger(d) && d > 0) {
      params.push(d);
      condicoes.push(`p.data_disponibilizacao >= ${HOJE_ESCRITORIO_SQL} - $${params.length}::int`);
    }
  }

  if (visaoEfetiva === 'abertos') {
    condicoes.push(`t.id IS NOT NULL AND t.prazo_data IS NOT NULL AND t.status NOT IN ('concluida','cancelada')`);
  } else if (visaoEfetiva === 'triagem') {
    condicoes.push(`p.triagem_status = 'pendente' AND (t.id IS NULL OR t.status = 'cancelada')`);
  } else if (visaoEfetiva === 'encerrados') {
    condicoes.push(`(t.status = 'concluida' OR p.triagem_status IN ('sem_prazo','irrelevante'))`);
  }

  if (janela === 'vencidos') condicoes.push(`t.prazo_data < ${HOJE_ESCRITORIO_SQL}`);
  if (janela === 'hoje') condicoes.push(`t.prazo_data = ${HOJE_ESCRITORIO_SQL}`);
  if (janela === 'semana') condicoes.push(`t.prazo_data BETWEEN ${HOJE_ESCRITORIO_SQL} AND (date_trunc('week', ${HOJE_ESCRITORIO_SQL})::date + 6)`);
  if (janela === 'mes') condicoes.push(`t.prazo_data BETWEEN ${HOJE_ESCRITORIO_SQL} AND (date_trunc('month', ${HOJE_ESCRITORIO_SQL}) + INTERVAL '1 month - 1 day')::date`);
  if (janela === 'futuros') condicoes.push(`t.prazo_data > (date_trunc('month', ${HOJE_ESCRITORIO_SQL}) + INTERVAL '1 month - 1 day')::date`);

  const where = condicoes.join(' AND ');

  const joins = `
    LEFT JOIN processos pr ON pr.id = p.processo_id
    LEFT JOIN clientes c ON c.id = pr.cliente_id
    LEFT JOIN tarefas t ON t.publicacao_id = p.id
    LEFT JOIN usuarios responsavel ON responsavel.id = t.atribuido_a
    LEFT JOIN usuarios validador ON validador.id = t.validado_por
    LEFT JOIN usuarios triador ON triador.id = p.triado_por`;

  const [{ total }] = await db.query(
    `SELECT COUNT(DISTINCT p.id) AS total FROM publicacoes p ${joins} WHERE ${where}`, params
  );

  params.push(limiteSeguro, offset);

  const rows = await db.query(
    `SELECT p.*, pr.numero AS processo_numero, c.nome AS cliente_nome,
            t.id AS prazo_id, t.prazo_data, t.status AS prazo_status,
            t.urgencia AS prazo_urgencia, t.atribuido_a AS prazo_atribuido_a,
            responsavel.nome AS prazo_responsavel_nome,
            t.validado_por AS prazo_validado_por, validador.nome AS prazo_validador_nome,
            t.calendar_event_id AS prazo_calendar_event_id,
            triador.nome AS triado_por_nome,
            (t.prazo_data - ${HOJE_ESCRITORIO_SQL})::int AS dias_restantes,
            CASE
              WHEN t.id IS NULL OR t.status = 'cancelada' THEN 'triagem'
              WHEN t.status = 'concluida' THEN 'concluido'
              WHEN t.prazo_data < ${HOJE_ESCRITORIO_SQL} THEN 'vencido'
              WHEN t.prazo_data = ${HOJE_ESCRITORIO_SQL} THEN 'hoje'
              WHEN t.prazo_data <= (date_trunc('week', ${HOJE_ESCRITORIO_SQL})::date + 6) THEN 'semana'
              WHEN t.prazo_data <= (date_trunc('month', ${HOJE_ESCRITORIO_SQL}) + INTERVAL '1 month - 1 day')::date THEN 'mes'
              ELSE 'futuro'
            END AS prazo_faixa
     FROM publicacoes p
     ${joins}
     WHERE ${where}
     ORDER BY
       CASE WHEN t.status NOT IN ('concluida','cancelada') AND t.prazo_data IS NOT NULL THEN 0 ELSE 1 END,
       t.prazo_data ASC NULLS LAST,
       p.data_disponibilizacao DESC, p.id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const [resumo] = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE t.id IS NOT NULL AND t.prazo_data IS NOT NULL AND t.status NOT IN ('concluida','cancelada'))::int AS abertos,
      COUNT(*) FILTER (WHERE t.prazo_data < ${HOJE_ESCRITORIO_SQL} AND t.status NOT IN ('concluida','cancelada'))::int AS vencidos,
      COUNT(*) FILTER (WHERE t.prazo_data = ${HOJE_ESCRITORIO_SQL} AND t.status NOT IN ('concluida','cancelada'))::int AS hoje,
      COUNT(*) FILTER (WHERE t.prazo_data BETWEEN ${HOJE_ESCRITORIO_SQL} AND (date_trunc('week', ${HOJE_ESCRITORIO_SQL})::date + 6) AND t.status NOT IN ('concluida','cancelada'))::int AS semana,
      COUNT(*) FILTER (WHERE t.prazo_data BETWEEN ${HOJE_ESCRITORIO_SQL} AND (date_trunc('month', ${HOJE_ESCRITORIO_SQL}) + INTERVAL '1 month - 1 day')::date AND t.status NOT IN ('concluida','cancelada'))::int AS mes,
      COUNT(*) FILTER (WHERE t.prazo_data > (date_trunc('month', ${HOJE_ESCRITORIO_SQL}) + INTERVAL '1 month - 1 day')::date AND t.status NOT IN ('concluida','cancelada'))::int AS futuros,
      COUNT(*) FILTER (WHERE p.triagem_status = 'pendente' AND (t.id IS NULL OR t.status = 'cancelada'))::int AS triagem,
      COUNT(*) FILTER (WHERE t.status = 'concluida' OR p.triagem_status IN ('sem_prazo','irrelevante'))::int AS encerrados,
      COUNT(*) FILTER (WHERE p.lido = false)::int AS nao_lidas
    FROM publicacoes p
    LEFT JOIN tarefas t ON t.publicacao_id = p.id
    WHERE p.cancelada = false
  `);

  res.json({ ok: true, publicacoes: rows, total: Number(total), page: pagina, limite: limiteSeguro, visao: visaoEfetiva, resumo });
});

// GET /api/publicacoes/nao-lidas — contador para badge + última sync
publicacoesRouter.get('/nao-lidas', async (req, res) => {
  const [{ total }] = await db.query(
    `SELECT COUNT(*) AS total FROM publicacoes WHERE lido = false AND cancelada = false`
  );
  const sync = await db.queryOne(
    `SELECT valor FROM configuracoes WHERE categoria = 'publicacoes' AND chave = 'ultima_sync'`
  ).catch(() => null);
  res.json({ ok: true, total: Number(total), ultima_sync: sync?.valor || null });
});

// PATCH /api/publicacoes/:id/prazo — confirma ou corrige o prazo extraído.
publicacoesRouter.patch('/:id/prazo', apenasMaster, async (req, res) => {
  if (!publicacaoIdValido(req.params.id)) return res.status(400).json({ ok: false, erro: 'Publicação inválida.' });

  const { prazo_data, atribuido_a } = req.body || {};
  if (!dataISOValida(prazo_data)) return res.status(400).json({ ok: false, erro: 'Informe uma data de prazo válida.' });
  if (atribuido_a && !uuidValido(atribuido_a)) return res.status(400).json({ ok: false, erro: 'Responsável inválido.' });

  const publicacao = await db.queryOne(
    `SELECT p.*, pr.numero AS processo_numero, pr.tribunal AS processo_tribunal,
            pr.vara AS processo_vara, pr.master_responsavel_id
       FROM publicacoes p
       LEFT JOIN processos pr ON pr.id = p.processo_id
      WHERE p.id = $1 AND p.cancelada = false`,
    [req.params.id]
  );
  if (!publicacao) return res.status(404).json({ ok: false, erro: 'Publicação não encontrada.' });

  const dataPrazo = new Date(`${prazo_data}T12:00:00Z`);
  if (!prazoPlausivel(dataPrazo, publicacao.data_disponibilizacao)) {
    return res.status(400).json({ ok: false, erro: 'O prazo deve estar entre a data da publicação e 180 dias depois dela.' });
  }

  const existente = await db.queryOne(`SELECT * FROM tarefas WHERE publicacao_id = $1`, [req.params.id]);
  if (existente?.status === 'concluida') {
    return res.status(409).json({ ok: false, erro: 'Este prazo já foi concluído e não pode ser reaberto por esta tela.' });
  }

  const responsavel = atribuido_a || existente?.atribuido_a || publicacao.master_responsavel_id || req.user.id;
  const diasRestantes = Math.ceil((dataPrazo - new Date()) / 86_400_000);
  const urgencia = diasRestantes <= 2 ? 'CRITICO' : diasRestantes <= 5 ? 'ALTO' : diasRestantes <= 10 ? 'MEDIO' : 'BAIXO';
  let tarefa;

  if (existente) {
    tarefa = await db.queryOne(
      `UPDATE tarefas
          SET prazo_data = $1::date, atribuido_a = $2, validado_por = $3,
              urgencia = $4, status = CASE WHEN status = 'cancelada' THEN 'pendente' ELSE status END,
              justificativa_cancelamento = NULL
        WHERE id = $5
        RETURNING *`,
      [prazo_data, responsavel, req.user.id, urgencia, existente.id]
    );
  } else {
    tarefa = await db.queryOne(
      `INSERT INTO tarefas
         (processo_id, publicacao_id, tipo, descricao, urgencia, prazo_data, atribuido_a, validado_por, status)
       VALUES ($1,$2,'prazo',$3,$4,$5::date,$6,$7,'pendente')
       RETURNING *`,
      [
        publicacao.processo_id,
        publicacao.id,
        `Prazo da publicação — ${publicacao.processo_numero || publicacao.numero_processo || publicacao.id}`,
        urgencia,
        prazo_data,
        responsavel,
        req.user.id,
      ]
    );
  }

  await db.execute(
    `UPDATE publicacoes SET triagem_status = 'pendente', triado_em = NULL, triado_por = NULL WHERE id = $1`,
    [publicacao.id]
  );

  let calendarSincronizado = false;
  const dataHora = new Date(`${prazo_data}T08:00:00-03:00`);
  try {
    if (tarefa.calendar_event_id) {
      await atualizarEventoCalendar(tarefa.calendar_event_id, { dataHora });
      calendarSincronizado = true;
    } else {
      const eventId = await criarEventoCalendar({
        titulo: tarefa.descricao,
        dataHora,
        tipo: 'Prazo de publicação',
        vara: publicacao.processo_vara,
        tribunal: publicacao.processo_tribunal || publicacao.tribunal,
        processoId: publicacao.processo_id,
        descricao: `Publicação ${publicacao.id}\nProcesso: ${publicacao.processo_numero || publicacao.numero_processo || 'não vinculado'}`,
      });
      if (eventId) {
        await db.execute(`UPDATE tarefas SET calendar_event_id = $1 WHERE id = $2`, [eventId, tarefa.id]);
        tarefa.calendar_event_id = eventId;
        calendarSincronizado = true;
      }
    }
  } catch (err) {
    console.warn('[Publicações] Calendar não sincronizado na confirmação:', err.message);
  }

  res.json({ ok: true, tarefa, calendar_sincronizado: calendarSincronizado });
});

// PATCH /api/publicacoes/:id/triagem — registra que a publicação não gera prazo.
publicacoesRouter.patch('/:id/triagem', apenasMaster, async (req, res) => {
  if (!publicacaoIdValido(req.params.id)) return res.status(400).json({ ok: false, erro: 'Publicação inválida.' });
  const { status } = req.body || {};
  if (!['pendente', 'sem_prazo', 'irrelevante'].includes(status)) {
    return res.status(400).json({ ok: false, erro: 'Situação de triagem inválida.' });
  }

  const publicacao = await db.queryOne(`SELECT id FROM publicacoes WHERE id = $1 AND cancelada = false`, [req.params.id]);
  if (!publicacao) return res.status(404).json({ ok: false, erro: 'Publicação não encontrada.' });

  if (status !== 'pendente') {
    await cancelarPrazoDaPublicacao(
      publicacao.id,
      status === 'sem_prazo' ? 'Publicação revisada e confirmada sem prazo' : 'Publicação marcada como irrelevante'
    );
  }

  await db.execute(
    `UPDATE publicacoes
        SET triagem_status = $1,
            triado_em = CASE WHEN $1 = 'pendente' THEN NULL ELSE NOW() END,
            triado_por = CASE WHEN $1 = 'pendente' THEN NULL ELSE $2::uuid END,
            lido = CASE WHEN $1 = 'pendente' THEN lido ELSE true END,
            lido_em = CASE WHEN $1 = 'pendente' THEN lido_em ELSE NOW() END,
            lido_por = CASE WHEN $1 = 'pendente' THEN lido_por ELSE $2::uuid END
      WHERE id = $3`,
    [status, req.user.id, publicacao.id]
  );

  res.json({ ok: true, triagem_status: status });
});

// PATCH /api/publicacoes/:id/lida — marca como lida
publicacoesRouter.patch('/:id/lida', async (req, res) => {
  if (!publicacaoIdValido(req.params.id)) return res.status(400).json({ ok: false, erro: 'Publicação inválida.' });
  await db.execute(
    `UPDATE publicacoes SET lido = true, lido_em = NOW(), lido_por = $1 WHERE id = $2`,
    [req.user.id, req.params.id]
  );
  res.json({ ok: true });
});

// PATCH /api/publicacoes/marcar-todas-lidas — marca todas como lidas
publicacoesRouter.patch('/marcar-todas-lidas', apenasMaster, async (req, res) => {
  const { data } = req.body || {};
  let where = 'lido = false AND cancelada = false';
  const params = [req.user.id];
  if (data) { params.push(data); where += ` AND data_disponibilizacao = $${params.length}`; }
  await db.execute(
    `UPDATE publicacoes SET lido = true, lido_em = NOW(), lido_por = $1 WHERE ${where}`,
    params
  );
  res.json({ ok: true });
});

// POST /api/publicacoes/importar — recebe publicações coletadas pelo script local (IP residencial)
// Exportado separadamente para ser montado SEM autenticar middleware
export async function importarPublicacoesHandler(req, res) {
  const chaveEnv = process.env.SYNC_KEY;
  if (!chaveEnv) return res.status(503).json({ ok: false, erro: 'SYNC_KEY não configurada no servidor.' });
  if (req.headers['x-sync-key'] !== chaveEnv) {
    return res.status(401).json({ ok: false, erro: 'Chave inválida.' });
  }

  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.json({ ok: true, inseridas: 0, vinculadas: 0 });
  }

  let inseridas = 0, vinculadas = 0;
  const validItems = [...new Map(items.filter(i => i.id).map(item => [String(item.id), item])).values()];

  // Busca todos os processos vinculáveis em 1 query (evita N+1)
  const numerosRaw = [...new Set(validItems.map(i => i.numero_processo).filter(Boolean))];
  const processoMap = new Map();
  if (numerosRaw.length > 0) {
    const procs = await db.query(
      `SELECT id, REGEXP_REPLACE(numero, '[^0-9]', '', 'g') AS numero_limpo
       FROM processos
       WHERE REGEXP_REPLACE(numero, '[^0-9]', '', 'g') = ANY($1)`,
      [numerosRaw]
    ).catch(() => []);
    for (const p of procs) processoMap.set(p.numero_limpo, p.id);
  }

  // Insere em paralelo (chunks de 50 para não sobrecarregar o pool)
  const chunkSize = 50;
  for (let i = 0; i < validItems.length; i += chunkSize) {
    const chunk = validItems.slice(i, i + chunkSize);
    const results = await Promise.all(chunk.map(async item => {
      const processoId = processoMap.get(item.numero_processo) || null;
      const cancelada  = !item.ativo || !!item.data_cancelamento;
      const rows = await db.query(
        `INSERT INTO publicacoes
           (id, processo_id, numero_processo_raw, numero_processo, data_disponibilizacao,
            tribunal, tipo_comunicacao, tipo_documento, orgao, texto, link, status, cancelada)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (id) DO UPDATE SET
           processo_id = COALESCE(EXCLUDED.processo_id, publicacoes.processo_id),
           numero_processo_raw = EXCLUDED.numero_processo_raw,
           numero_processo = COALESCE(EXCLUDED.numero_processo, publicacoes.numero_processo),
           data_disponibilizacao = EXCLUDED.data_disponibilizacao,
           tribunal = COALESCE(EXCLUDED.tribunal, publicacoes.tribunal),
           tipo_comunicacao = COALESCE(EXCLUDED.tipo_comunicacao, publicacoes.tipo_comunicacao),
           tipo_documento = COALESCE(EXCLUDED.tipo_documento, publicacoes.tipo_documento),
           orgao = COALESCE(EXCLUDED.orgao, publicacoes.orgao),
           texto = COALESCE(EXCLUDED.texto, publicacoes.texto),
           link = COALESCE(EXCLUDED.link, publicacoes.link),
           cancelada = EXCLUDED.cancelada, status = EXCLUDED.status
         RETURNING (xmax = 0) AS inserted`,
        [
          item.id, processoId,
          item.numero_processo || '', item.numeroprocessocommascara || null,
          item.data_disponibilizacao,
          item.siglaTribunal || null, item.tipoComunicacao || null,
          item.tipoDocumento || null, item.nomeOrgao || null,
          item.texto || null, item.link || null,
          item.status || null, cancelada,
        ]
      ).catch(() => []);
      if (!rows[0]) return null;

      if (cancelada) await cancelarPrazoDaPublicacao(item.id, 'Publicação cancelada na origem');
      else await criarTarefaDePublicacao(item, processoId);

      return rows[0];
    }));
    for (const r of results) {
      if (r?.inserted) inseridas++;
    }
  }
  vinculadas = processoMap.size; // processos únicos vinculados

  // Registra data/hora da última sincronização
  await db.query(
    `INSERT INTO configuracoes (categoria, chave, valor) VALUES ('publicacoes','ultima_sync',$1)
     ON CONFLICT (categoria, chave) DO UPDATE SET valor = $1, atualizado_em = NOW()`,
    [new Date().toISOString()]
  ).catch(() => {});

  console.log(`[Comunica/Import] ${inseridas} novas, ${vinculadas} vinculadas (${items.length} recebidas).`);
  res.json({ ok: true, inseridas, vinculadas });
}

// POST /api/publicacoes/importar-browser — recebe publicações coletadas pelo browser (IP do usuário)
publicacoesRouter.post('/importar-browser', apenasMaster, async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) return res.json({ ok: true, inseridas: 0, vinculadas: 0 });

  let inseridas = 0;
  const validItems2 = [...new Map(items.filter(i => i.id).map(item => [String(item.id), item])).values()];

  const numerosRaw2 = [...new Set(validItems2.map(i => i.numero_processo).filter(Boolean))];
  const processoMap2 = new Map();
  if (numerosRaw2.length > 0) {
    const procs = await db.query(
      `SELECT id, REGEXP_REPLACE(numero, '[^0-9]', '', 'g') AS numero_limpo
       FROM processos
       WHERE REGEXP_REPLACE(numero, '[^0-9]', '', 'g') = ANY($1)`,
      [numerosRaw2]
    ).catch(() => []);
    for (const p of procs) processoMap2.set(p.numero_limpo, p.id);
  }

  const chunkSize2 = 50;
  for (let i = 0; i < validItems2.length; i += chunkSize2) {
    const chunk = validItems2.slice(i, i + chunkSize2);
    const results = await Promise.all(chunk.map(async item => {
      const processoId = processoMap2.get(item.numero_processo) || null;
      const cancelada  = !item.ativo || !!item.data_cancelamento;
      const rows = await db.query(
        `INSERT INTO publicacoes
           (id, processo_id, numero_processo_raw, numero_processo, data_disponibilizacao,
            tribunal, tipo_comunicacao, tipo_documento, orgao, texto, link, status, cancelada)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (id) DO UPDATE SET
           processo_id = COALESCE(EXCLUDED.processo_id, publicacoes.processo_id),
           numero_processo_raw = EXCLUDED.numero_processo_raw,
           numero_processo = COALESCE(EXCLUDED.numero_processo, publicacoes.numero_processo),
           data_disponibilizacao = EXCLUDED.data_disponibilizacao,
           tribunal = COALESCE(EXCLUDED.tribunal, publicacoes.tribunal),
           tipo_comunicacao = COALESCE(EXCLUDED.tipo_comunicacao, publicacoes.tipo_comunicacao),
           tipo_documento = COALESCE(EXCLUDED.tipo_documento, publicacoes.tipo_documento),
           orgao = COALESCE(EXCLUDED.orgao, publicacoes.orgao),
           texto = COALESCE(EXCLUDED.texto, publicacoes.texto),
           link = COALESCE(EXCLUDED.link, publicacoes.link),
           cancelada = EXCLUDED.cancelada, status = EXCLUDED.status
         RETURNING (xmax = 0) AS inserted`,
        [
          item.id, processoId,
          item.numero_processo || '', item.numeroprocessocommascara || null,
          item.data_disponibilizacao,
          item.siglaTribunal || null, item.tipoComunicacao || null,
          item.tipoDocumento || null, item.nomeOrgao || null,
          item.texto || null, item.link || null,
          item.status || null, cancelada,
        ]
      ).catch(() => []);
      if (!rows[0]) return null;

      if (cancelada) await cancelarPrazoDaPublicacao(item.id, 'Publicação cancelada na origem');
      else await criarTarefaDePublicacao(item, processoId);

      return rows[0];
    }));
    for (const r of results) { if (r?.inserted) inseridas++; }
  }

  await db.query(
    `INSERT INTO configuracoes (categoria, chave, valor) VALUES ('publicacoes','ultima_sync',$1)
     ON CONFLICT (categoria, chave) DO UPDATE SET valor = $1, atualizado_em = NOW()`,
    [new Date().toISOString()]
  ).catch(() => {});
  res.json({ ok: true, inseridas, vinculadas: processoMap2.size });
});

// POST /api/publicacoes/sincronizar — desativado (Comunica API bloqueia IPs de nuvem)
// Use o script local: node ~/sync-publicacoes.mjs
publicacoesRouter.post('/sincronizar', apenasMaster, (_req, res) => {
  res.status(503).json({ ok: false, erro: 'Sync automático indisponível. Use o script local: node ~/sync-publicacoes.mjs' });
});

// POST /api/publicacoes/reprocessar-prazos — gera tarefas retroativas para publicações antigas com prazo detectável
publicacoesRouter.post('/reprocessar-prazos', apenasMaster, async (req, res) => {
  // Busca publicações com processo vinculado, texto e sem tarefa de prazo ainda
  const pubs = await db.query(
    `SELECT p.id, p.texto, p.data_disponibilizacao, p.processo_id, p.numero_processo, p.tribunal AS pub_tribunal,
            pr.numero, pr.tribunal, pr.vara, pr.master_responsavel_id
     FROM publicacoes p
     LEFT JOIN processos pr ON pr.id = p.processo_id
     WHERE p.texto IS NOT NULL
       AND p.cancelada = false
       AND NOT EXISTS (
         SELECT 1 FROM tarefas t WHERE t.publicacao_id = p.id
       )
     ORDER BY p.data_disponibilizacao DESC
     LIMIT 500`
  );

  let criadas = 0, ignoradas = 0;

  for (const pub of pubs) {
    try {
      // Sem processo cadastrado: usa o número bruto da própria publicação
      const processo = pub.processo_id
        ? { id: pub.processo_id, numero: pub.numero, tribunal: pub.tribunal, vara: pub.vara }
        : (pub.numero_processo ? { id: null, numero: pub.numero_processo, tribunal: pub.pub_tribunal, vara: null } : null);
      if (!processo) { ignoradas++; continue; }
      const prazo = extrairPrazoPublicacao(pub.texto, pub.data_disponibilizacao, processo);
      if (!prazo) { ignoradas++; continue; }
      if (!prazoPlausivel(prazo.dataEvento, pub.data_disponibilizacao)) { ignoradas++; continue; }

      const diasRestantes = Math.ceil((prazo.dataEvento - new Date()) / (1000 * 60 * 60 * 24));
      const urgencia = diasRestantes <= 2 ? 'CRITICO' : diasRestantes <= 5 ? 'ALTO' : diasRestantes <= 10 ? 'MEDIO' : 'BAIXO';

      const eventId = await criarEventoCalendar({
        titulo:    prazo.titulo,
        dataHora:  prazo.dataEvento,
        tipo:      prazo.titulo,
        vara:      processo.vara,
        tribunal:  processo.tribunal,
        processoId: processo.id,
        descricao: prazo.descricao,
      }).catch(() => null);

      await db.query(
        `INSERT INTO tarefas
           (processo_id, publicacao_id, tipo, descricao, urgencia, prazo_data, atribuido_a, validado_por, status, calendar_event_id)
         VALUES ($1,$2,'prazo',$3,$4,$5::date,$6,NULL,'pendente',$7)
         ON CONFLICT DO NOTHING`,
        [processo.id, pub.id, prazo.titulo, urgencia, prazo.dataEvento.toISOString().slice(0, 10), pub.master_responsavel_id || null, eventId || null]
      );
      criadas++;
    } catch { ignoradas++; }
  }

  res.json({ ok: true, criadas, ignoradas, total: pubs.length });
});
