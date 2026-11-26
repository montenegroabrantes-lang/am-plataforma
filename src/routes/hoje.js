// /api/hoje — tela inicial da versão 2.0 (etapa 4). O GET é só leitura: junta o que pede ação agora.
// A única escrita é POST /prazos/:id/cumprir: a pessoa confirma a baixa de um prazo que tem petição juntada.
// Master vê a fila do escritório (ou só a própria, com ?de=minhas). Júnior vê só as próprias tarefas,
// sem a folha de assinaturas, sem as decisões e sem os painéis de Comercial e Precatórios.
import { Router } from 'express';
import { db } from '../db/index.js';
import { ehMaster } from '../middleware/perfilJunior.js';
import { filtroVisibilidade } from '../utils/visibilidade.js';
import { montarHoje, DIAS_DECISAO } from '../services/hoje/fila.js';
import { pendencias } from '../services/precatorios/regras.js';
import { avaliarTarefas } from '../services/prazos/baixa.js';
import { registrarAuditoria } from '../middleware/auditoria.js';
import { uuidValido } from '../utils/validacao.js';
import { usuarioVeVisibilidade } from '../utils/visibilidade.js';
import { deletarEventoCalendar } from '../services/calendar/index.js';

export function criarHojeRouter({ banco = db, agora = () => new Date(), auditar = registrarAuditoria, apagarEvento = deletarEventoCalendar } = {}) {
  const router = Router();

  router.get('/', async (req, res) => {
    const master = ehMaster(req);
    const soMinhas = !master || req.query.de === 'minhas';
    const vis = filtroVisibilidade(req.user, 'p');

    const tarefas = await banco.query(
      `SELECT t.id, t.tipo, t.descricao, t.prazo_data, t.criado_em, t.drive_protocolo_detectado_em, t.processo_id,
              COALESCE(pub.data_disponibilizacao, t.criado_em::date) AS inicio,
              p.numero AS processo_numero, c.nome AS cliente_nome, u.nome AS responsavel_nome
         FROM tarefas t
         LEFT JOIN processos p ON p.id = t.processo_id
         LEFT JOIN clientes c ON c.id = COALESCE(t.cliente_id, p.cliente_id)
         LEFT JOIN usuarios u ON u.id = t.atribuido_a
         LEFT JOIN publicacoes pub ON pub.id = t.publicacao_id
        WHERE t.status = 'pendente' AND t.tipo IN ('prazo','protocolar')
          AND (t.processo_id IS NULL OR (p.id IS NOT NULL ${vis}))
          ${soMinhas ? 'AND t.atribuido_a = $1' : ''}`,
      soMinhas ? [req.user.id] : []);

    // Prazos com petição juntada depois da publicação ganham a sugestão de baixa (só leitura).
    const avaliacoes = await avaliarTarefas({ banco, tarefas: tarefas.filter(t => t.tipo === 'prazo'), hoje: agora() });

    let assinaturas = [], publicacoes = [], comercial = null, precatorios = null;
    if (master) {
      assinaturas = await banco.query(
        `SELECT i.id, i.observacao, i.local, p.numero AS processo_numero, c.nome AS cliente_nome
           FROM despachos_itens i
           LEFT JOIN processos p ON p.id = i.processo_id
           LEFT JOIN clientes c ON c.id = p.cliente_id
          WHERE i.folha = 'assinaturas'
            AND i.varredura_id = (SELECT id FROM despachos_varreduras ORDER BY criado_em DESC LIMIT 1)
            AND (i.processo_id IS NULL OR (p.id IS NOT NULL ${vis}))`);
      publicacoes = await banco.query(
        `SELECT pb.id, pb.tipo_documento, pb.numero_processo, pb.data_disponibilizacao, pb.criado_em, c.nome AS cliente_nome
           FROM publicacoes pb
           LEFT JOIN processos p ON p.id = pb.processo_id
           LEFT JOIN clientes c ON c.id = p.cliente_id
          WHERE pb.lido = false AND pb.cancelada = false AND pb.criado_em > NOW() - INTERVAL '${DIAS_DECISAO} days'
            AND (pb.processo_id IS NULL OR (p.id IS NOT NULL ${vis}))`);
      const parados = await banco.query(
        `SELECT status, COUNT(*)::int AS total, ROUND(AVG(EXTRACT(EPOCH FROM NOW() - COALESCE(fechado_em, criado_em)) / 86400))::int AS dias_medio
           FROM onboardings_contrato WHERE status IN ('cadastro_pendente','protocolo_pendente') GROUP BY status`);
      const de = s => parados.find(x => x.status === s) || { total: 0, dias_medio: null };
      comercial = { cadastro: de('cadastro_pendente'), protocolo: de('protocolo_pendente') };
      const lista = await banco.query(
        `SELECT etapa, exercicio, regime_especial, habilitacao_ramon, habilitacao_luciano, processo_origem_id FROM precatorios`);
      const ano = agora().getFullYear();
      const conta = tipo => lista.filter(p => pendencias(p, ano).some(d => d.tipo === tipo)).length;
      precatorios = { total: lista.length, habilitacao: conta('habilitacao'), habilitacao_conferir: conta('habilitacao_conferir'),
        sem_decisao: conta('sem_decisao'), exercicio_vencido: conta('exercicio_vencido'), sem_origem: conta('origem') };
    }

    res.json({ ok: true, escopo: soMinhas ? 'minhas' : 'todas', pode_ver_todas: master,
      ...montarHoje({ tarefas, assinaturas, publicacoes, agora: agora(), avaliacoes }), comercial, precatorios });
  });

  // Confirma a baixa de UM prazo que tem petição juntada depois da publicação. Master (respeitando o
  // sigilo do processo) ou o Júnior dono da tarefa. Sem petição juntada a baixa continua na tela Tarefas.
  router.post('/prazos/:id/cumprir', async (req, res) => {
    if (!uuidValido(req.params.id)) return res.status(400).json({ ok: false, erro: 'Tarefa inválida.' });
    const t = await banco.queryOne(
      `SELECT t.id, t.tipo, t.status, t.descricao, t.prazo_data, t.processo_id, t.atribuido_a, t.calendar_event_id,
              p.visibilidade, COALESCE(pub.data_disponibilizacao, t.criado_em::date) AS inicio
         FROM tarefas t
         LEFT JOIN processos p ON p.id = t.processo_id
         LEFT JOIN publicacoes pub ON pub.id = t.publicacao_id
        WHERE t.id = $1`, [req.params.id]);
    const podeVer = t && (ehMaster(req) ? usuarioVeVisibilidade(req.user, t.visibilidade) : t.atribuido_a === req.user.id);
    if (!podeVer) return res.status(404).json({ ok: false, erro: 'Prazo não encontrado.' });
    if (t.tipo !== 'prazo') return res.status(409).json({ ok: false, erro: 'Esta tarefa não é um prazo.' });
    if (t.status !== 'pendente') return res.status(409).json({ ok: false, erro: `O prazo já está ${t.status}.` });

    const avaliacao = (await avaliarTarefas({ banco, tarefas: [t], hoje: agora() })).get(t.id);
    if (avaliacao.acao !== 'sugerir') {
      return res.status(409).json({ ok: false, erro: 'Não há petição juntada depois da publicação. Dê a baixa pela tela Tarefas.' });
    }
    const nota = `Cumprido: ${avaliacao.texto.toLowerCase()}; confirmado por ${req.user.nome || 'usuário'} na tela Hoje.`;
    const r = await banco.execute(
      `UPDATE tarefas SET status = 'concluida', concluida_em = NOW(),
              observacao = CASE WHEN COALESCE(observacao, '') = '' THEN $2 ELSE observacao || E'\n' || $2 END
        WHERE id = $1 AND status = 'pendente'`, [t.id, nota]);
    if (r?.rowCount === 0) return res.status(409).json({ ok: false, erro: 'O prazo mudou de situação; atualize a tela.' });
    // Mesmo comportamento das outras baixas feitas por pessoa: o evento sai da agenda do Google.
    if (t.calendar_event_id) Promise.resolve(apagarEvento(t.calendar_event_id)).catch(() => {});
    await auditar({ usuarioId: req.user.id, acao: 'cumprir_prazo', entidade: 'tarefa', entidadeId: t.id,
      valorAntes: { status: 'pendente' }, valorDepois: { status: 'concluida', origem: 'hoje', evidencia: avaliacao.texto }, ip: req._ip });
    res.json({ ok: true, tarefa_id: t.id, descricao: t.descricao });
  });

  return router;
}

export const hojeRouter = criarHojeRouter();
