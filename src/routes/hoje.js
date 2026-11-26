// /api/hoje — tela inicial da versão 2.0 (etapa 4). Só leitura: junta o que pede ação agora.
// Master vê a fila do escritório (ou só a própria, com ?de=minhas). Júnior vê só as próprias tarefas,
// sem a folha de assinaturas, sem as decisões e sem os painéis de Comercial e Precatórios.
import { Router } from 'express';
import { db } from '../db/index.js';
import { ehMaster } from '../middleware/perfilJunior.js';
import { filtroVisibilidade } from '../utils/visibilidade.js';
import { montarHoje, DIAS_DECISAO } from '../services/hoje/fila.js';
import { pendencias } from '../services/precatorios/regras.js';

export function criarHojeRouter({ banco = db, agora = () => new Date() } = {}) {
  const router = Router();

  router.get('/', async (req, res) => {
    const master = ehMaster(req);
    const soMinhas = !master || req.query.de === 'minhas';
    const vis = filtroVisibilidade(req.user, 'p');

    const tarefas = await banco.query(
      `SELECT t.id, t.tipo, t.descricao, t.prazo_data, t.criado_em, t.drive_protocolo_detectado_em,
              p.numero AS processo_numero, c.nome AS cliente_nome, u.nome AS responsavel_nome
         FROM tarefas t
         LEFT JOIN processos p ON p.id = t.processo_id
         LEFT JOIN clientes c ON c.id = COALESCE(t.cliente_id, p.cliente_id)
         LEFT JOIN usuarios u ON u.id = t.atribuido_a
        WHERE t.status = 'pendente' AND t.tipo IN ('prazo','protocolar')
          AND (t.processo_id IS NULL OR (p.id IS NOT NULL ${vis}))
          ${soMinhas ? 'AND t.atribuido_a = $1' : ''}`,
      soMinhas ? [req.user.id] : []);

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
      ...montarHoje({ tarefas, assinaturas, publicacoes, agora: agora() }), comercial, precatorios });
  });

  return router;
}

export const hojeRouter = criarHojeRouter();
