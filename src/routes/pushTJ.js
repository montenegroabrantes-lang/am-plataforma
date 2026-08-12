// Rotas do push do TJPB: saúde da integração e fila de movimentos que chegaram
// para processos não cadastrados.

import { Router } from 'express';
import { db }     from '../db/index.js';
import { apenasMaster } from '../middleware/auth.js';
import { paginacaoSegura } from '../utils/validacao.js';

export const pushTJRouter = Router();

// GET /api/push-tj/saude — o painel usa para mostrar se o push está vivo.
// Existe porque o DataJud ficou 22 dias morto reportando "ok": aqui a diferença
// entre "rodou e não havia nada" e "não conseguiu rodar" é explícita.
pushTJRouter.get('/saude', async (req, res) => {
  const [ultima] = await db.query(
    `SELECT id, iniciado_em, concluido_em, lidas, prazos_criados,
            processos_desconhecidos, sem_prazo, falhas, erro
       FROM push_execucoes ORDER BY iniciado_em DESC LIMIT 1`
  );

  const [agregado] = await db.query(
    `SELECT
       (SELECT MAX(recebido_em) FROM push_tj_mensagens)                              AS ultimo_email,
       (SELECT COUNT(*) FROM push_tj_mensagens WHERE recebido_em > NOW() - INTERVAL '7 days') AS emails_7d,
       (SELECT COUNT(*) FROM push_tj_mensagens WHERE status = 'processo_desconhecido' AND resolvido = false) AS desconhecidos_pendentes,
       (SELECT COUNT(*) FROM push_tj_mensagens WHERE status IN ('sem_prazo','prazo_implausivel','sem_numero','erro') AND resolvido = false) AS conferir_pendentes,
       (SELECT COUNT(*) FROM push_execucoes WHERE iniciado_em > NOW() - INTERVAL '24 hours' AND erro IS NOT NULL) AS falhas_24h`
  );

  const ultimoEmail = agregado?.ultimo_email ? new Date(agregado.ultimo_email) : null;
  const horasSemEmail = ultimoEmail ? Math.floor((Date.now() - ultimoEmail) / 3_600_000) : null;

  // Configurado e sem e-mail há mais de 48h úteis é suspeito: ou o tribunal
  // parou de enviar, ou a regra da caixa mudou, ou a credencial expirou.
  const configurado = Boolean(process.env.OUTLOOK_REFRESH_TOKEN);
  const alerta = !configurado ? 'nao_configurado'
               : ultima?.erro   ? 'erro_na_ultima_execucao'
               : horasSemEmail !== null && horasSemEmail > 48 ? 'silencioso'
               : ultimoEmail === null ? 'nenhum_email_ainda'
               : 'ok';

  res.json({
    ok: true,
    configurado,
    alerta,
    ultima_execucao: ultima || null,
    ultimo_email: agregado?.ultimo_email || null,
    horas_sem_email: horasSemEmail,
    emails_7d: Number(agregado?.emails_7d || 0),
    desconhecidos_pendentes: Number(agregado?.desconhecidos_pendentes || 0),
    conferir_pendentes: Number(agregado?.conferir_pendentes || 0),
    falhas_24h: Number(agregado?.falhas_24h || 0),
  });
});

// GET /api/push-tj/pendentes — movimentos que precisam de decisão humana:
// processo não cadastrado, prazo não identificado ou prazo implausível.
pushTJRouter.get('/pendentes', async (req, res) => {
  const { status, page, limite } = req.query;
  const { limite: limiteSeguro, offset } = paginacaoSegura(page, limite);

  const params = [];
  const condicoes = ['resolvido = false', `status <> 'prazo_criado'`, `status <> 'duplicada'`];

  if (status) { params.push(status); condicoes.push(`status = $${params.length}`); }

  const [{ total }] = await db.query(
    `SELECT COUNT(*) AS total FROM push_tj_mensagens WHERE ${condicoes.join(' AND ')}`,
    params
  );

  params.push(limiteSeguro, offset);
  const rows = await db.query(
    `SELECT id, assunto, recebido_em, numero_processo, processo_id, status, motivo,
            LEFT(corpo, 600) AS trecho
       FROM push_tj_mensagens
      WHERE ${condicoes.join(' AND ')}
      ORDER BY recebido_em DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({ ok: true, mensagens: rows, total: Number(total), limite: limiteSeguro });
});

// PATCH /api/push-tj/:id/resolver — tira da fila (já foi tratado manualmente).
pushTJRouter.patch('/:id/resolver', apenasMaster, async (req, res) => {
  const r = await db.execute(
    `UPDATE push_tj_mensagens SET resolvido = true WHERE id = $1 AND resolvido = false`,
    [req.params.id]
  );
  if (r.rowCount === 0) return res.status(404).json({ ok: false, erro: 'Mensagem não encontrada ou já resolvida.' });
  res.json({ ok: true });
});
