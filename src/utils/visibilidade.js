// Visibilidade de processos (S-21) — UMA regra só, usada por toda rota que recebe id de processo
// e por toda listagem que devolve processos.
//
// Regra: processo marcado como 'restrito' só é visto pelo Master 01 (usuarios.pode_marcar_restrito).
// Quem não pode ver recebe 404 ("não encontrado"), igual a um id que não existe: a resposta não
// revela que o processo existe. `processos.visibilidade` é NOT NULL, com CHECK em normal|restrito.
import { db } from '../db/index.js';
import { uuidValido } from './validacao.js';

// Regra pura, para quando a linha do processo já foi carregada pela própria rota (sem 2ª consulta).
export function usuarioVeVisibilidade(user, visibilidade) {
  return visibilidade !== 'restrito' || Boolean(user?.pode_marcar_restrito);
}

// Trecho de SQL para listagens (`AND ...`); vazio para quem vê tudo. `alias` é o nome da tabela
// `processos` na consulta.
export function filtroVisibilidade(user, alias = 'p') {
  if (user?.pode_marcar_restrito) return '';
  return `AND (${alias}.visibilidade = 'normal')`;
}

// Verdadeiro, falso ou nulo (id malformado ou processo que não existe).
// As rotas respondem 404 quando o resultado NÃO é `true`.
export async function podeVerProcesso(user, processoId, conexao = db) {
  if (!uuidValido(String(processoId ?? ''))) return null;
  const processo = await conexao.queryOne('SELECT visibilidade FROM processos WHERE id = $1', [processoId]);
  if (!processo) return null;
  return usuarioVeVisibilidade(user, processo.visibilidade);
}
