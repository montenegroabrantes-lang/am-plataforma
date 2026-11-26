// /api/comercial — quadro Comercial da versão 2.0 (etapa 3). Só leitura: junta o funil da Camila (antes do
// contrato) com os fechamentos e as tarefas de protocolo do sistema. Master only, como o funil de leads.
import { Router } from 'express';
import { db } from '../db/index.js';
import { apenasMaster } from '../middleware/auth.js';
import { camila } from '../services/camila.js';
import { montarQuadro, LIMITES_DIAS } from '../services/comercial/quadro.js';

const SQL_FECHAMENTOS = `
  SELECT o.id, o.status, o.nome, o.cliente_id, o.valor_fechado, o.fechado_em, o.criado_em, o.atualizado_em,
         c.nome AS cliente_nome, uc.nome AS responsavel_cadastro_nome, up.nome AS responsavel_protocolo_nome
    FROM onboardings_contrato o
    LEFT JOIN clientes c ON c.id = o.cliente_id
    LEFT JOIN usuarios uc ON uc.id = o.responsavel_cadastro_id
    LEFT JOIN usuarios up ON up.id = o.responsavel_protocolo_id
   WHERE o.status IN ('cadastro_pendente','protocolo_pendente')
      OR (o.status = 'concluido' AND o.atualizado_em > NOW() - INTERVAL '30 days')
   ORDER BY o.criado_em`;
const SQL_TAREFAS = `
  SELECT onboarding_id, tipo, status, concluida_em, drive_protocolo_detectado_em
    FROM tarefas
   WHERE onboarding_id = ANY($1::uuid[]) AND tipo IN ('protocolar','cadastro_cliente')`;

export function criarComercialRouter({ banco = db, clienteCamila = camila, agora = () => new Date() } = {}) {
  const router = Router();
  router.use(apenasMaster);

  router.get('/quadro', async (_req, res) => {
    const fechamentos = await banco.query(SQL_FECHAMENTOS);
    const tarefas = fechamentos.length ? await banco.query(SQL_TAREFAS, [fechamentos.map(f => f.id)]) : [];

    // A Camila fora do ar não derruba o quadro: as colunas do sistema continuam, e a tela avisa.
    let leads = [], leadsStatus = 'ok';
    const api = clienteCamila();
    if (!api) leadsStatus = 'nao_configurado';
    else {
      try {
        const { data } = await api.get('/api/funil-leads');
        leads = Array.isArray(data?.leads) ? data.leads : [];
        // O funil não sabe dos fechamentos do sistema: quem já foi ativado aqui sai das colunas de lead.
        const ativos = new Set((await banco.query(
          `SELECT camila_contact_id FROM onboardings_contrato WHERE status <> 'cancelado' AND camila_contact_id IS NOT NULL`)).map(o => String(o.camila_contact_id)));
        leads = leads.filter(l => !ativos.has(String(l.contact_id)));
      } catch { leadsStatus = 'indisponivel'; }
    }
    const colunas = montarQuadro({ leads, fechamentos, tarefas, agora: agora() });
    res.json({
      ok: true, colunas, leads_status: leadsStatus, limites_provisorios: true, limites_dias: LIMITES_DIAS,
      total: colunas.filter(c => c.id !== 'concluido').reduce((s, c) => s + c.total, 0),
      atrasados: colunas.reduce((s, c) => s + c.atrasados, 0),
    });
  });

  return router;
}

export const comercialRouter = criarComercialRouter();
