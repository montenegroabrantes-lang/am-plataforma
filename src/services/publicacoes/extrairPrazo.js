// Extrai prazo e data-limite do texto de uma publicação jurídica via regex

const MESES = {
  janeiro:1, fevereiro:2, março:3, abril:4, maio:5, junho:6,
  julho:7, agosto:8, setembro:9, outubro:10, novembro:11, dezembro:12,
  jan:1, fev:2, mar:3, abr:4, mai:5, jun:6,
  jul:7, ago:8, set:9, out:10, nov:11, dez:12,
};

const NUMEROS_EXTENSO = {
  um:1, dois:2, três:3, quatro:4, cinco:5, seis:6, sete:7, oito:8, nove:9, dez:10,
  onze:11, doze:12, treze:13, quatorze:14, quinze:15, dezesseis:16, dezessete:17,
  dezoito:18, dezenove:19, vinte:20, 'vinte e um':21, 'vinte e dois':22,
  'vinte e três':23, 'vinte e quatro':24, 'vinte e cinco':25, 'vinte e seis':26,
  'vinte e sete':27, 'vinte e oito':28, 'vinte e nove':29, trinta:30,
};

function resolverNumero(str) {
  if (!str) return null;
  const n = parseInt(str);
  if (!isNaN(n)) return n;
  return NUMEROS_EXTENSO[str.toLowerCase().trim()] || null;
}

function adicionarDiasUteis(data, dias) {
  const d = new Date(data);
  let adicionados = 0;
  while (adicionados < dias) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) adicionados++; // pula sábado e domingo
  }
  return d;
}

function adicionarDias(data, dias) {
  const d = new Date(data);
  d.setDate(d.getDate() + dias);
  return d;
}

function parseDateBR(str) {
  // DD/MM/YYYY ou DD/MM/YY
  const m = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  const ano = m[3].length === 2 ? 2000 + parseInt(m[3]) : parseInt(m[3]);
  return new Date(ano, parseInt(m[2]) - 1, parseInt(m[1]), 8, 0, 0);
}

function parseDateExtenso(str) {
  // "15 de julho de 2026" ou "15 de julho de 2026 às 14h"
  const m = str.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})(?:\s+[àa]s?\s+(\d{1,2})h(?:(\d{2}))?)?/i);
  if (!m) return null;
  const mes = MESES[m[2].toLowerCase()];
  if (!mes) return null;
  const hora = m[4] ? parseInt(m[4]) : 8;
  const min  = m[5] ? parseInt(m[5]) : 0;
  return new Date(parseInt(m[3]), mes - 1, parseInt(m[1]), hora, min, 0);
}

function parseDataHoraAudiencia(texto) {
  // "audiência para o dia 20/08/2026 às 14h30"
  const padroes = [
    /audi[eê]ncia[^.]*?(\d{1,2}\/\d{1,2}\/\d{2,4})[^.]*?(?:[àa]s?\s*(\d{1,2})h(\d{2})?)?/i,
    /designou[^.]*?(\d{1,2}\/\d{1,2}\/\d{2,4})[^.]*?(?:[àa]s?\s*(\d{1,2})h(\d{2})?)?/i,
    /(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})\s+[àa]s?\s+(\d{1,2})h(\d{2})?/i,
  ];

  for (const p of padroes) {
    const m = texto.match(p);
    if (!m) continue;
    if (m[1] && m[1].includes('/')) {
      const base = parseDateBR(m[1]);
      if (!base) continue;
      if (m[2]) { base.setHours(parseInt(m[2]), m[3] ? parseInt(m[3]) : 0, 0); }
      return { data: base, tipo: 'Audiência', prazo_dias: null, uteis: false };
    }
    const d = parseDateExtenso(m[0]);
    if (d) return { data: d, tipo: 'Audiência', prazo_dias: null, uteis: false };
  }
  return null;
}

