import { db } from '../db/index.js';
import { enviarAlerta } from '../services/digisac/index.js';
import { ehDiaUtil, hojeEscritorio, nomeDoDia, proximoDiaUtil } from '../utils/feriadosNacionais.js';
import { idCurto } from '../utils/mascarar.js';
import { montarMensagemVespera } from '../services/mensagensAlerta.js';

// Avisos de tarefas por WhatsApp (bom dia e véspera de prazo). Moveram-se de alertas.worker.js
// para cá só para poderem ser testados sem Redis: `banco`, `enviar` e `agora` são injetáveis.

// Lembrete diário (às 08h de Brasília, segunda a sexta — ver agendamentos.js). O cron já pula
// sábado e domingo; a checagem aqui pega o que o cron não sabe (feriado nacional) e protege
// contra um agendamento antigo que ainda esteja vivo no Redis.
export async function enviarLembretesDiarios({ banco = db, enviar = enviarAlerta, agora = new Date() } = {}) {
  const hoje = hojeEscritorio(agora);
  if (!ehDiaUtil(hoje)) {
    console.log(`[Alertas] Lembretes diários não enviados: ${hoje} (${nomeDoDia(hoje)}) não é dia útil.`);
    return { enviados: 0, total: 0, ignorado: true };
  }

  const masters = await banco.query(
    `SELECT id, nome, whatsapp FROM usuarios
     WHERE perfil = 'master' AND ativo = true AND whatsapp IS NOT NULL AND whatsapp <> ''`
  );

  let enviados = 0;
  for (const master of masters) {
    const tarefas = await banco.query(
      `SELECT t.urgencia, COUNT(*) AS total
       FROM tarefas t
       WHERE t.status NOT IN ('concluida','cancelada','bloqueada')
         AND COALESCE(t.precisa_triagem,false)=false
         AND t.validado_por = $1
       GROUP BY t.urgencia
       ORDER BY CASE t.urgencia WHEN 'CRITICO' THEN 1 WHEN 'ALTO' THEN 2 WHEN 'MEDIO' THEN 3 ELSE 4 END`,
      [master.id]
    );

    const obj     = Object.fromEntries(tarefas.map(r => [r.urgencia, Number(r.total)]));
    const critico = obj.CRITICO || 0;
    const alto    = obj.ALTO    || 0;
    const medio   = obj.MEDIO   || 0;

    if (critico + alto + medio === 0) continue;

    const linhas = [];
    if (critico > 0) linhas.push(`🔴 ${critico} Crítica${critico > 1 ? 's' : ''}`);
    if (alto    > 0) linhas.push(`🟠 ${alto} Alta${alto > 1 ? 's' : ''}`);
    if (medio   > 0) linhas.push(`🟡 ${medio} Média${medio > 1 ? 's' : ''}`);

    const msg =
      `📋 *Bom dia, ${master.nome.split(' ')[0]}!*\n\n` +
      `Resumo de tarefas pendentes:\n${linhas.join('\n')}\n\n` +
      `Acesse a plataforma para ver os detalhes.`;

    const r = await enviar(master.whatsapp, msg, { tipo: 'lembrete_diario', origem: 'lembretes_diarios', usuarioId: master.id });
    if (r.ok) enviados++;
  }

  // Conta só o que o Digisac aceitou (R-05): antes o log dizia "enviados" mesmo com a falha engolida.
  console.log(`[Alertas] Lembretes diários enviados para ${enviados} de ${masters.length} master(s).`);
  return { enviados, total: masters.length, ignorado: false };
}

// Escalonamento de véspera — alerta diretamente o responsável (atribuído) por tarefas cujo
// prazo vence hoje ou até o PRÓXIMO DIA ÚTIL (na sexta, cobre sábado a segunda; antes, o job
// rodava aos domingos e pegava a segunda — sem isso, um prazo de segunda só seria avisado na
// própria segunda). Roda só em dia útil, 08h30 e 16h30 de Brasília.
//
// O texto sai de campos estruturados (services/mensagensAlerta.js): a `descricao` da tarefa, com o nome
// completo do cliente, não é mais lida (S-14 / A5-05). "Hoje" vem do relógio de Brasília,
// passado como parâmetro — o CURRENT_DATE do Postgres está em UTC.
export async function enviarEscalonamentoVespera({
  banco = db, enviar = enviarAlerta, agora = new Date(), baseUrl = process.env.FRONTEND_URL,
} = {}) {
  const hoje = hojeEscritorio(agora);
  if (!ehDiaUtil(hoje)) {
    console.log(`[Alertas] Véspera de prazo não enviada: ${hoje} (${nomeDoDia(hoje)}) não é dia útil.`);
    return { enviados: 0, responsaveis: 0, tarefas: 0, ignorado: true };
  }
  const limite = proximoDiaUtil(hoje);

  const tarefas = await banco.query(
    `SELECT t.id, t.tipo, t.prazo_data,
            (t.prazo_data::date - $1::date) AS dias_restantes,
            p.numero AS processo_numero,
            ua.id AS atribuido_id, ua.nome AS atribuido_nome, ua.whatsapp AS atribuido_whatsapp,
            um.id AS master_id, um.nome AS master_nome, um.whatsapp AS master_whatsapp
     FROM tarefas t
     JOIN usuarios ua ON ua.id = t.atribuido_a AND ua.ativo = true
     LEFT JOIN usuarios um ON um.id = t.validado_por
     LEFT JOIN processos p ON p.id = t.processo_id
     WHERE t.status NOT IN ('concluida', 'cancelada', 'devolvida', 'bloqueada')
       AND COALESCE(t.precisa_triagem,false)=false
       AND t.prazo_data IS NOT NULL
       AND t.prazo_data::date BETWEEN $1::date AND $2::date`,
    [hoje, limite]
  );

  const porResponsavel = new Map();
  for (const t of tarefas) {
    if (!t.atribuido_whatsapp) continue;
    if (!porResponsavel.has(t.atribuido_id)) porResponsavel.set(t.atribuido_id, { nome: t.atribuido_nome, whatsapp: t.atribuido_whatsapp, tarefas: [] });
    porResponsavel.get(t.atribuido_id).tarefas.push(t);
  }

  let enviados = 0;
  for (const [usuarioId, { nome, whatsapp, tarefas: lista }] of porResponsavel) {
    const msg = montarMensagemVespera({ nome, tarefas: lista, baseUrl });
    // enviarAlerta nunca lança: a falha vem no resultado (R-05), então o .catch antigo era código morto.
    const r = await enviar(whatsapp, msg, { tipo: 'vespera', origem: 'escalonamento_vespera', usuarioId });
    if (r.ok) enviados++;
    else console.warn(`[Escalonamento] Alerta de véspera não entregue ao usuário ${idCurto(usuarioId)}:`, r.erro);
  }

  console.log(`[Alertas] Escalonamento de véspera enviado para ${enviados} de ${porResponsavel.size} responsável(is) — ${tarefas.length} tarefa(s) críticas.`);
  return { enviados, responsaveis: porResponsavel.size, tarefas: tarefas.length, ignorado: false };
}
