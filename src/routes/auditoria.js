import { Router } from 'express';
import { db } from '../db/index.js';
import { apenasMaster01 } from '../middleware/auth.js';
import { CONTA_SERVICO_EMAIL } from '../oauth/escopos.js';

// S-13 — consulta da trilha de auditoria (somente leitura), só para o Master 01.
//   GET /api/auditoria?acao=&usuario=&de=&ate=&pagina=   50 linhas por página
//   GET /api/auditoria/acoes                              ações existentes, para o filtro da tela
// Não há rota de escrita: a tabela só recebe INSERT (ver db/auditoriaMigracao.js).

export const POR_PAGINA = 50;
const DATA_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ACAO_RE = /^[\w.:-]{1,80}$/;

function dataValida(texto) {
  const m = typeof texto === 'string' ? DATA_RE.exec(texto) : null;
  if (!m) return false;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

const escaparLike = texto => texto.replace(/[\\%_]/g, '\\$&');

// Monta o WHERE a partir dos filtros. Devolve { erro } (mensagem de 400) ou { condicoes, params }.
export function montarFiltros(query) {
  const condicoes = [];
  const params = [];
  const acao = typeof query.acao === 'string' ? query.acao.trim() : '';
  if (acao) {
    if (!ACAO_RE.test(acao)) return { erro: 'Ação inválida.' };
    params.push(acao); condicoes.push(`l.acao = $${params.length}`);
  }
  const usuario = typeof query.usuario === 'string' ? query.usuario.trim().slice(0, 100) : '';
  if (usuario) {
    params.push(usuario);
    const exato = params.length;
    params.push(`%${escaparLike(usuario)}%`);
    const parcial = params.length;
    condicoes.push(`(l.usuario_id::text = $${exato} OR COALESCE(l.usuario_nome, u.nome) ILIKE $${parcial} OR COALESCE(l.usuario_email, u.email) ILIKE $${parcial})`);
  }
  // As datas são dias do escritório (Brasília), inclusive no último dia.
  if (query.de) {
    if (!dataValida(query.de)) return { erro: 'Data inicial inválida (use AAAA-MM-DD).' };
    params.push(query.de); condicoes.push(`l.criado_em >= ($${params.length}::date)::timestamp AT TIME ZONE 'America/Sao_Paulo'`);
  }
  if (query.ate) {
    if (!dataValida(query.ate)) return { erro: 'Data final inválida (use AAAA-MM-DD).' };
    params.push(query.ate); condicoes.push(`l.criado_em < (($${params.length}::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')`);
  }
  return { condicoes, params };
}

export function criarAuditoriaRouter({ banco = db } = {}) {
  const router = Router();

  router.use(apenasMaster01);
  // O conector do Claude (conta de serviço, token com escopos) nunca lê a auditoria.
  router.use((req, res, next) => {
    if (Array.isArray(req.user?.escopos) || req.user?.email === CONTA_SERVICO_EMAIL) {
      return res.status(403).json({ ok: false, erro: 'A consulta da auditoria só está disponível na sessão do AM.' });
    }
    next();
  });

  router.get('/acoes', async (_req, res) => {
    const acoes = await banco.query(`SELECT acao, COUNT(*)::int AS total FROM logs_auditoria GROUP BY acao ORDER BY acao`);
    res.json({ ok: true, acoes });
  });

  router.get('/', async (req, res) => {
    const filtro = montarFiltros(req.query);
    if (filtro.erro) return res.status(400).json({ ok: false, erro: filtro.erro });

    const pedida = Math.floor(Number(req.query.pagina));
    const pagina = Number.isFinite(pedida) && pedida >= 1 ? Math.min(pedida, 1_000_000) : 1;
    const onde = filtro.condicoes.length ? `WHERE ${filtro.condicoes.join(' AND ')}` : '';
    const de = 'FROM logs_auditoria l LEFT JOIN usuarios u ON u.id = l.usuario_id';

    const [{ total }] = await banco.query(`SELECT COUNT(*)::int AS total ${de} ${onde}`, filtro.params);
    const registros = await banco.query(
      `SELECT l.id, l.criado_em, l.acao, l.entidade, l.entidade_id, l.usuario_id,
              COALESCE(l.usuario_nome, u.nome) AS usuario_nome,
              COALESCE(l.usuario_email, u.email) AS usuario_email,
              l.ip, l.valor_antes, l.valor_depois
         ${de} ${onde}
        ORDER BY l.criado_em DESC, l.id DESC
        LIMIT ${POR_PAGINA} OFFSET ${(pagina - 1) * POR_PAGINA}`,
      filtro.params
    );

    res.json({ ok: true, registros, total, pagina, por_pagina: POR_PAGINA, paginas: Math.max(1, Math.ceil(total / POR_PAGINA)) });
  });

  return router;
}

export const auditoriaRouter = criarAuditoriaRouter();
