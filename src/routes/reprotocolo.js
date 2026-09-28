// /api/reprotocolo — levantamento de re-protocolo (SOMENTE LEITURA), restrito a Master.
//
// Acesso: autenticar (index.js) → apenasMaster → exigirEscopo('reprotocolo'). Uma sessão Master
// normal do AM entra; o conector Claude só entra se o Master marcou a permissão "Levantamento
// de re-protocolo" ao autorizar (escopo OAuth `reprotocolo`). Nenhuma rota daqui grava dado de
// negócio: só registram a consulta em logs_auditoria (quem viu dado de cliente e quando).
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { apenasMaster, exigirEscopo } from '../middleware/auth.js';
import { registrarAuditoria } from '../middleware/auditoria.js';
import { uuidValido } from '../utils/validacao.js';
import { levantarReprotocolo, formatarLevantamento } from '../services/reprotocolo/levantamento.js';
import { conferirVinculoOficial } from '../services/reprotocolo/vinculoOficial.js';
import { ReferenciaEstadualError } from '../services/remuneracaoEstadual.js';

const SECOES = ['todas', 'prontos', 'aguardando'];
const DETALHES = ['resumo', 'itens'];

// Mesmo limite da consulta oficial da aba Estimativas: é API pública do governo.
function limitadorFonteOficial() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, erro: 'Limite de consultas oficiais atingido. Aguarde alguns minutos.' },
  });
}

export function criarReprotocoloRouter({
  levantar = levantarReprotocolo,
  conferir = conferirVinculoOficial,
  auditar = registrarAuditoria,
  limitador = limitadorFonteOficial(),
} = {}) {
  const router = Router();
  router.use(apenasMaster, exigirEscopo('reprotocolo'));

  // GET /api/reprotocolo/levantamento?secao=todas|prontos|aguardando&detalhe=itens|resumo&ente=&limite=
  router.get('/levantamento', async (req, res) => {
    const secao = req.query.secao ?? 'todas';
    const detalhe = req.query.detalhe ?? 'itens';
    if (!SECOES.includes(secao)) return res.status(400).json({ ok: false, erro: `secao deve ser: ${SECOES.join(', ')}.` });
    if (!DETALHES.includes(detalhe)) return res.status(400).json({ ok: false, erro: `detalhe deve ser: ${DETALHES.join(', ')}.` });
    const limiteNum = req.query.limite === undefined ? 200 : Number(req.query.limite);
    if (!Number.isInteger(limiteNum) || limiteNum < 1 || limiteNum > 500) {
      return res.status(400).json({ ok: false, erro: 'limite deve ser um inteiro de 1 a 500.' });
    }
    const ente = String(req.query.ente ?? '').trim().slice(0, 100);

    const bruto = await levantar({ podeVerRestrito: Boolean(req.user.pode_marcar_restrito) });
    const saida = formatarLevantamento(bruto, { secao, detalhe, limite: limiteNum, ente });
    await auditar({
      usuarioId: req.user.id, acao: 'consultar_levantamento_reprotocolo', entidade: 'tarefa',
      valorDepois: {
        secao, detalhe, ente: ente || null,
        prontos: saida.prontos?.total ?? null, aguardando_autorizacao: saida.aguardando_autorizacao?.total ?? null,
        via_conector: Array.isArray(req.user.escopos), autorizado_por: req.user.autorizado_por ?? null,
      },
      ip: req._ip,
    });
    res.json({ ...saida, gerado_em: new Date().toISOString() });
  });

  // GET /api/reprotocolo/:tarefaId/vinculo-oficial[?atualizar=1] — UMA tarefa por chamada.
  router.get('/:tarefaId/vinculo-oficial', limitador, async (req, res) => {
    const { tarefaId } = req.params;
    if (!uuidValido(tarefaId)) return res.status(400).json({ ok: false, erro: 'ID de tarefa inválido.' });
    let resultado;
    try {
      resultado = await conferir(tarefaId, {
        podeVerRestrito: Boolean(req.user.pode_marcar_restrito),
        forcar: req.query.atualizar === '1',
      });
    } catch (err) {
      if (err instanceof ReferenciaEstadualError) {
        return res.status(err.status).json({ ok: false, codigo: err.codigo, erro: err.message });
      }
      if (err?.isAxiosError || err?.response) {
        return res.status(502).json({ ok: false, codigo: 'fonte_oficial_indisponivel', erro: 'Não foi possível consultar a fonte oficial agora.' });
      }
      throw err;
    }
    if (!resultado) {
      return res.status(404).json({ ok: false, erro: 'Tarefa não encontrada nas filas Re-protocolo/Novos ciclos.' });
    }
    await auditar({
      usuarioId: req.user.id, acao: 'conferir_vinculo_oficial', entidade: 'tarefa', entidadeId: tarefaId,
      valorDepois: { status: resultado.status, uf: resultado.uf ?? null, via_conector: Array.isArray(req.user.escopos), autorizado_por: req.user.autorizado_por ?? null },
      ip: req._ip,
    });
    res.json(resultado);
  });

  return router;
}

export const reprotocoloRouter = criarReprotocoloRouter();
