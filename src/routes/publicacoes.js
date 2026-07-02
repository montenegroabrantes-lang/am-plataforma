import { Router } from 'express';
import { db }      from '../db/index.js';
import { apenasMaster } from '../middleware/auth.js';
import { criarEventoCalendar } from '../services/calendar/index.js';
import { extrairPrazoPublicacao } from '../services/publicacoes/extrairPrazo.js';

export const publicacoesRouter = Router();

// Tenta criar tarefa + evento Calendar com prazo extraído de uma publicação nova.
// processoId pode ser null (processo ainda não cadastrado) — a tarefa é criada mesmo assim.
async function criarTarefaDePublicacao(item, processoId) {
  if (!item.texto) return;
  try {
    const processo = processoId
      ? await db.queryOne(`SELECT id, numero, tribunal, vara FROM processos WHERE id = $1`, [processoId]).catch(() => null)
      : null;
    const prazo = extrairPrazoPublicacao(item.texto, item.data_disponibilizacao, processo);
    if (!prazo) return;

    const diasRestantes = Math.ceil((prazo.dataEvento - new Date()) / (1000 * 60 * 60 * 24));
    const urgencia = diasRestantes <= 2 ? 'CRITICO' : diasRestantes <= 5 ? 'ALTO' : diasRestantes <= 10 ? 'MEDIO' : 'BAIXO';

    const eventId = await criarEventoCalendar({
      titulo:    prazo.titulo,
      dataHora:  prazo.dataEvento,
      tipo:      prazo.titulo,
      vara:      processo?.vara,
      tribunal:  processo?.tribunal || item.siglaTribunal,
      processoId,
      descricao: prazo.descricao,
    }).catch(() => null);

    await db.query(
      `INSERT INTO tarefas
         (processo_id, publicacao_id, tipo, descricao, urgencia, prazo_data, validado_por, status, calendar_event_id)
       VALUES ($1,$2,'prazo',$3,$4,$5::date,NULL,'pendente',$6)
       ON CONFLICT DO NOTHING`,
      [
        processoId,
        item.id,
        prazo.titulo,
        urgencia,
        prazo.dataEvento.toISOString().slice(0, 10),
        eventId || null,
      ]
    ).catch(e => console.warn('[Publicações] Tarefa não criada:', e.message));
  } catch (err) {
    console.warn('[Publicações] Erro ao criar evento/tarefa:', err.message);
  }
}

// GET /api/publicacoes — lista publicações com filtros
publicacoesRouter.get('/', async (req, res) => {
  const { lido, processo_id, tribunal, dias, page = 1, limite = 50 } = req.query;
  const offset = (Number(page) - 1) * Number(limite);

  const params    = [];
  const condicoes = ['cancelada = false'];

  if (lido === 'true')  condicoes.push('lido = true');
  if (lido === 'false') condicoes.push('lido = false');
  if (processo_id) { params.push(processo_id); condicoes.push(`processo_id = $${params.length}`); }
  if (tribunal)    { params.push(tribunal);    condicoes.push(`tribunal = $${params.length}`); }
  if (dias !== undefined) {
    const d = Number(dias);
    if (d === 0) {
      condicoes.push(`data_disponibilizacao = CURRENT_DATE`);
    } else {
      condicoes.push(`data_disponibilizacao >= CURRENT_DATE - INTERVAL '${d} days'`);
    }
  }

  const where = condicoes.join(' AND ');

  const [{ total }] = await db.query(
    `SELECT COUNT(*) AS total FROM publicacoes WHERE ${where}`, params
  );

  params.push(Number(limite), offset);

  const rows = await db.query(
    `SELECT p.*, pr.numero AS processo_numero, c.nome AS cliente_nome
     FROM publicacoes p
     LEFT JOIN processos pr ON pr.id = p.processo_id
     LEFT JOIN clientes c ON c.id = pr.cliente_id
     WHERE ${where}
     ORDER BY p.data_disponibilizacao DESC, p.id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({ ok: true, publicacoes: rows, total: Number(total) });
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

// PATCH /api/publicacoes/:id/lida — marca como lida
publicacoesRouter.patch('/:id/lida', async (req, res) => {
  await db.execute(
    `UPDATE publicacoes SET lido = true, lido_em = NOW(), lido_por = $1 WHERE id = $2`,
    [req.user.id, req.params.id]
  );
  res.json({ ok: true });
});

// PATCH /api/publicacoes/marcar-todas-lidas — marca todas como lidas
publicacoesRouter.patch('/marcar-todas-lidas', apenasMaster, async (req, res) => {
  const { data } = req.body;
  let where = 'lido = false';
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
  const validItems = items.filter(i => i.id);

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
           cancelada   = EXCLUDED.cancelada, status = EXCLUDED.status
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
      if (!rows[0]?.inserted) return rows[0];

      await criarTarefaDePublicacao(item, processoId);

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
  const validItems2 = items.filter(i => i.id);

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
      if (!rows[0]?.inserted) return rows[0];

      await criarTarefaDePublicacao(item, processoId);

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
    `SELECT p.id, p.texto, p.data_disponibilizacao, p.processo_id,
            pr.numero, pr.tribunal, pr.vara
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
      const processo = { id: pub.processo_id, numero: pub.numero, tribunal: pub.tribunal, vara: pub.vara };
      const prazo = extrairPrazoPublicacao(pub.texto, pub.data_disponibilizacao, processo);
      if (!prazo) { ignoradas++; continue; }

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
           (processo_id, publicacao_id, tipo, descricao, urgencia, prazo_data, validado_por, status, calendar_event_id)
         VALUES ($1,$2,'prazo',$3,$4,$5::date,NULL,'pendente',$6)
         ON CONFLICT DO NOTHING`,
        [processo.id, pub.id, prazo.titulo, urgencia, prazo.dataEvento.toISOString().slice(0, 10), eventId || null]
      );
      criadas++;
    } catch { ignoradas++; }
  }

  res.json({ ok: true, criadas, ignoradas, total: pubs.length });
});
