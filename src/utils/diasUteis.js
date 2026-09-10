// Soma dias úteis sem depender do fuso horário do servidor. Feriados forenses
// continuam sendo definidos manualmente pela equipe; aqui removemos apenas sábado/domingo.
export function dataCalendarioValida(valor) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(valor || ''))) return false;
  const [ano, mes, dia] = String(valor).split('-').map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia;
}

export function somarDiasUteis(dataBase = new Date(), quantidade = 1) {
  const data = typeof dataBase === 'string'
    ? new Date(`${dataBase.slice(0, 10)}T12:00:00`)
    : new Date(dataBase);

  let restantes = Math.max(0, Number(quantidade) || 0);
  while (restantes > 0) {
    data.setDate(data.getDate() + 1);
    if (data.getDay() !== 0 && data.getDay() !== 6) restantes--;
  }

  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}
