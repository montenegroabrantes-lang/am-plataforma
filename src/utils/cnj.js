// Resolve o tribunal de um número CNJ pelo par de segmentos (J = segmento judiciário,
// TT = código do tribunal dentro do segmento), conforme a tabela oficial da Resolução
// CNJ 65/2008. Nunca presume um destino pra combinação que não reconhece — quem chama
// decide o que fazer (hoje: rejeitar e pedir conferência do número).

// Justiça Estadual (J=8) — os 27 tribunais de justiça.
const TJ_POR_UF = {
  '01': 'TJAC', '02': 'TJAL', '03': 'TJAP', '04': 'TJAM', '05': 'TJBA',
  '06': 'TJCE', '07': 'TJDFT', '08': 'TJES', '09': 'TJGO', '10': 'TJMA',
  '11': 'TJMT', '12': 'TJMS', '13': 'TJMG', '14': 'TJPA', '15': 'TJPB',
  '16': 'TJPR', '17': 'TJPE', '18': 'TJPI', '19': 'TJRJ', '20': 'TJRN',
  '21': 'TJRS', '22': 'TJRO', '23': 'TJRR', '24': 'TJSC', '25': 'TJSP',
  '26': 'TJSE', '27': 'TJTO',
};

// Justiça Federal (J=4) — as 6 regiões dos TRFs.
const TRF_POR_REGIAO = {
  '01': 'TRF1', '02': 'TRF2', '03': 'TRF3', '04': 'TRF4', '05': 'TRF5', '06': 'TRF6',
};

export function resolverTribunalCnj(segmentoJudiciario, codigoTribunal) {
  if (segmentoJudiciario === '8' && TJ_POR_UF[codigoTribunal]) {
    return { tribunal: TJ_POR_UF[codigoTribunal], sistema: 'pje' };
  }
  if (segmentoJudiciario === '4' && TRF_POR_REGIAO[codigoTribunal]) {
    return { tribunal: TRF_POR_REGIAO[codigoTribunal], sistema: 'pje' };
  }
  return null;
}
