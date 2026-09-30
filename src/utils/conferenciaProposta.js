// Conferência da proposta antes de ela chegar ao cliente (JN-01 e JN-02, Onda 1, 30/09/2026).
//
// JN-01 — o vínculo criado na aba Estimativas nunca levava numMeses (nem mesesFim, quando o
// vínculo está ativo), e o PDF da Camila imprime "Período: 01/2021 a  (undefined meses…".
// Aqui o período é completado com a MESMA regra de calcularPeriodoExibicao da Camila
// (camila/pre-proposta.js): fim vazio = mês atual e no máximo 60 meses de análise.
//
// JN-02 — 4 propostas com erro de vírgula já foram entregues (≈ R$ 1,2 milhão, duas de ≈ R$ 12).
// DN-2 (aprovada em 30/09/2026): recusar valor fora de 0,2 a 5 vezes a referência (sugestão da
// Camila, referência oficial ou valor já apresentado) ou acima de R$ 100 mil, salvo confirmação
// explícita do operador. Com referência ausente só vale o teto.

export const MAX_MESES_ANALISE = 60;
export const FATOR_FAIXA = 5; // faixa = de 1/5 (0,2×) a 5× a referência
export const TETO_ABSOLUTO = 100_000;

const PERIODO_RE = /^(0[1-9]|1[0-2])\/((?:19|20)\d{2})$/;

// Mesma leitura que a Camila faz do "valor final" (camila/valor-brasileiro.js): ponto é milhar,
// vírgula é decimal, número JSON passa direto. Devolve 0 quando não dá pra ler.
export function parseValorBR(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  let texto = String(valor ?? '').trim().replace(/R\$/gi, '').replace(/\s/g, '');
  if (!texto) return 0;
  if (texto.includes(',')) texto = texto.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(texto)) texto = texto.replace(/\./g, '');
  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : 0;
}

// Número > 0 ou null (colunas NUMERIC do Postgres chegam como string).
export function numeroPositivo(valor) {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// 'MM/AAAA' do mês atual em Brasília — o servidor roda em UTC e, nas últimas 3 horas do último
// dia do mês, o mês "UTC" já seria o seguinte.
export function mesAtual(agora = new Date()) {
  const partes = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', month: '2-digit', year: 'numeric' })
    .formatToParts(agora);
  const mes = partes.find(p => p.type === 'month').value;
  const ano = partes.find(p => p.type === 'year').value;
  return `${mes}/${ano}`;
}

const indiceMes = mmaaaa => {
  const [mes, ano] = mmaaaa.split('/').map(Number);
  return ano * 12 + mes;
};

// Completa cada vínculo com mesesFim (mês atual quando vazio) e numMeses (máx. 60) e barra o
// período que não esteja em MM/AAAA. Devolve { ok: true, vinculos } ou { ok: false, erro }.
export function completarVinculos(vinculos, agora = new Date()) {
  const atual = mesAtual(agora);
  const completos = [];
  for (const [i, v] of (vinculos || []).entries()) {
    const rotulo = vinculos.length > 1 ? `Vínculo ${i + 1}` : 'Vínculo';
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, erro: `${rotulo}: dados inválidos.` };
    const inicio = String(v.mesesInicio ?? '').trim();
    const fim = String(v.mesesFim ?? '').trim() || atual;
    if (!PERIODO_RE.test(inicio)) return { ok: false, erro: `${rotulo}: informe o início do período no formato MM/AAAA.` };
    if (!PERIODO_RE.test(fim)) return { ok: false, erro: `${rotulo}: o fim do período deve estar no formato MM/AAAA (ou vazio, se o vínculo está ativo).` };
    if (indiceMes(fim) < indiceMes(inicio)) return { ok: false, erro: `${rotulo}: o fim do período é anterior ao início.` };
    if (indiceMes(fim) > indiceMes(atual)) return { ok: false, erro: `${rotulo}: o fim do período é posterior ao mês atual; deixe vazio se o vínculo está ativo.` };
    const meses = indiceMes(fim) - indiceMes(inicio) + 1;
    completos.push({ ...v, mesesInicio: inicio, mesesFim: fim, numMeses: Math.min(meses, MAX_MESES_ANALISE) });
  }
  return { ok: true, vinculos: completos };
}

// Referência que a Camila já tinha da estimativa: o valor apresentado ao cliente e, na falta
// dele, a sugestão (valor_sugerido já vem nulo quando o candidato não é confiável).
export function referenciaDaEstimativa(estimativa) {
  return numeroPositivo(estimativa?.valor_aprovado) ?? numeroPositivo(estimativa?.valor_sugerido);
}

// Referência digitada na revisão: soma do "valor do vínculo" (o valor final pode somar vínculos).
export function referenciaDosVinculos(vinculos) {
  if (!Array.isArray(vinculos)) return null;
  const soma = vinculos.reduce((total, v) => total + parseValorBR(v?.valorEstimado), 0);
  return soma > 0 ? soma : null;
}

export function formatarBRL(valor) {
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ');
}

// Compara em centavos inteiros: nas bordas exatas (0,2× e 5×) não pode haver ruído de ponto
// flutuante — 5× a referência é permitido, um centavo a mais não.
export function avaliarFaixa({ valor, referencia }) {
  const centavos = Math.round(Number(valor) * 100);
  const ref = numeroPositivo(referencia);
  const refCentavos = ref === null ? null : Math.round(ref * 100);
  let razao = null;
  if (refCentavos !== null && centavos * FATOR_FAIXA < refCentavos) razao = 'abaixo_da_faixa';
  else if (refCentavos !== null && centavos > refCentavos * FATOR_FAIXA) razao = 'acima_da_faixa';
  else if (centavos > TETO_ABSOLUTO * 100) razao = 'acima_do_teto';
  return {
    foraDaFaixa: razao !== null,
    razao,
    valor: Number(valor),
    referencia: ref,
    minimo: refCentavos === null ? null : refCentavos / FATOR_FAIXA / 100,
    maximo: refCentavos === null ? null : (refCentavos * FATOR_FAIXA) / 100,
    teto: TETO_ABSOLUTO,
  };
}

// Corpo do 409 que a tela lê: `motivo` é o código estável (a tela confirma e reenvia com
// valor_fora_da_faixa_ciente: true) e `erro` é o texto que o frontend antigo já mostra.
export function respostaForaDaFaixa(avaliacao) {
  const valor = formatarBRL(avaliacao.valor);
  const erro = avaliacao.razao === 'acima_do_teto'
    ? `O valor informado (${valor}) passa de ${formatarBRL(avaliacao.teto)}. Confira a vírgula e os zeros; se estiver certo, confirme.`
    : `O valor informado (${valor}) foge do esperado: a referência é ${formatarBRL(avaliacao.referencia)} e o normal fica entre ${formatarBRL(avaliacao.minimo)} e ${formatarBRL(avaliacao.maximo)} (de 0,2 a 5 vezes). Confira a vírgula e os zeros; se estiver certo, confirme.`;
  return {
    ok: false,
    motivo: 'valor_fora_da_faixa',
    razao: avaliacao.razao,
    erro,
    valor: avaliacao.valor,
    referencia: avaliacao.referencia,
    minimo: avaliacao.minimo,
    maximo: avaliacao.maximo,
    teto: avaliacao.teto,
  };
}
