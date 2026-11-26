// Quadro Comercial (versão 2.0, etapa 3): um cartão por cliente, da proposta ao protocolo. Tudo puro.
// As colunas antes do contrato vêm do funil da Camila (lead.etapa); as de depois vêm do fechamento
// (onboardings_contrato) e das tarefas de protocolo. Nenhum dado novo é gravado: o quadro só lê.
//
// A ordem segue o que os dados registram hoje (proposta → documentos → contrato → ativação → cadastro →
// protocolo). O plano previa uma coluna "Inicial" (peça pronta), mas o sistema ainda não registra esse
// momento; o que existe é o aviso "protocolado no Drive, falta o número", mostrado dentro de Protocolo.

// PROVISÓRIO: limite de dias parado em cada coluna antes de o cartão ficar vermelho. O usuário ainda vai
// definir os números; até lá valem estes.
export const LIMITES_DIAS = { proposta: 5, documentos: 7, contrato: 3, ativar: 3, cadastro: 3, protocolo: 7 };

// Decisão do usuário (25/11/2026): proposta sem contato há mais de 30 dias sai do quadro. Ela continua em
// Estimativas, onde a Camila faz a retomada; o quadro só informa quantas ficaram de fora.
export const CORTE_PROPOSTA_DIAS = 30;

export const COLUNAS = [
  { id: 'proposta',   nome: 'Proposta enviada', origem: 'lead', etapas: ['proposta_enviada', 'entregue_manual'], passo: 'Acompanhar a resposta do cliente' },
  { id: 'documentos', nome: 'Documentos',       origem: 'lead', etapas: ['documentos_parciais', 'documentos_completos'], passo: 'Cobrar os documentos que faltam' },
  { id: 'contrato',   nome: 'Contrato',         origem: 'lead', etapas: ['aguardando_confirmacao_contrato', 'contrato_enviado', 'aguardando_assinatura'], passo: 'Acompanhar a assinatura' },
  { id: 'ativar',     nome: 'Assinado, ativar', origem: 'lead', etapas: ['assinado'], passo: 'Ativar o contrato' },
  { id: 'cadastro',   nome: 'Cadastro',         origem: 'fechamento', status: 'cadastro_pendente', passo: 'Concluir a ficha do cliente' },
  { id: 'protocolo',  nome: 'Protocolo',        origem: 'fechamento', status: 'protocolo_pendente', passo: 'Protocolar a ação' },
  { id: 'concluido',  nome: 'Concluído',        origem: 'fechamento', status: 'concluido', passo: null },
];
const COLUNA_DA_ETAPA = Object.fromEntries(COLUNAS.flatMap(c => (c.etapas || []).map(e => [e, c.id])));
const COLUNA_DO_STATUS = Object.fromEntries(COLUNAS.filter(c => c.status).map(c => [c.status, c.id]));
const NOME_ETAPA = {
  proposta_enviada: 'Proposta enviada', entregue_manual: 'Proposta enviada manualmente', documentos_parciais: 'Documentos parciais',
  documentos_completos: 'Documentos completos', aguardando_confirmacao_contrato: 'Preparar o contrato', contrato_enviado: 'Contrato enviado',
  aguardando_assinatura: 'Aguardando assinatura', assinado: 'Assinatura confirmada',
};

const DIA = 86_400_000;
const data = v => { const d = v ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d : null; };
const maisRecente = (...valores) => valores.map(data).filter(Boolean).sort((a, b) => b - a)[0] || null;
export const diasDesde = (desde, agora) => (desde ? Math.max(0, Math.floor((agora - desde) / DIA)) : null);

function fechar(cartao, agora, limites) {
  cartao.dias = diasDesde(cartao.desde, agora);
  const limite = limites[cartao.coluna];
  cartao.limite_dias = limite ?? null;
  cartao.atrasado = limite != null && cartao.dias != null && cartao.dias > limite;
  cartao.desde = cartao.desde ? cartao.desde.toISOString() : null;
  return cartao;
}

