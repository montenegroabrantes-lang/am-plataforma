// Validação de CPF por dígito verificador (módulo 11) — algoritmo padrão da Receita Federal.
export function cpfValido(cpf) {
  const digitos = String(cpf || '').replace(/\D/g, '');
  if (digitos.length !== 11 || /^(\d)\1{10}$/.test(digitos)) return false;

  const calcDigito = (base, pesoInicial) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (pesoInicial - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  const d1 = calcDigito(digitos.slice(0, 9), 10);
  const d2 = calcDigito(digitos.slice(0, 10), 11);
  return d1 === Number(digitos[9]) && d2 === Number(digitos[10]);
}
