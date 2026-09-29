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
import {
  verificarCiclos, confirmarCiclos, resumirResultado, totaisPorGrupo, salvarConferenciaOficial, vincularPastaAntiga, GRUPO,
} from '../services/reprotocolo/verificacao.js';
import { db } from '../db/index.js';
import { ReferenciaEstadualError } from '../services/remuneracaoEstadual.js';

const SECOES = ['todas', 'prontos', 'aguardando'];
const GRUPOS = Object.values(GRUPO);
const ID_DRIVE_RE = /^[A-Za-z0-9_-]{10,120}$/;

// Escrita só por sessão de usuário do AM (Master). O conector do chat tem escopo de leitura: token com
// `escopos` nunca confirma nem altera nada por aqui (a escrita pelo chat será uma permissão à parte).
function apenasSessao(req, res, next) {
  if (Array.isArray(req.user?.escopos)) {
    return res.status(403).json({ ok: false, erro: 'Esta ação só pode ser feita pelo AM (sessão de usuário), não pelo conector do chat.' });
  }
  next();
}
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
  verificar = verificarCiclos,
  confirmar = confirmarCiclos,
  salvarOficial = salvarConferenciaOficial,
  vincularPasta = vincularPastaAntiga,
  transacao = (fn) => db.transaction(fn),
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

  // GET /api/reprotocolo/verificacao?grupo=&ente=&limite=&offset= — verificação de cada ciclo aberto
  // (Confirmado / Conferir / Bloqueado), com motivos e a confirmação gravada. Somente leitura.
  router.get('/verificacao', async (req, res) => {
    const grupo = req.query.grupo ?? '';
    if (grupo && !GRUPOS.includes(grupo)) return res.status(400).json({ ok: false, erro: `grupo deve ser: ${GRUPOS.join(', ')}.` });
    const limite = req.query.limite === undefined ? 200 : Number(req.query.limite);
    const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
    if (!Number.isInteger(limite) || limite < 1 || limite > 500) return res.status(400).json({ ok: false, erro: 'limite deve ser um inteiro de 1 a 500.' });
    if (!Number.isInteger(offset) || offset < 0) return res.status(400).json({ ok: false, erro: 'offset deve ser um inteiro a partir de 0.' });
    const ente = String(req.query.ente ?? '').trim().toLowerCase().slice(0, 100);

    const { hoje, resultados } = await verificar({ podeVerRestrito: Boolean(req.user.pode_marcar_restrito) });
    const ordem = { [GRUPO.CONFIRMADO]: 0, [GRUPO.CONFERIR]: 1, [GRUPO.BLOQUEADO]: 2 };
    const filtrados = resultados
      .filter(r => (!grupo || r.grupo === grupo) && (!ente || String(r.item.ente?.nome ?? '').toLowerCase().includes(ente)))
      .sort((a, b) => ordem[a.grupo] - ordem[b.grupo] || String(a.item.cliente.nome).localeCompare(String(b.item.cliente.nome)));
    await auditar({
      usuarioId: req.user.id, acao: 'consultar_verificacao_reprotocolo', entidade: 'tarefa',
      valorDepois: { grupo: grupo || null, ente: ente || null, via_conector: Array.isArray(req.user.escopos), autorizado_por: req.user.autorizado_por ?? null },
      ip: req._ip,
    });
    res.json({
      ok: true, hoje, totais: totaisPorGrupo(resultados), total_filtrado: filtrados.length,
      itens: filtrados.slice(offset, offset + limite).map(resumirResultado),
    });
  });

  // POST /api/reprotocolo/verificacao/confirmar — confirma ciclos (só sessão do AM).
  // Corpo: { tarefa_ids: [uuid], motivos_aceitos: { <tarefaId>: [codigo] }, observacao }
  router.post('/verificacao/confirmar', apenasSessao, async (req, res) => {
    const { tarefa_ids: ids, motivos_aceitos: aceitos = {}, observacao = '' } = req.body || {};
    if (!Array.isArray(ids) || !ids.length || ids.length > 200 || ids.some(id => !uuidValido(id))) {
      return res.status(400).json({ ok: false, erro: 'Informe de 1 a 200 tarefas válidas.' });
    }
    if (typeof aceitos !== 'object' || aceitos === null || Array.isArray(aceitos)) {
      return res.status(400).json({ ok: false, erro: 'motivos_aceitos deve ser um objeto { tarefaId: [códigos] }.' });
    }
    const pedidos = ids.map(id => ({ tarefaId: id, motivosAceitos: Array.isArray(aceitos[id]) ? aceitos[id].map(String) : [] }));
    const resultados = await transacao(tx => confirmar({
      conexao: tx, usuarioId: req.user.id, pedidos, observacao: String(observacao).slice(0, 1000),
      podeVerRestrito: Boolean(req.user.pode_marcar_restrito),
    }));
    const confirmadas = resultados.filter(r => r.ok).length;
    await auditar({
      usuarioId: req.user.id, acao: 'confirmar_verificacao_reprotocolo', entidade: 'tarefa',
      valorDepois: { confirmadas, recusadas: resultados.length - confirmadas, ids: resultados.filter(r => r.ok).map(r => r.tarefa_id), observacao: String(observacao).slice(0, 200) || null },
      ip: req._ip,
    });
    res.json({ ok: true, confirmadas, recusadas: resultados.length - confirmadas, resultados });
  });

  // POST /api/reprotocolo/verificacao/:tarefaId/oficial — confere UMA tarefa na fonte oficial PB/PE
  // e guarda o resumo (a verificação passa a usá-lo por 30 dias). Só sessão do AM.
  router.post('/verificacao/:tarefaId/oficial', apenasSessao, limitador, async (req, res) => {
    const { tarefaId } = req.params;
    if (!uuidValido(tarefaId)) return res.status(400).json({ ok: false, erro: 'ID de tarefa inválido.' });
    let conferencia;
    try {
      conferencia = await conferir(tarefaId, { podeVerRestrito: Boolean(req.user.pode_marcar_restrito), forcar: req.query.atualizar === '1' });
    } catch (err) {
      if (err instanceof ReferenciaEstadualError) return res.status(err.status).json({ ok: false, codigo: err.codigo, erro: err.message });
      if (err?.isAxiosError || err?.response) return res.status(502).json({ ok: false, codigo: 'fonte_oficial_indisponivel', erro: 'Não foi possível consultar a fonte oficial agora.' });
      throw err;
    }
    if (!conferencia) return res.status(404).json({ ok: false, erro: 'Tarefa não encontrada nas filas Re-protocolo/Novos ciclos.' });
    if (conferencia.status === 'sem_fonte_oficial' || conferencia.status === 'ente_nao_confirmado' || conferencia.status === 'periodo_sem_meses' || conferencia.status === 'periodo_todo_acima_5_anos' || conferencia.status === 'nao_consultavel') {
      return res.json({ ok: true, guardado: false, status: conferencia.status, mensagem: conferencia.mensagem ?? null });
    }
    const resumo = await transacao(tx => salvarOficial(tx, tarefaId, conferencia));
    await auditar({ usuarioId: req.user.id, acao: 'conferir_oficial_verificacao_reprotocolo', entidade: 'tarefa', entidadeId: tarefaId, valorDepois: { status: resumo.status }, ip: req._ip });
    res.json({ ok: true, guardado: true, status: resumo.status });
  });

  // PUT /api/reprotocolo/pasta-antiga/:clienteId — vincula a pasta antiga do cliente (só sessão do AM).
  router.put('/pasta-antiga/:clienteId', apenasSessao, async (req, res) => {
    const { clienteId } = req.params;
    const { drive_pasta_id: driveId, titulo = '', pai = null } = req.body || {};
    if (!uuidValido(clienteId)) return res.status(400).json({ ok: false, erro: 'ID de cliente inválido.' });
    if (!ID_DRIVE_RE.test(String(driveId ?? ''))) return res.status(400).json({ ok: false, erro: 'drive_pasta_id inválido.' });
    try {
      await transacao(tx => vincularPasta(tx, {
        clienteId, driveId: String(driveId), titulo: String(titulo).slice(0, 300), pai: pai ? String(pai).slice(0, 120) : null, usuarioId: req.user.id, origem: 'manual',
      }));
    } catch (err) {
      if (err?.code === '23503') return res.status(404).json({ ok: false, erro: 'Cliente não encontrado.' });
      throw err;
    }
    await auditar({ usuarioId: req.user.id, acao: 'vincular_pasta_antiga_reprotocolo', entidade: 'cliente', entidadeId: clienteId, valorDepois: { drive_pasta_id: driveId }, ip: req._ip });
    res.json({ ok: true });
  });

  return router;
}

export const reprotocoloRouter = criarReprotocoloRouter();