// Lead da Camila. Fora do quadro: quem ainda não recebeu proposta, quem já tem desfecho e quem já virou
// fechamento no sistema (esse aparece pelo fechamento, não pelo lead).
export function cartaoDoLead(lead, agora, limites = LIMITES_DIAS) {
  const coluna = COLUNA_DA_ETAPA[lead?.etapa];
  if (!coluna || !lead.contact_id) return null;
  if (lead.onboarding && lead.onboarding.status !== 'cancelado') return null;
  const passo = lead.etapa === 'documentos_completos' ? 'Preparar o contrato'
    : lead.aguardando_nossa_resposta ? 'Responder o cliente' : COLUNAS.find(c => c.id === coluna).passo;
  const cartao = fechar({
    id: `lead:${lead.contact_id}`, tipo: 'lead', coluna, nome: lead.nome || 'Sem nome', valor: lead.valor ?? null,
    detalhe: NOME_ETAPA[lead.etapa] || lead.etapa, responsavel: lead.atendente_nome || (lead.status_atendimento === 'com_camila' ? 'Camila' : null),
    proximo_passo: passo, link: `/estimativas?aba=leads&lead=${encodeURIComponent(lead.contact_id)}`,
    desde: maisRecente(lead.ultima_cliente_em, lead.ultima_equipe_em) || maisRecente(lead.proposta_enviada_em, lead.entregue_em, lead.criado_em),
  }, agora, limites);
  if (coluna === 'proposta' && cartao.dias != null && cartao.dias > CORTE_PROPOSTA_DIAS) return { fora_do_corte: true };
  return cartao;
}

// Fechamento (onboarding) com as tarefas de protocolo dele. `tarefas`: só as deste fechamento.
export function cartaoDoFechamento(o, tarefas, agora, limites = LIMITES_DIAS) {
  const coluna = COLUNA_DO_STATUS[o?.status];
  if (!coluna) return null;
  const protocolos = tarefas.filter(t => t.tipo === 'protocolar' && t.status !== 'cancelada');
  const abertas = protocolos.filter(t => t.status !== 'concluida');
  const noDrive = abertas.filter(t => t.drive_protocolo_detectado_em).length;
  const cadastro = tarefas.find(t => t.tipo === 'cadastro_cliente' && t.status === 'concluida');
  let detalhe = null, passo = COLUNAS.find(c => c.id === coluna).passo, desde = maisRecente(o.fechado_em) || data(o.criado_em);
  if (coluna === 'protocolo') {
    desde = data(cadastro?.concluida_em) || desde;
    detalhe = protocolos.length ? `${protocolos.length - abertas.length} de ${protocolos.length} ações protocoladas` : 'Sem tarefa de protocolo';
    if (noDrive) { detalhe += ` · ${noDrive} já no Drive, falta o número`; passo = 'Informar o número do processo'; }
  }
  if (coluna === 'concluido') desde = data(o.atualizado_em) || desde;
  return fechar({
    id: `fechamento:${o.id}`, tipo: 'fechamento', coluna, nome: o.cliente_nome || o.nome || 'Sem nome', valor: o.valor_fechado ?? null,
    detalhe, responsavel: coluna === 'cadastro' ? o.responsavel_cadastro_nome || null : o.responsavel_protocolo_nome || null,
    proximo_passo: passo,
    link: coluna === 'cadastro' ? `/onboardings/${o.id}` : coluna === 'protocolo' ? `/tarefas?onboarding_id=${o.id}&tipo=protocolar` : (o.cliente_nome ? `/clientes?busca=${encodeURIComponent(o.cliente_nome)}` : null),
    desde,
  }, agora, limites);
}

export function montarQuadro({ leads = [], fechamentos = [], tarefas = [], agora = new Date(), limites = LIMITES_DIAS }) {
  const tarefasPorFechamento = new Map();
  for (const t of tarefas) {
    if (!tarefasPorFechamento.has(t.onboarding_id)) tarefasPorFechamento.set(t.onboarding_id, []);
    tarefasPorFechamento.get(t.onboarding_id).push(t);
  }
  const cartoes = [
    ...leads.map(l => cartaoDoLead(l, agora, limites)),
    ...fechamentos.map(o => cartaoDoFechamento(o, tarefasPorFechamento.get(o.id) || [], agora, limites)),
  ].filter(Boolean);
  const propostasAntigas = cartoes.filter(k => k.fora_do_corte).length;
  return COLUNAS.map(c => {
    const itens = cartoes.filter(k => k.coluna === c.id).sort((a, b) => (b.dias ?? -1) - (a.dias ?? -1));
    return { id: c.id, nome: c.nome, origem: c.origem, limite_dias: limites[c.id] ?? null, total: itens.length, atrasados: itens.filter(k => k.atrasado).length,
      ...(c.id === 'proposta' ? { fora_do_quadro: propostasAntigas, corte_dias: CORTE_PROPOSTA_DIAS } : {}), cartoes: itens };
  });
}
