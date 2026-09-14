import { db } from '../db/index.js';

export function normalizarNomeCliente(valor) {
  const nomeBase = String(valor || '').split(/\s+[x×]\s+/i, 1)[0];
  const palavras = nomeBase
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .filter(palavra => !['DA', 'DE', 'DO', 'DAS', 'DOS', 'E'].includes(palavra));
  return palavras.join(' ');
}

export function variantesTelefoneCliente(valor) {
  const digitos = String(valor || '').replace(/\D/g, '');
  if (digitos.length < 10 || digitos.length > 13) return [];

  const nacional = digitos.startsWith('55') && digitos.length >= 12
    ? digitos.slice(2)
    : digitos;
  if (![10, 11].includes(nacional.length)) return [];

  const nacionais = new Set([nacional]);
  if (nacional.length === 10) nacionais.add(`${nacional.slice(0, 2)}9${nacional.slice(2)}`);
  if (nacional.length === 11 && nacional[2] === '9') nacionais.add(`${nacional.slice(0, 2)}${nacional.slice(3)}`);

  const variantes = new Set();
  for (const numero of nacionais) {
    variantes.add(numero);
    variantes.add(`55${numero}`);
  }
  return [...variantes];
}

function respostaCliente(cliente) {
  const totalProcessos = Number(cliente.total_processos || 0);
  return {
    nome: cliente.nome,
    ativo: cliente.ativo !== false,
    vinculoAtivo: cliente.vinculo_ativo !== false,
    possuiProcesso: totalProcessos > 0,
    totalProcessos,
  };
}

export async function buscarClienteParaCamila({ telefone, nome }, banco = db) {
  const telefones = new Set(variantesTelefoneCliente(telefone));
  const nomeNormalizado = normalizarNomeCliente(nome);
  if (!telefones.size && nomeNormalizado.split(' ').filter(Boolean).length < 2) return null;

  // O cadastro tem poucas centenas de clientes. Ler somente estes campos permite comparar
  // telefones antigos (com/sem nono dígito) e o nome de exibição do Digisac sem expor CPF,
  // número de processo, anotações ou qualquer outro dado à integração comercial.
  const clientes = await banco.query(
    `SELECT c.nome, c.whatsapp, c.ativo, COALESCE(c.vinculo_ativo, TRUE) AS vinculo_ativo,
            COUNT(p.id)::int AS total_processos
       FROM clientes c
       LEFT JOIN processos p ON p.cliente_id = c.id
      WHERE c.ativo IS NOT FALSE
      GROUP BY c.id
      ORDER BY c.nome`
  );

  const porTelefone = clientes.filter(cliente => {
    const cadastrados = variantesTelefoneCliente(cliente.whatsapp);
    return cadastrados.some(numero => telefones.has(numero));
  });
  if (porTelefone.length === 1) return respostaCliente(porTelefone[0]);
  if (porTelefone.length > 1) return null;

  if (nomeNormalizado.split(' ').filter(Boolean).length < 2) return null;
  const porNome = clientes.filter(cliente => normalizarNomeCliente(cliente.nome) === nomeNormalizado);
  return porNome.length === 1 ? respostaCliente(porNome[0]) : null;
}
