// Calendário do escritório para os avisos automáticos (bom dia, véspera de prazo): dia da
// semana e feriado NACIONAL, sempre em America/Sao_Paulo e sem depender do fuso do servidor
// (o Railway roda em UTC; às 21h de Brasília o "hoje" do servidor já é amanhã — A4-08).
//
// Escopo de propósito mínimo (30/09/2026): sábado, domingo e feriados nacionais. Feriados
// ESTADUAIS (Paraíba), MUNICIPAIS (João Pessoa e demais) e os recessos/suspensões de cada
// tribunal NÃO estão aqui — ficam para o lote W, junto com um cadastro de feriados editável
// pela equipe. Os prazos processuais têm a lista própria em services/publicacoes/extrairPrazo.js.
//
// Além dos feriados de lei, entram três dias que o escritório e os tribunais não trabalham
// mas que a lei trata como ponto facultativo: segunda e terça de Carnaval e Corpus Christi.
// Para um aviso automático o custo de pular esses dias é zero; o de mandar é acordar o
// celular de quem está de folga.

export const FUSO_ESCRITORIO = 'America/Sao_Paulo';

const NOMES_DIA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

const dois = n => String(n).padStart(2, '0');

function isoDeUTC(data) {
  return `${data.getUTCFullYear()}-${dois(data.getUTCMonth() + 1)}-${dois(data.getUTCDate())}`;
}

function dataUTC(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  if (!m) throw new Error(`Data inválida (esperado AAAA-MM-DD): ${iso}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (isoDeUTC(d) !== iso) throw new Error(`Data inexistente: ${iso}`);
  return d;
}

// Domingo de Páscoa (algoritmo de Gauss/Meeus), em UTC para não mudar de dia com o fuso.
function pascoaUTC(ano) {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

const cache = new Map();

// Set de 'AAAA-MM-DD' dos dias sem expediente de âmbito nacional naquele ano.
export function feriadosNacionais(ano) {
  if (cache.has(ano)) return cache.get(ano);
  const pascoa = pascoaUTC(ano);
  const maisDias = n => { const d = new Date(pascoa); d.setUTCDate(d.getUTCDate() + n); return isoDeUTC(d); };
  const fixo = (mes, dia) => `${ano}-${dois(mes)}-${dois(dia)}`;
  const datas = [
    fixo(1, 1),      // Confraternização Universal
    maisDias(-48),   // Carnaval (segunda) — ponto facultativo
    maisDias(-47),   // Carnaval (terça) — ponto facultativo
    maisDias(-2),    // Sexta-feira da Paixão
    fixo(4, 21),     // Tiradentes
    fixo(5, 1),      // Dia do Trabalho
    maisDias(60),    // Corpus Christi — ponto facultativo
    fixo(9, 7),      // Independência
    fixo(10, 12),    // Nossa Senhora Aparecida
    fixo(11, 2),     // Finados
    fixo(11, 15),    // Proclamação da República
    fixo(12, 25),    // Natal
  ];
  // Dia da Consciência Negra é feriado nacional desde 2024 (Lei 14.759/2023).
  if (ano >= 2024) datas.push(fixo(11, 20));
  const set = new Set(datas);
  cache.set(ano, set);
  return set;
}

export function ehFeriadoNacional(iso) {
  return feriadosNacionais(dataUTC(iso).getUTCFullYear()).has(iso);
}

// 0 = domingo … 6 = sábado, do calendário (não do instante) — 'AAAA-MM-DD' é um dia civil.
export function diaDaSemana(iso) {
  return dataUTC(iso).getUTCDay();
}

export function nomeDoDia(iso) {
  return NOMES_DIA[diaDaSemana(iso)];
}

// Dia útil do escritório: não é sábado, domingo nem feriado nacional.
export function ehDiaUtil(iso) {
  const dow = diaDaSemana(iso);
  return dow !== 0 && dow !== 6 && !ehFeriadoNacional(iso);
}

// O próximo dia útil ESTRITAMENTE depois de `iso` (sexta → segunda; véspera de feriado → depois dele).
export function proximoDiaUtil(iso) {
  const d = dataUTC(iso);
  do { d.setUTCDate(d.getUTCDate() + 1); } while (!ehDiaUtil(isoDeUTC(d)));
  return isoDeUTC(d);
}

// O dia de hoje em Brasília como 'AAAA-MM-DD'. `agora` é injetável para teste.
export function hojeEscritorio(agora = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_ESCRITORIO, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(agora);
  const p = Object.fromEntries(partes.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
