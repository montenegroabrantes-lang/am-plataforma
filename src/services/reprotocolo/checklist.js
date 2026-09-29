// Checklist de documentos do re-protocolo, a partir do que existe na pasta antiga do Drive.
//
// Regra: a IDENTIDADE e a PROCURAÇÃO anteriores são reaproveitadas (decisão do escritório em
// 29/09/2026; na prática da equipe a procuração costumava ser refeita a cada re-protocolo, e o STJ
// (Tema 1198) admite que o juiz exija procuração atualizada diante de indício de litigância abusiva —
// por isso a data da procuração aparece no relatório). Comprovante de vínculo e contracheques/fichas
// do período novo são sempre novos, e a inicial anterior serve de FONTE DE DADOS (qualificação,
// endereço, comarca), não de peça a reaproveitar. Comprovante de residência: a regra por juízo ainda não foi
// definida (sai das emendas à inicial), então fica "regra pendente" — nunca uma exigência inventada.
//
// `documentos`: inventário da pasta por tipo ({ identidade: { qtd, ultima, exemplo }, ... }).

export const ACAO = {
  REAPROVEITAR: 'reaproveitar',
  PEDIR_AO_CLIENTE: 'pedir_ao_cliente',
  GERAR_NOVA: 'gerar_nova',
  OBTER_NOVO: 'obter_novo',
  FONTE_DE_DADOS: 'fonte_de_dados',
  SEM_FONTE: 'sem_fonte',
  REGRA_PENDENTE: 'regra_pendente',
  CONFERIR_VALIDADE: 'conferir_validade',
};

const ultima = (docs, tipo) => docs?.[tipo]?.ultima ?? null;
const tem = (docs, tipo) => Boolean(docs?.[tipo]?.qtd);

export function montarChecklist({ documentos = null, ente = null, fonteOficial = null } = {}) {
  const sem = !documentos;
  const itens = [
    tem(documentos, 'identidade')
      ? { tipo: 'identidade', acao: ACAO.REAPROVEITAR, ultima: ultima(documentos, 'identidade'), obs: 'Copiar da pasta antiga (sem mover).' }
      : { tipo: 'identidade', acao: ACAO.PEDIR_AO_CLIENTE, obs: sem ? 'Pasta antiga ainda não localizada.' : 'Não há identidade na pasta antiga.' },
    tem(documentos, 'procuracao')
      ? { tipo: 'procuracao', acao: ACAO.REAPROVEITAR, ultima: ultima(documentos, 'procuracao'), obs: 'Procuração anterior reaproveitada (decisão do escritório); o juiz pode exigir uma atualizada se houver indício de litigância abusiva (STJ, Tema 1198).' }
      : { tipo: 'procuracao', acao: ACAO.PEDIR_AO_CLIENTE, obs: sem ? 'Pasta antiga ainda não localizada.' : 'Não há procuração na pasta antiga: colher uma nova.' },
    tem(documentos, 'inicial')
      ? { tipo: 'inicial_anterior', acao: ACAO.FONTE_DE_DADOS, ultima: ultima(documentos, 'inicial'), obs: 'Fonte de qualificação, endereço, comarca e fatos; a fundamentação vem do modelo aprovado atual.' }
      : { tipo: 'inicial_anterior', acao: ACAO.SEM_FONTE, obs: sem ? 'Pasta antiga ainda não localizada.' : 'Sem inicial anterior na pasta: os dados de qualificação precisam vir do cadastro ou do cliente.' },
    { tipo: 'vinculo', acao: ACAO.OBTER_NOVO, ultima: ultima(documentos, 'vinculo'), obs: 'Comprovante de vínculo atualizado para o período novo.' },
    { tipo: 'contracheque', acao: ACAO.OBTER_NOVO, ultima: ultima(documentos, 'contracheque'),
      obs: fonteOficial ? `Contracheques/fichas do período novo (${fonteOficial}: dá para puxar do portal oficial).` : 'Contracheques/fichas do período novo (município: obter com o cliente ou no portal do município).' },
    tem(documentos, 'residencia')
      ? { tipo: 'residencia', acao: ACAO.CONFERIR_VALIDADE, ultima: ultima(documentos, 'residencia'), obs: 'Existe na pasta antiga; a regra de validade por juízo ainda não foi definida.' }
      : { tipo: 'residencia', acao: ACAO.REGRA_PENDENTE, obs: 'Exigência por juízo ainda não definida (vem das emendas à inicial).' },
  ];
  return {
    ente,
    itens,
    reaproveita: itens.filter(i => i.acao === ACAO.REAPROVEITAR).map(i => i.tipo),
    novos: itens.filter(i => [ACAO.GERAR_NOVA, ACAO.OBTER_NOVO].includes(i.acao)).map(i => i.tipo),
    faltando: itens.filter(i => [ACAO.PEDIR_AO_CLIENTE, ACAO.SEM_FONTE].includes(i.acao)).map(i => i.tipo),
    pendencias_de_regra: itens.filter(i => i.acao === ACAO.REGRA_PENDENTE || i.acao === ACAO.CONFERIR_VALIDADE).map(i => i.tipo),
  };
}
