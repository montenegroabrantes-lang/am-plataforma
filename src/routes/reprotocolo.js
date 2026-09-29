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
import {
  reservarPacotes, montarPacote, cancelarPacote, listarPacotes, obterPacote, cadastrarModelo, listarModelos, STATUS_PACOTE, TIPOS_MODELO,
} from '../services/reprotocolo/pacote.js';
import { importarDados, LIMITE_IMPORTACAO } from '../services/reprotocolo/importacao.js';
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
  importar = importarDados,
  pacotes = { reservar: reservarPacotes, montar: montarPacote, cancelar: cancelarPacote, listar: listarPacotes, obter: obterPacote, cadastrarModelo, listarModelos },
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

  // ───────────── Pacote do re-protocolo (Fase 2) ─────────────

  // GET /api/reprotocolo/pacotes?status=&limite= — lista (leitura; também pelo conector com escopo).
  router.get('/pacotes', async (req, res) => {
    const status = req.query.status ?? '';
    if (status && !Object.values(STATUS_PACOTE).includes(status)) return res.status(400).json({ ok: false, erro: `status deve ser: ${Object.values(STATUS_PACOTE).join(', ')}.` });
    const limite = req.query.limite === undefined ? 200 : Number(req.query.limite);
    if (!Number.isInteger(limite) || limite < 1 || limite > 500) return res.status(400).json({ ok: false, erro: 'limite deve ser um inteiro de 1 a 500.' });
    const itens = await pacotes.listar({ status: status || null, limite });
    res.json({ ok: true, total: itens.length, itens });
  });

  // GET /api/reprotocolo/pacotes/:id — relatório do pacote (leitura).
  router.get('/pacotes/:id', async (req, res) => {
    if (!uuidValido(req.params.id)) return res.status(400).json({ ok: false, erro: 'ID de pacote inválido.' });
    const p = await pacotes.obter({ pacoteId: req.params.id });
    if (!p) return res.status(404).json({ ok: false, erro: 'Pacote não encontrado.' });
    res.json({ ok: true, pacote: p });
  });

  // POST /api/reprotocolo/pacotes/reservar { tarefa_ids } — só ciclos com confirmação válida (só sessão do AM).
  router.post('/pacotes/reservar', apenasSessao, async (req, res) => {
    const { tarefa_ids: ids } = req.body || {};
    if (!Array.isArray(ids) || !ids.length || ids.length > 50 || ids.some(id => !uuidValido(id))) {
      return res.status(400).json({ ok: false, erro: 'Informe de 1 a 50 tarefas válidas.' });
    }
    const resultados = await transacao(tx => pacotes.reservar({ conexao: tx, usuarioId: req.user.id, tarefaIds: ids, podeVerRestrito: Boolean(req.user.pode_marcar_restrito) }));
    const reservados = resultados.filter(r => r.ok);
    await auditar({ usuarioId: req.user.id, acao: 'reservar_pacote_reprotocolo', entidade: 'tarefa', valorDepois: { reservados: reservados.map(r => r.pacote_id), recusados: resultados.length - reservados.length }, ip: req._ip });
    res.json({ ok: true, reservados: reservados.length, recusados: resultados.length - reservados.length, resultados });
  });

  // POST /api/reprotocolo/pacotes/:id/montar { periodo_inicio_pedido? } — monta o relatório (não gera peças).
  router.post('/pacotes/:id/montar', apenasSessao, async (req, res) => {
    if (!uuidValido(req.params.id)) return res.status(400).json({ ok: false, erro: 'ID de pacote inválido.' });
    const inicio = req.body?.periodo_inicio_pedido ?? null;
    if (inicio !== null && !/^\d{4}-(0[1-9]|1[0-2])(-\d{2})?$/.test(String(inicio))) return res.status(400).json({ ok: false, erro: 'periodo_inicio_pedido deve ser AAAA-MM.' });
    const r = await transacao(tx => pacotes.montar({ conexao: tx, pacoteId: req.params.id, usuarioId: req.user.id, periodoInicioPedido: inicio, podeVerRestrito: Boolean(req.user.pode_marcar_restrito) }));
    if (!r.ok) return res.status(r.status || 400).json({ ok: false, erro: r.erro, motivo: r.motivo ?? null });
    await auditar({ usuarioId: req.user.id, acao: 'montar_pacote_reprotocolo', entidade: 'pacote_reprotocolo', entidadeId: req.params.id, valorDepois: { periodo: r.relatorio.periodo, pronto_para_gerar_pecas: r.relatorio.pronto_para_gerar_pecas }, ip: req._ip });
    res.json({ ok: true, pacote_id: r.pacote_id, relatorio: r.relatorio, texto: r.texto });
  });

  // POST /api/reprotocolo/pacotes/:id/cancelar { motivo } — libera a reserva (só sessão do AM).
  router.post('/pacotes/:id/cancelar', apenasSessao, async (req, res) => {
    if (!uuidValido(req.params.id)) return res.status(400).json({ ok: false, erro: 'ID de pacote inválido.' });
    const motivo = String(req.body?.motivo ?? '').trim();
    if (motivo.length < 5) return res.status(400).json({ ok: false, erro: 'Informe o motivo do cancelamento.' });
    const ok = await transacao(tx => pacotes.cancelar({ conexao: tx, pacoteId: req.params.id, usuarioId: req.user.id, motivo: motivo.slice(0, 500) }));
    if (!ok) return res.status(409).json({ ok: false, erro: 'Pacote não encontrado ou já não pode ser cancelado.' });
    await auditar({ usuarioId: req.user.id, acao: 'cancelar_pacote_reprotocolo', entidade: 'pacote_reprotocolo', entidadeId: req.params.id, valorDepois: { motivo: motivo.slice(0, 200) }, ip: req._ip });
    res.json({ ok: true });
  });

  // Modelos aprovados (inicial / procuração) por ente e tese — o advogado marca quais valem.
  router.get('/modelos', async (_req, res) => { res.json({ ok: true, itens: await pacotes.listarModelos({}) }); });
  router.put('/modelos', apenasSessao, async (req, res) => {
    const { ente, tese_id: teseId = null, tipo, drive_arquivo_id: driveId, titulo = '' } = req.body || {};
    if (!String(ente ?? '').trim() || String(ente).length > 120) return res.status(400).json({ ok: false, erro: 'Informe o ente.' });
    if (!TIPOS_MODELO.includes(tipo)) return res.status(400).json({ ok: false, erro: `tipo deve ser: ${TIPOS_MODELO.join(', ')}.` });
    if (teseId !== null && !uuidValido(teseId)) return res.status(400).json({ ok: false, erro: 'tese_id inválido.' });
    if (!ID_DRIVE_RE.test(String(driveId ?? ''))) return res.status(400).json({ ok: false, erro: 'drive_arquivo_id inválido.' });
    try {
      await transacao(tx => pacotes.cadastrarModelo({ conexao: tx, ente: String(ente).trim(), teseId, tipo, titulo: String(titulo).slice(0, 200), driveId: String(driveId), usuarioId: req.user.id }));
    } catch (err) {
      if (err?.code === '23503') return res.status(404).json({ ok: false, erro: 'Tese não encontrada.' });
      throw err;
    }
    await auditar({ usuarioId: req.user.id, acao: 'cadastrar_modelo_reprotocolo', entidade: 'modelo_reprotocolo', valorDepois: { ente, tese_id: teseId, tipo, drive_arquivo_id: driveId }, ip: req._ip });
    res.json({ ok: true });
  });

  // POST /api/reprotocolo/importar { pastas: [...], oficiais: [...], dry_run } — carrega pasta antiga, inventário de
  // documentos, duplicidade e conferência oficial apurados fora do AM. Só sessão do AM. dry_run é o padrão:
  // valida e conta sem gravar; só grava com dry_run=false explícito.
  router.post('/importar', apenasSessao, async (req, res) => {
    const { pastas = [], oficiais = [], dry_run: dryRun = true } = req.body || {};
    if (!Array.isArray(pastas) || !Array.isArray(oficiais) || pastas.length + oficiais.length === 0 || pastas.length > LIMITE_IMPORTACAO || oficiais.length > LIMITE_IMPORTACAO) {
      return res.status(400).json({ ok: false, erro: `Envie "pastas" e/ou "oficiais" (até ${LIMITE_IMPORTACAO} cada).` });
    }
    if (typeof dryRun !== 'boolean') return res.status(400).json({ ok: false, erro: 'dry_run deve ser true ou false.' });
    const resultado = await transacao(tx => importar({ conexao: tx, pastas, oficiais, usuarioId: req.user.id, dryRun }));
    await auditar({ usuarioId: req.user.id, acao: dryRun ? 'simular_importacao_reprotocolo' : 'importar_reprotocolo', entidade: 'tarefa',
      valorDepois: { pastas: resultado.pastas.gravadas || resultado.pastas.validas, oficiais: resultado.oficiais.gravadas || resultado.oficiais.validas, recusadas: resultado.pastas.recusadas.length + resultado.oficiais.recusadas.length, dry_run: dryRun }, ip: req._ip });
    res.json({ ok: true, ...resultado });
  });

  return router;
}

export const reprotocoloRouter = criarReprotocoloRouter();
