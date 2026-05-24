import { Router } from 'express';
import { db }      from '../db/index.js';
import { criarEventoCalendar, atualizarEventoCalendar } from '../services/calendar/index.js';

export const agendaRouter = Router();

// GET /api/agenda — lista audiências (com filtros de data e advogado)
agendaRouter.get('/', async (req, res) => {
  const { de, ate, advogado_id, processo_id } = req.query;
  const { id, perfil, master_id, pode_marcar_restrito } = req.user;

  const params = [];
  const condicoes = ['1=1'];

  // Filtro de visibilidade por sócio
  if (!pode_marcar_restrito) {
    const masterId = perfil === 'master' ? id : master_id;
    params.push(masterId);
    condicoes.push(`p.master_responsavel_id = $${params.length}`);
  }

  if (de)          { params.push(de);          condicoes.push(`a.data_hora >= $${params.length}`); }
  if (ate)         { params.push(ate);          condicoes.push(`a.data_hora <= $${params.length}`); }
  if (advogado_id) { params.push(advogado_id);  condicoes.push(`a.advogado_id = $${params.length}`); }
  if (processo_id) { params.push(processo_id);  condicoes.push(`a.processo_id = $${params.length}`); }

  const rows = await db.query(
    `SELECT a.*, p.numero AS processo_numero, p.tribunal,
            c.nome AS cliente_nome, u.nome AS advogado_nome
     FROM audiencias a
     JOIN processos p  ON p.id = a.processo_id
     LEFT JOIN clientes c  ON c.id = p.cliente_id
     LEFT JOIN usuarios u  ON u.id = a.advogado_id
     WHERE ${condicoes.join(' AND ')}
     ORDER BY a.data_hora ASC`,
    params
  );

  res.json({ ok: true, audiencias: rows });
});

// POST /api/agenda — cadastra audiência manualmente
agendaRouter.post('/', async (req, res) => {
  const { processo_id, data_hora, tipo, vara, advogado_id } = req.body;

  if (!processo_id || !data_hora) {
    return res.status(400).json({ ok: false, erro: 'processo_id e data_hora são obrigatórios.' });
  }

  const processo = await db.queryOne(
    `SELECT p.*, c.nome AS cliente_nome FROM processos p LEFT JOIN clientes c ON c.id = p.cliente_id WHERE p.id = $1`,
    [processo_id]
  );
  if (!processo) return res.status(404).json({ ok: false, erro: 'Processo não encontrado.' });

  const [nova] = await db.query(
    `INSERT INTO audiencias (processo_id, data_hora, tipo, vara, advogado_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [processo_id, data_hora, tipo || null, vara || null, advogado_id || null]
  );

  // Cria evento no Google Calendar em background
  criarEventoCalendar({
    titulo:    `Audiência — ${processo.numero} (${processo.cliente_nome || 'cliente'})`,
    dataHora:  data_hora,
    tipo:      tipo,
    vara:      vara || processo.vara,
    tribunal:  processo.tribunal,
    processoId: processo_id,
  })
    .then(async (eventId) => {
      if (eventId) {
        await db.execute(
          'UPDATE audiencias SET google_event_id = $1 WHERE id = $2',
          [eventId, nova.id]
        );
      }
    })
    .catch(err => console.error('[Calendar] Falha ao criar evento:', err.message));

  res.status(201).json({ ok: true, audiencia: nova });
});

// PATCH /api/agenda/:id — atualiza resultado ou dados
agendaRouter.patch('/:id', async (req, res) => {
  const { resultado, data_hora, tipo, vara } = req.body;
  const campos  = { resultado, data_hora, tipo, vara };
  const updates = [];
  const params  = [];

  for (const [campo, valor] of Object.entries(campos)) {
    if (valor !== undefined) {
      params.push(valor);
      updates.push(`${campo} = $${params.length}`);
    }
  }

  if (!updates.length) return res.status(400).json({ ok: false, erro: 'Nenhum campo para atualizar.' });

  params.push(req.params.id);
  await db.execute(`UPDATE audiencias SET ${updates.join(', ')} WHERE id = $${params.length}`, params);

  // Atualiza no Google Calendar se houver event_id
  const aud = await db.queryOne('SELECT google_event_id FROM audiencias WHERE id = $1', [req.params.id]);
  if (aud?.google_event_id && data_hora) {
    atualizarEventoCalendar(aud.google_event_id, { dataHora: data_hora })
      .catch(err => console.error('[Calendar] Falha ao atualizar evento:', err.message));
  }

  res.json({ ok: true });
});
