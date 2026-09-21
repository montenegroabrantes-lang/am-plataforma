/**
 * Verifica ciclos recorrentes de teses com intervalo definido (ex: FGTS Remanescente a cada 25 meses).
 * A contagem parte do periodo_fim do último processo arquivado/concluído daquele produto para aquele cliente.
 * Se não houver processo anterior, usa vinculo_inicio do cliente como referência.
 * Chamado diariamente pelo cron job.
 */
import { db } from '../db/index.js';
import { somarDiasUteis } from '../utils/diasUteis.js';
import { vinculoUnicoAtivo } from '../utils/vinculos.js';
import { resolverDemanda } from '../utils/demandas.js';

export async function verificarCiclosRecorrentes() {
  const produtos = await db.query(
    `SELECT id, nome, intervalo_meses, cargos_elegiveis, orgaos_elegiveis,
            responsavel_reprotocolo_id, prazo_reprotocolo_dias_uteis
     FROM produtos WHERE ativo = true AND intervalo_meses IS NOT NULL AND intervalo_meses > 0`
  );

  if (produtos.length === 0) return { tarefas: 0 };

  let totalTarefas = 0;
  const hoje = new Date();

  for (const prod of produtos) {
    // Buscar todos os clientes vinculados a este produto. Vínculo ATIVO sempre entra; vínculo
    // ENCERRADO (vinculo_ativo=false) também entra quando há vinculo_fim registrado — o
    // período acumulado ANTES do desligamento continua sendo uma cobrança legítima, só deixa
    // de existir se já foi todo coberto por um processo anterior (checado abaixo). Antes,
    // vinculo_ativo=false bloqueava a elegibilidade inteira, mesmo com período pendente real.
    const vinculos = await db.query(
      `SELECT cp.id AS cliente_produto_id, cp.cliente_id,
              c.nome AS cliente_nome, c.cargo, c.orgao, c.vinculo_inicio, c.vinculo_fim,
              c.vinculo_ativo, c.polo_passivo
       FROM cliente_produtos cp
       JOIN clientes c ON c.id = cp.cliente_id
       WHERE cp.produto_id = $1 AND c.ativo IS NOT FALSE
         AND (c.vinculo_ativo = true OR (c.vinculo_ativo = false AND c.vinculo_fim IS NOT NULL))`,
      [prod.id]
    );

    for (const v of vinculos) {
      // Buscar o último processo deste produto para este cliente com periodo_fim definido
      const ultimoProcesso = await db.queryOne(
        `SELECT periodo_fim, status, master_responsavel_id FROM processos
         WHERE cliente_id = $1 AND produto_id = $2
         AND periodo_fim IS NOT NULL
         ORDER BY periodo_fim DESC LIMIT 1`,
        [v.cliente_id, prod.id]
      );

      // Início do período acumulado: mês seguinte ao fim do último processo; sem processo,
      // o próprio início do vínculo. A elegibilidade chega quando passam intervalo_meses.
      // Tudo em UTC: DATE chega como 'YYYY-MM-DD' e new Date() o interpreta como meia-noite UTC;
      // usar setters locais aqui deslocaria o dia conforme o TZ do servidor e quebraria o dedup.
      let cicloInicio = null;
      if (ultimoProcesso?.periodo_fim) {
        cicloInicio = new Date(ultimoProcesso.periodo_fim);
        cicloInicio.setUTCDate(1);
        cicloInicio.setUTCMonth(cicloInicio.getUTCMonth() + 1);
      } else if (v.vinculo_inicio) {
        cicloInicio = new Date(v.vinculo_inicio);
        cicloInicio.setUTCDate(1);
      } else {
        continue; // sem referência de data
      }
      const dataReferencia = new Date(cicloInicio);
      dataReferencia.setUTCMonth(dataReferencia.getUTCMonth() + prod.intervalo_meses - 1);
      if (dataReferencia > hoje) continue;

      // Vínculo já encerrado: o período acumulado só é uma cobrança real se COMEÇA antes (ou
      // no mesmo mês) do desligamento — se o último processo já cobriu até o desligamento ou
      // depois, não sobrou nenhum período novo pra cobrar. Corta aqui, não silenciosamente:
      // isso é "não há mais nada", diferente de "não sei se há" (que cai pra revisão humana
      // abaixo, nunca bloqueado).
      if (!v.vinculo_ativo && v.vinculo_fim) {
        const vinculoFim = new Date(v.vinculo_fim);
        if (cicloInicio > vinculoFim) continue;
      }

      // Já existe processo cobrindo este ciclo?
      const processoAberto = await db.queryOne(
        `SELECT id FROM processos
         WHERE cliente_id = $1 AND produto_id = $2
         AND status NOT IN ('arquivado')
         AND (periodo_fim IS NULL OR periodo_fim >= $3)`,
        [v.cliente_id, prod.id, cicloInicio]
      );
      if (processoAberto) continue;

      // Já existe tarefa de protocolo aberta, ou um ciclo com este mesmo início que foi
      // descartado pela equipe? Nos dois casos não recriamos — descartar tem que valer.
      const cicloInicioIso = cicloInicio.toISOString().slice(0, 10);
      const tarefaExistente = await db.queryOne(
        `SELECT id FROM tarefas
         WHERE cliente_produto_id = $1 AND tipo = 'protocolar'
           AND (status NOT IN ('concluida','cancelada') OR ciclo_inicio = $2::date)
         LIMIT 1`,
        [v.cliente_produto_id, cicloInicioIso]
      );
      if (tarefaExistente) continue;

      // Continuação de um processo anterior (re-protocolo) com polo sem ambiguidade, um
      // responsável ativo E vínculo ainda ativo entram direto em Protocolar inicial — sem
      // passar por "Aceitar ciclo". Sem processo anterior (1ª elegibilidade), faltando
      // polo/responsável, ou vínculo já encerrado, cai como antes em "Novos ciclos" para
      // decisão humana — vínculo encerrado nunca bloqueia a tarefa (ela é criada do mesmo
      // jeito, ver acima), só nunca entra sozinho em Protocolar inicial sem alguém olhar,
      // já que pode ser o último período antes de encerrar o relacionamento com o cliente.
      let subtipo = 'ciclo', descricaoPrefixo = 'Novo ciclo', atribuidoA = null, prazoData = null, cicloVinculoId = null;
      if (ultimoProcesso?.periodo_fim && v.vinculo_ativo) {
        const vinculoAuto = await vinculoUnicoAtivo(v.cliente_id);
        const poloResolvido = vinculoAuto?.polo_passivo || v.polo_passivo || null;
        cicloVinculoId = vinculoAuto?.id || null;

        let responsavel = prod.responsavel_reprotocolo_id || ultimoProcesso.master_responsavel_id || null;
        if (responsavel) {
          const ativo = await db.queryOne(`SELECT id FROM usuarios WHERE id=$1 AND ativo=true`, [responsavel]);
          if (!ativo) responsavel = null;
        }

        if (poloResolvido && responsavel) {
          subtipo = 'ciclo_aceito';
          descricaoPrefixo = 'Re-protocolo';
          atribuidoA = responsavel;
          prazoData = somarDiasUteis(hoje, prod.prazo_reprotocolo_dias_uteis || 10);
        }
      }
      if (!v.vinculo_ativo) descricaoPrefixo += ' (vínculo encerrado — revisar período)';

      // Fase 4 — aqui, diferente do fluxo de fechamento (onboarding.js), o período de início
      // é real (o próprio início do ciclo acumulado), não NULL — a 1ª demanda com período de
      // verdade nasce por este caminho.
      const demandaId = await resolverDemanda({
        clienteId: v.cliente_id, produtoId: prod.id, clienteVinculoId: cicloVinculoId, periodoInicio: cicloInicioIso,
      });
      await db.execute(
        `INSERT INTO tarefas (cliente_produto_id, tipo, subtipo, descricao, urgencia, status, ciclo_inicio, atribuido_a, prazo_data, cliente_vinculo_id, demanda_id)
         VALUES ($1, 'protocolar', $2, $3, $4, 'pendente', $5::date, $6, $7, $8, $9)`,
        [v.cliente_produto_id, subtipo, `${descricaoPrefixo} — ${prod.nome} — ${v.cliente_nome}`,
         atribuidoA ? 'ALTO' : 'MEDIO', cicloInicioIso, atribuidoA, prazoData, cicloVinculoId, demandaId]
      );
      const fimTexto = !v.vinculo_ativo && v.vinculo_fim
        ? new Date(v.vinculo_fim).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
        : 'hoje';
      const periodoTexto = `${cicloInicio.toLocaleDateString('pt-BR', { month: '2-digit', year: 'numeric', timeZone: 'UTC' })} até ${fimTexto}`;

      console.log(`[Ciclos] Tarefa criada (${subtipo}): ${prod.nome} — ${v.cliente_nome} | ${periodoTexto}${atribuidoA ? ' | auto-aceito' : ''}`);
      totalTarefas++;
    }
  }

  return { tarefas: totalTarefas };
}
