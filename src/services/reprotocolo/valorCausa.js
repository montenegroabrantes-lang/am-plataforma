// Valor da causa do re-protocolo — PROPOSTA para o advogado conferir, nunca gravada na petição sozinha.
//
// FGTS: referência de 8% da remuneração oficial localizada (PB/PE) nas últimas 60 competências, a
// mesma da aba Estimativas ("referência, não cálculo jurídico"). A fórmula que o escritório usa no
// valor da causa ainda precisa ser confirmada pelo advogado, por isso todo resultado sai com
// `revisar: true`. Sem fonte oficial (município ou ente inferido), outras teses e valores acima do
// teto do Juizado vão para um humano (`exige_humano: true`).
//
// Teto do Juizado da Fazenda Pública: 60 salários mínimos. O salário mínimo vigente não é fixado
// em código: vem de SALARIO_MINIMO_VIGENTE (env). Sem ele, o teto aparece como "não verificado".
import { normalizarTexto } from '../remuneracaoEstadual.js';

export const TETO_JUIZADO_SALARIOS = 60;
export const salarioMinimoVigente = () => {
  const n = Number(String(process.env.SALARIO_MINIMO_VIGENTE ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};

const brl = v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// oficial: resumo guardado da conferência oficial ({ status, correspondencia, risco, periodo_consultado, vinculos })
export function calcularValorCausa({ tese, oficial = null, salarioMinimo = salarioMinimoVigente() } = {}) {
  const memoria = [];
  const base = { revisar: true, moeda: 'BRL', teto_juizado_salarios: TETO_JUIZADO_SALARIOS };
  if (!/\bFGTS\b/.test(normalizarTexto(tese))) {
    return { ...base, valor: null, exige_humano: true, motivo: `Sem cálculo integrado para a tese ${tese || 'não informada'}: o advogado informa o valor.`, memoria };
  }
  const risco = oficial?.risco;
  if (risco === null || risco === undefined) {
    return {
      ...base, valor: null, exige_humano: true, memoria,
      motivo: oficial
        ? 'A fonte oficial não trouxe correspondência clara (homônimos ou sem vínculo): o advogado informa o valor.'
        : 'Sem conferência na fonte oficial (município ou ente inferido): o advogado informa o valor.',
    };
  }
  const valor = Math.round(Number(risco) * 100) / 100;
  const consulta = oficial.periodo_consultado ? `${oficial.periodo_consultado.inicio} a ${oficial.periodo_consultado.fim}` : 'período consultado';
  memoria.push(`8% da remuneração oficial localizada (${consulta}), últimas 60 competências.`);
  memoria.push(`Referência, não cálculo jurídico: ${brl(valor)}.`);

  let exigeHumano = false;
  let motivo = 'Proposta: confira a fórmula do valor da causa antes de usar.';
  if (salarioMinimo) {
    const teto = Math.round(TETO_JUIZADO_SALARIOS * salarioMinimo * 100) / 100;
    memoria.push(`Teto do Juizado: ${TETO_JUIZADO_SALARIOS} salários mínimos = ${brl(teto)}.`);
    if (valor > teto) { exigeHumano = true; motivo = `Acima do teto do Juizado (${brl(teto)}): decisão do advogado (limitar ou usar a vara comum).`; }
  } else {
    memoria.push('Teto do Juizado não verificado: SALARIO_MINIMO_VIGENTE não está configurado.');
  }
  return { ...base, valor, exige_humano: exigeHumano, motivo, memoria };
}
