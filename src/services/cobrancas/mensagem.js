// Cobrança ao cliente de despesa do processo paga por ele a um terceiro (hoje: o contador judicial,
// depois do pagamento da RPV/precatório). Texto no tom do escritório: acolhedor, direto, sem pressa.

export const TIPOS_COBRANCA = ['contador', 'perito', 'outro'];
export const ROTULO_TIPO = { contador: 'contador judicial', perito: 'perito', outro: 'despesa do processo' };

export const STATUS_COBRANCA = ['a_cobrar', 'cobrado', 'pago', 'cancelado'];

export function formatarReais(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 'R$ 0,00';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function primeiroNome(nome) {
  const p = String(nome || '').trim().split(/\s+/)[0] || '';
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : '';
}

/** Texto pronto para o WhatsApp. Sem beneficiário/chave Pix devolve o texto sem a parte do pagamento. */
export function montarMensagemCobranca({ clienteNome, tipo = 'contador', valor, beneficiarioNome, chavePix, numeroProcesso }) {
  const nome = primeiroNome(clienteNome);
  const saudacao = nome ? `Olá, ${nome}! Tudo bem?` : 'Olá! Tudo bem?';
  const processo = numeroProcesso ? ` do processo ${numeroProcesso}` : '';
  const rotulo = ROTULO_TIPO[tipo] || ROTULO_TIPO.outro;
  const linhas = [
    saudacao,
    '',
    `Aqui é do escritório Abrantes & Montenegro Advogados. Passando para saber se o valor da requisição${processo} já está disponível em sua conta.`,
    '',
    `Confirmado o crédito, falta apenas o pagamento do ${rotulo}, no valor de ${formatarReais(valor)}.`,
  ];
  if (beneficiarioNome || chavePix) {
    linhas.push('');
    linhas.push('Pagamento via Pix:');
    if (beneficiarioNome) linhas.push(`Favorecido: ${beneficiarioNome}`);
    if (chavePix) linhas.push(`Chave: ${chavePix}`);
  }
  linhas.push('', 'Assim que fizer, pode nos enviar o comprovante por aqui? Qualquer dúvida, estamos à disposição.');
  return linhas.join('\n');
}

/** Pronta para cobrar = o dinheiro já saiu (RPV paga ou precatório disponibilizado). */
export function prontaParaCobrar({ status_rpv, status_precatorio }) {
  return status_rpv === 'paga' || status_precatorio === 'pagamento_disponibilizado';
}

/** Valor de cobrança aceito: positivo, até 2 casas, teto de R$ 1 milhão (evita ×100 por vírgula). */
export function valorCobrancaValido(v) {
  const n = typeof v === 'string' ? Number(v.replace(/\./g, '').replace(',', '.')) : Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) return null;
  return Math.round(n * 100) / 100;
}
