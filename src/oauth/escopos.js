// Escopos do conector Claude (OAuth) — o que cada autorização libera.
//
// O token do conector é um JWT da conta de serviço "integracao-claude" (perfil master). Sem
// escopo, ele valeria para a API inteira. Com escopos:
// - token OAuth NOVO carrega `escopos` e só é aceito em /mcp e nas áreas dos seus escopos
//   (confinamento em middleware/auth.js → autenticar);
// - token OAuth emitido ANTES dos escopos (sem o claim, identificado pela conta de serviço) é
//   RECUSADO com 401 por `autenticar` (S-18, 30/09/2026): "reconecte o conector". Antes valia como
//   "acervo" nas rotas que exigem escopo e, fora delas, como Master da API inteira;
// - sessão normal de usuário (login do AM) não tem escopo: vale o perfil (apenasMaster etc.).
export const CONTA_SERVICO_EMAIL = 'integracao-claude@abrantesemontenegro.com.br';

export const ESCOPOS = {
  acervo: {
    rotulo: 'Acervo jurídico',
    descricao: 'Consultar e registrar peças e precedentes do acervo.',
    prefixos: ['/api/acervo'],
  },
  reprotocolo: {
    rotulo: 'Levantamento de re-protocolo (somente leitura)',
    descricao: 'Ver as filas Re-protocolo e Novos ciclos (nome e CPF mascarado dos clientes, período, polo, juízo) '
      + 'e conferir o vínculo na fonte oficial da Paraíba/Pernambuco. Não altera nada.',
    prefixos: ['/api/reprotocolo'],
  },
};

export const ESCOPOS_VALIDOS = Object.keys(ESCOPOS);
// Sem escopo pedido pelo cliente, a tela de autorização já vem só com "acervo" marcado —
// o comportamento que o conector sempre teve.
export const ESCOPOS_PADRAO = ['acervo'];

// Aceita "a b" (padrão OAuth), ["a","b"] ou "a" e devolve só escopos válidos, sem repetição,
// na ordem do catálogo.
export function normalizarEscopos(valor) {
  const lista = Array.isArray(valor) ? valor : String(valor ?? '').split(/[\s,]+/);
  const pedidos = new Set(lista.map(v => String(v).trim()).filter(Boolean));
  return ESCOPOS_VALIDOS.filter(e => pedidos.has(e));
}

export const MSG_CONECTOR_ANTIGO = 'Token do conector antigo — reconecte o conector do AM no Claude '
  + '(Configurações → Conectores → desconectar e conectar de novo).';

// Token da conta de serviço sem o claim `escopos` (emitido antes dos escopos de 28/09/2026).
export function tokenConectorSemEscopos(usuario) {
  return String(usuario?.email ?? '').toLowerCase() === CONTA_SERVICO_EMAIL && !Array.isArray(usuario?.escopos);
}

// null = sessão de usuário, sem restrição de escopo.
export function escoposDoToken(usuario) {
  if (Array.isArray(usuario?.escopos)) return normalizarEscopos(usuario.escopos);
  // Já recusado por `autenticar`; se chegar aqui, falha fechada: nenhum escopo.
  if (tokenConectorSemEscopos(usuario)) return [];
  return null;
}

// Onde um token COM escopos pode entrar: o próprio /mcp (as ferramentas chamam a API com o
// mesmo token, e cada área é conferida de novo) e as áreas dos escopos concedidos.
export function areaPermitidaAoToken(baseUrl, escopos) {
  const base = String(baseUrl || '');
  if (base === '/mcp') return true;
  return escopos.some(e => ESCOPOS[e]?.prefixos.some(p => base === p || base.startsWith(`${p}/`)));
}
