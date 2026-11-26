// Regras do módulo de Precatórios (versão 2.0). Tudo puro: sem banco, sem relógio escondido.
// O caminho é o do plano aprovado em 25/11/2026: da minuta no processo de origem ao repasse ao cliente.
export const ETAPAS = [
  { chave: 'minuta_juntada',            nome: 'Minuta juntada' },
  { chave: 'assinado',                  nome: 'Assinado' },
  { chave: 'remetido',                  nome: 'Remetido ao tribunal' },
  { chave: 'autuado',                   nome: 'Autuado no TJPB' },
  { chave: 'incluido_orcamento',        nome: 'Incluído no orçamento' },
  { chave: 'aguardando_pagamento',      nome: 'Aguardando pagamento' },
  { chave: 'pagamento_disponibilizado', nome: 'Pagamento disponibilizado' },
  { chave: 'alvara_levantado',          nome: 'Alvará levantado' },
  { chave: 'repasse_cliente',           nome: 'Repasse ao cliente' },
];
const CHAVES_ETAPA = ETAPAS.map(e => e.chave);
export const etapaValida = v => CHAVES_ETAPA.includes(v);
const posicao = etapa => CHAVES_ETAPA.indexOf(etapa);

export const PRIORIDADES = { nenhuma: 'Sem prioridade', idoso: 'Idoso', doenca_grave: 'Doença grave', deficiencia: 'Pessoa com deficiência' };
// pendente: ainda não pediu. protocolada: petição de habilitação juntada. habilitado: consta no cadastro do processo.
export const HABILITACOES = ['pendente', 'protocolada', 'habilitado'];
export const SOCIOS = [['habilitacao_ramon', 'Dr. Ramon'], ['habilitacao_luciano', 'Dr. Luciano']];

const CNJ = /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/;
export const numeroCnjValido = v => typeof v === 'string' && CNJ.test(v.trim());

// "1.234,56", "1234.56" ou número. Nulo quando vazio; `false` quando inválido.
export function lerValor(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(/[R$\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n < 1e12 ? Math.round(n * 100) / 100 : false;
}

// Agrupamento da tela: regime especial, ano do orçamento ou "sem decisão de inclusão".
export function grupoExercicio(p) {
  if (p.regime_especial) return { chave: 'regime_especial', nome: 'Regime especial' };
  if (p.exercicio) return { chave: String(p.exercicio), nome: `Exercício ${p.exercicio}` };
  return { chave: 'sem_decisao', nome: 'Sem decisão de inclusão' };
}

// O que a ficha cobra de quem acompanha. `anoAtual` vem de fora para a regra ser testável.
export function pendencias(p, anoAtual) {
  const itens = [];
  for (const [campo, nome] of SOCIOS) {
    if (p[campo] === 'pendente') itens.push({ tipo: 'habilitacao', texto: `Habilitar o ${nome} (petição e procuração para assinatura).` });
    if (p[campo] === 'protocolada') itens.push({ tipo: 'habilitacao_conferir', texto: `Habilitação do ${nome} protocolada: conferir se já consta no cadastro do processo.` });
  }
  const pago = posicao(p.etapa) >= posicao('pagamento_disponibilizado');
  if (!pago && !p.regime_especial && !p.exercicio && posicao(p.etapa) >= posicao('autuado')) {
    itens.push({ tipo: 'sem_decisao', texto: 'Sem decisão de inclusão em orçamento: acompanhar no TJPB.' });
  }
  if (!pago && p.exercicio && p.exercicio <= anoAtual) {
    itens.push({ tipo: 'exercicio_vencido', texto: `Exercício ${p.exercicio} vencido ou terminando: verificar se o pagamento foi disponibilizado.` });
  }
  if (p.etapa === 'pagamento_disponibilizado') itens.push({ tipo: 'alvara', texto: 'Pagamento disponibilizado: pedir o alvará.' });
  if (p.etapa === 'alvara_levantado') itens.push({ tipo: 'repasse', texto: 'Alvará levantado: fazer o repasse ao cliente.' });
  if (!p.processo_origem_id) itens.push({ tipo: 'origem', texto: 'Sem processo de origem vinculado.' });
  return itens;
}

// Cartões do topo: um por grupo, na ordem em que o pagamento chega.
export function resumoPorGrupo(lista) {
  const grupos = new Map();
  for (const p of lista) {
    const g = grupoExercicio(p);
    const atual = grupos.get(g.chave) || { ...g, total: 0, valor: 0 };
    atual.total += 1;
    atual.valor += Number(p.valor_requisitado) || 0;
    grupos.set(g.chave, atual);
  }
  const ordem = c => (c === 'sem_decisao' ? 1e5 : c === 'regime_especial' ? 1e5 + 1 : Number(c));
  return [...grupos.values()].sort((a, b) => ordem(a.chave) - ordem(b.chave));
}
