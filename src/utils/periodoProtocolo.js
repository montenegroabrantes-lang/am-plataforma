// Período do processo gravado ao registrar o protocolo (Fase 0 do re-protocolo, 28/09/2026).
//
// ciclosRecorrentes.js calcula o próximo ciclo a partir do periodo_fim do último processo, mas o
// registro do protocolo aceitava periodo_fim vazio e nunca gravava periodo_inicio (0 de 812
// processos em produção tinham início). Regra daqui em diante:
// - fim é obrigatório e não pode passar do mês atual;
// - re-protocolo (tarefa com ciclo_inicio): sem início informado, vale o próprio ciclo_inicio, e
//   nunca antes dele — antes disso o período pertence ao processo anterior;
// - protocolo inicial: início é opcional;
// - início nunca depois do fim.
// Datas sempre no 1º dia do mês (AAAA-MM-01), o formato que o cron e a tela de Tarefas já usam.

const MES_RE = /^(\d{4})-(\d{2})(?:-\d{2})?$/;

// Aceita 'AAAA-MM', 'AAAA-MM-DD' ou Date; devolve 'AAAA-MM-01' ou null se inválido.
export function primeiroDiaDoMes(valor) {
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null;
    return `${valor.getUTCFullYear()}-${String(valor.getUTCMonth() + 1).padStart(2, '0')}-01`;
  }
  const m = MES_RE.exec(String(valor ?? '').trim());
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  if (ano < 1990 || ano > 2100 || mes < 1 || mes > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}

const mesAno = (iso) => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export function resolverPeriodoProtocolo({ periodoInicio, periodoFim, cicloInicio, hoje = new Date() } = {}) {
  const fim = primeiroDiaDoMes(periodoFim);
  if (!fim) return { ok: false, erro: 'Informe o fim do período solicitado (mês e ano).' };
  if (fim > primeiroDiaDoMes(hoje)) {
    return { ok: false, erro: 'O fim do período não pode ser posterior ao mês atual.' };
  }

  const ciclo = cicloInicio ? primeiroDiaDoMes(cicloInicio) : null;
  let inicio = ciclo;
  if (periodoInicio !== undefined && periodoInicio !== null && String(periodoInicio).trim() !== '') {
    inicio = primeiroDiaDoMes(periodoInicio);
    if (!inicio) return { ok: false, erro: 'Início do período inválido. Informe mês e ano.' };
  }

  if (ciclo && inicio < ciclo) {
    return {
      ok: false,
      erro: `O início do período não pode ser anterior a ${mesAno(ciclo)}, início do ciclo — antes disso o período é do processo anterior.`,
    };
  }
  if (inicio && inicio > fim) {
    return { ok: false, erro: 'O início do período não pode ser depois do fim.' };
  }
  return { ok: true, inicio, fim };
}
