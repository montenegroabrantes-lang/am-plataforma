// Tela "Hoje" (versão 2.0, etapa 4): o que pede ação agora, em quatro grupos. Tudo puro, só leitura.
//   prazo      → tarefas de prazo abertas (nascem das publicações; o controle fino é a agenda do Google)
//   assinar    → folha "Assinaturas" da última varredura do PJe
//   protocolar → tarefas de protocolo abertas
//   decisao    → sentenças, decisões e acórdãos publicados nos últimos dias e ainda não lidos
export const POR_GRUPO = 8;          // itens de cada grupo na fila
export const DIAS_PRAZO_PROXIMO = 7; // prazo "vencendo" = até este tanto de dias
export const DIAS_DECISAO = 7;       // janela das decisões novas

const DIA = 86_400_000;
const soData = v => { const d = v ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) : null; };
const dias = (de, ate) => Math.round((ate - de) / DIA);
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

function textoPrazo(d) {
  if (d === null) return 'sem data';
  if (d < 0) return `venceu há ${plural(-d, 'dia', 'dias')}`;
  if (d === 0) return 'vence hoje';
  if (d === 1) return 'vence amanhã';
  return `vence em ${d} dias`;
}

export function tipoDecisao(tipoDocumento) {
  const t = String(tipoDocumento || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  if (t.includes('SENTENCA')) return 'Sentença';
  if (t.includes('ACORDAO')) return 'Acórdão';
  if (/^DECISAO/.test(t)) return 'Decisão';
  return null;
}

export function montarHoje({ tarefas = [], assinaturas = [], publicacoes = [], agora = new Date() }) {
  const hoje = soData(agora);

  const prazos = tarefas.filter(t => t.tipo === 'prazo').map(t => {
    const data = soData(t.prazo_data);
    const d = data ? dias(hoje, data) : null;
    return { grupo: 'prazo', id: `tarefa:${t.id}`, titulo: t.descricao || 'Prazo', sub: [t.cliente_nome, t.processo_numero].filter(Boolean).join(' · ') || null,
      quando: textoPrazo(d), atrasado: d !== null && d < 0, responsavel: t.responsavel_nome || null, acao: 'Abrir tarefa',
      link: `/tarefas?busca=${encodeURIComponent(t.processo_numero || t.cliente_nome || '')}`, _ordem: d ?? 1e6 };
  }).sort((a, b) => a._ordem - b._ordem);
  const vencidos = prazos.filter(p => p.atrasado).length;
  const proximos = prazos.filter(p => !p.atrasado && p._ordem <= DIAS_PRAZO_PROXIMO).length;

  const protocolos = tarefas.filter(t => t.tipo === 'protocolar').map(t => {
    const criada = soData(t.criado_em);
    const parado = criada ? dias(criada, hoje) : null;
    const noDrive = Boolean(t.drive_protocolo_detectado_em);
    return { grupo: 'protocolar', id: `tarefa:${t.id}`, titulo: noDrive ? 'Informar o número do processo (já protocolado no Drive)' : (t.descricao || 'Protocolar ação'),
      sub: t.cliente_nome || null, quando: parado === null ? 'sem data' : parado === 0 ? 'criada hoje' : `aberta há ${plural(parado, 'dia', 'dias')}`,
      atrasado: false, responsavel: t.responsavel_nome || null, acao: noDrive ? 'Informar número' : 'Protocolar',
      link: `/tarefas?tipo=protocolar&busca=${encodeURIComponent(t.cliente_nome || '')}`, _ordem: (noDrive ? -1e6 : 0) + (parado ?? 0) };
  }).sort((a, b) => a._ordem - b._ordem);
  const noDrive = protocolos.filter(p => p._ordem < -1e5).length;

  const assinar = assinaturas.map(a => ({ grupo: 'assinar', id: `despacho:${a.id}`, titulo: a.observacao || 'Peça pronta para assinatura',
    sub: [a.cliente_nome, a.processo_numero].filter(Boolean).join(' · ') || null, quando: a.local || 'PJe', atrasado: false, responsavel: null,
    acao: 'Ver em Despachos', link: '/despachos' }));

  const decisoes = publicacoes.map(p => ({ p, tipo: tipoDecisao(p.tipo_documento) })).filter(x => x.tipo).map(({ p, tipo }) => {
    const data = soData(p.data_disponibilizacao || p.criado_em);
    const d = data ? dias(data, hoje) : null;
    return { grupo: 'decisao', id: `publicacao:${p.id}`, titulo: `${tipo} publicada`, sub: [p.cliente_nome, p.numero_processo].filter(Boolean).join(' · ') || null,
      quando: d === null ? 'sem data' : d <= 0 ? 'hoje' : d === 1 ? 'ontem' : `há ${d} dias`, atrasado: false, responsavel: null, acao: 'Abrir publicação',
      link: '/publicacoes', _ordem: d ?? 1e6 };
  }).sort((a, b) => a._ordem - b._ordem);

  const limpar = lista => lista.slice(0, POR_GRUPO).map(({ _ordem, ...item }) => item);
  return {
    resumo: [
      { chave: 'prazo', nome: 'Prazos', total: prazos.length, alerta: vencidos > 0,
        nota: vencidos ? `${plural(vencidos, 'vencido', 'vencidos')}${proximos ? ` · ${proximos} em ${DIAS_PRAZO_PROXIMO} dias` : ''}` : proximos ? `${proximos} em ${DIAS_PRAZO_PROXIMO} dias` : 'nenhum vencendo' },
      { chave: 'assinar', nome: 'Para assinar', total: assinar.length, alerta: false, nota: assinar.length ? 'prontos no PJe' : 'nada na última varredura' },
      { chave: 'protocolar', nome: 'Para protocolar', total: protocolos.length, alerta: noDrive > 0, nota: noDrive ? `${noDrive} já no Drive, falta o número` : 'tarefas abertas' },
      { chave: 'decisao', nome: 'Decisões novas', total: decisoes.length, alerta: false, nota: `não lidas, últimos ${DIAS_DECISAO} dias` },
    ],
    fila: [...limpar(prazos), ...limpar(assinar), ...limpar(protocolos), ...limpar(decisoes)],
  };
}