// Extrai data explícita "até DD/MM/YYYY" ou "até o dia X de mês de YYYY"
function parseDataExplicita(texto) {
  const padroes = [
    /at[eé]\s+(?:o\s+dia\s+)?(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /vencimento[^.]*?(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /prazo[^.]*?expira[^.]*?(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
  ];
  for (const p of padroes) {
    const m = texto.match(p);
    if (m) {
      const d = parseDateBR(m[1]);
      if (d) return { data: d, tipo: 'Prazo', prazo_dias: null, uteis: false };
    }
  }
  return null;
}

// Extrai número de dias do texto: "prazo de 15 dias" ou "prazo de quinze dias úteis"
function extrairDiasPrazo(texto) {
  const padroes = [
    // "prazo de 15 (quinze) dias úteis"
    /prazo\s+de\s+(\d+)\s*(?:\([^)]+\))?\s*dias?\s*(úteis?|corridos?)?/i,
    // "prazo de quinze dias"
    /prazo\s+de\s+(um|dois|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte(?:\s+e\s+\w+)?|trinta)\s+dias?\s*(úteis?|corridos?)?/i,
    // "no prazo de 15 dias"
    /no\s+prazo\s+de\s+(\d+)\s*(?:\([^)]+\))?\s*dias?\s*(úteis?|corridos?)?/i,
    // "em 15 dias"
    /\bem\s+(\d+)\s+dias?\s*(úteis?|corridos?)?/i,
  ];

  for (const p of padroes) {
    const m = texto.match(p);
    if (!m) continue;
    const dias = resolverNumero(m[1]);
    if (!dias) continue;
    const uteis = /[uú]teis?/i.test(m[2] || '');
    return { dias, uteis };
  }
  return null;
}

// Detecta tipo do ato para o título do evento
function detectarTipoAto(texto) {
  const t = texto.toLowerCase();
  if (/audi[eê]ncia/.test(t))                        return 'Audiência';
  if (/contesta[cç][aã]o/.test(t))                   return 'Prazo — Contestação';
  if (/embargos\s+de\s+declara[cç][aã]o/.test(t))   return 'Prazo — Embargos de Declaração';
  if (/apela[cç][aã]o/.test(t))                      return 'Prazo — Apelação';
  if (/recurso/.test(t))                             return 'Prazo — Recurso';
  if (/contrarraz[oõ]es/.test(t))                    return 'Prazo — Contrarrazões';
  if (/impugna[cç][aã]o/.test(t))                    return 'Prazo — Impugnação';
  if (/manifesta[cç][aã]o/.test(t))                  return 'Prazo — Manifestação';
  if (/pagamento/.test(t))                           return 'Prazo — Pagamento';
  if (/cumprimento\s+de\s+senten[cç]a/.test(t))     return 'Prazo — Cumprimento de Sentença';
  if (/peti[cç][aã]o/.test(t))                      return 'Prazo — Petição';
  if (/intima[cç][aã]o/.test(t))                    return 'Intimação';
  if (/cita[cç][aã]o/.test(t))                      return 'Citação';
  return 'Publicação';
}

/**
 * Extrai prazo/data de um texto de publicação.
 * Retorna { dataEvento, titulo, descricao } ou null se não encontrar data.
 */
export function extrairPrazoPublicacao(texto, dataDisponibilizacao, processo) {
  if (!texto) return null;

  const tipo = detectarTipoAto(texto);

  // 1. Tenta audiência com data/hora explícita
  const audiencia = parseDataHoraAudiencia(texto);
  if (audiencia) {
    return {
      dataEvento: audiencia.data,
      titulo: `${audiencia.tipo}${processo?.numero ? ` — ${processo.numero}` : ''}`,
      descricao: montarDescricao(tipo, audiencia.data, null, false, processo, texto),
    };
  }

  // 2. Tenta data explícita ("até DD/MM/YYYY")
  const explicita = parseDataExplicita(texto);
  if (explicita) {
    return {
      dataEvento: explicita.data,
      titulo: `${tipo}${processo?.numero ? ` — ${processo.numero}` : ''}`,
      descricao: montarDescricao(tipo, explicita.data, null, false, processo, texto),
    };
  }

  // 3. Tenta extrair número de dias e calcular a partir da data de disponibilização
  const prazoDias = extrairDiasPrazo(texto);
  if (prazoDias) {
    const base = new Date(dataDisponibilizacao);
    base.setHours(8, 0, 0, 0);
    const dataEvento = prazoDias.uteis
      ? adicionarDiasUteis(base, prazoDias.dias)
      : adicionarDias(base, prazoDias.dias);

    return {
      dataEvento,
      titulo: `${tipo}${processo?.numero ? ` — ${processo.numero}` : ''}`,
      descricao: montarDescricao(tipo, dataEvento, prazoDias.dias, prazoDias.uteis, processo, texto),
    };
  }

  return null;
}

function montarDescricao(tipo, data, dias, uteis, processo, textoOriginal) {
  const linhas = [];
  if (tipo)                linhas.push(`Tipo: ${tipo}`);
  if (processo?.numero)   linhas.push(`Processo: ${processo.numero}`);
  if (processo?.tribunal) linhas.push(`Tribunal: ${processo.tribunal}`);
  if (processo?.vara)     linhas.push(`Vara: ${processo.vara}`);
  if (dias)               linhas.push(`Prazo: ${dias} dias${uteis ? ' úteis' : ''}`);
  if (data)               linhas.push(`Vencimento: ${data.toLocaleDateString('pt-BR')}`);
  if (textoOriginal)      linhas.push(`\nPublicação:\n${textoOriginal.slice(0, 500)}${textoOriginal.length > 500 ? '...' : ''}`);
  return linhas.join('\n');
}
