import { db } from '../db/index.js';

// S-03 (30/09/2026): a sessão passa a ser revogável. O JWT sozinho não manda mais: a cada requisição
// o `autenticar` confere no banco se a conta segue ativa, qual o perfil de hoje e se a versão de sessão
// (`usuarios.sessao_versao`) ainda é a do token. Desativar alguém, trocar senha/e-mail ou "Sair de todos
// os dispositivos" incrementa a versão e derruba todos os tokens da conta.
//
// Cache de 30 s por usuário: há uma instância só do backend (com mais de uma, trocar por Redis). Toda
// mudança feita por este processo chama `invalidarSessao`, então o cache só atrasa o que vier de fora.
const CACHE_MS = 30_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SQL_ESTADO_USUARIO = `SELECT id, ativo, perfil, pode_marcar_restrito, master_id, email, nome, sessao_versao
     FROM usuarios WHERE id = $1`;

const cache = new Map();      // id -> { estado, expira }
const geracoes = new Map();   // id -> contador; invalidar durante uma leitura impede que ela grave no cache

async function carregarDoBanco(id) {
  if (!UUID_RE.test(String(id))) return null;
  const linha = await db.queryOne(SQL_ESTADO_USUARIO, [id]);
  if (!linha) return null;
  return { ...linha, sessao_versao: Number(linha.sessao_versao ?? 0) };
}

let carregador = carregarDoBanco;
let usaCache = true;

// Só para os testes: `fn(id, claims)` devolve o estado da conta (ou null). Sem cache.
export function definirCarregador(fn) {
  carregador = fn || carregarDoBanco;
  usaCache = !fn;
  cache.clear();
}

// Carregador dos testes que só querem "a conta é o que o token diz": perfil, versão e demais campos
// vêm do próprio token assinado. Os testes de sessão (auth.test.js) usam carregadores próprios.
export const carregadorEcoDoToken = async (_id, claims = {}) => ({
  ativo: true,
  perfil: claims.perfil,
  pode_marcar_restrito: claims.pode_marcar_restrito,
  master_id: claims.master_id,
  email: claims.email,
  nome: claims.nome,
  sessao_versao: Number(claims.sv ?? 0),
});

// `fresco: true` ignora o cache (usado no refresh e antes de recusar um token).
export async function estadoUsuario(id, { claims, fresco = false } = {}) {
  if (!usaCache) return carregador(id, claims);
  const agora = Date.now();
  if (!fresco) {
    const guardado = cache.get(id);
    if (guardado && guardado.expira > agora) return guardado.estado;
  }
  const geracao = geracoes.get(id) || 0;
  const estado = await carregador(id, claims);
  if (estado && (geracoes.get(id) || 0) === geracao) cache.set(id, { estado, expira: agora + CACHE_MS });
  else cache.delete(id);
  return estado;
}

export function invalidarSessao(id) {
  geracoes.set(id, (geracoes.get(id) || 0) + 1);
  cache.delete(id);
}
