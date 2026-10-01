// Proteção contra CSRF por checagem de ORIGEM (S-01).
//
// O cookie de sessão é `SameSite=None` em produção (frontend e API ficam em domínios
// diferentes do Railway, e `up.railway.app` está na Public Suffix List: para o navegador as
// chamadas legítimas também são `cross-site`). Por isso o navegador anexa o cookie a um
// formulário ou `fetch` disparado por QUALQUER site. O que distingue o frontend legítimo é o
// cabeçalho `Origin` (que o navegador sempre envia em POST/PUT/PATCH/DELETE e que a página
// maliciosa não consegue forjar): comparamos com a origem do frontend (FRONTEND_URL, a mesma
// usada pelo CORS), por igualdade EXATA de origem — nunca startsWith/includes.
//
// Não se aplica a: métodos de leitura; requisições sem Origin/Referer (servidor a servidor:
// Camila, GitHub Actions, MCP → API local); chamadas com `Authorization: Bearer` (um site
// externo não consegue definir esse cabeçalho sem passar pelo preflight do CORS, que só
// libera a origem do frontend); e às rotas isentas listadas em ISENCOES_PADRAO, que se
// autenticam por chave própria ou por credenciais no corpo, nunca pelo cookie.

const METODOS_QUE_ALTERAM = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Só o que autentica SEM o cookie de sessão. Prefixo apenas para estas quatro árvores; a
// importação de publicações é por igualdade exata (um prefixo isentaria também
// /api/publicacoes/importar-browser, que é autenticada por cookie).
export const ISENCOES_PADRAO = {
  prefixos: ['/oauth/', '/mcp', '/api/integracoes/', '/api/webhook/'],
  exatas: [['POST', '/api/publicacoes/importar']],
};

// Origem canônica (esquema://host[:porta]) ou null se não for uma URL válida. O valor literal
// "null" (páginas sandbox, redirecionamentos entre origens, Referrer-Policy: no-referrer) nunca
// é uma origem válida e cai no null.
export function normalizarOrigem(valor) {
  if (typeof valor !== 'string' || !valor || valor === 'null') return null;
  try {
    const u = new URL(valor);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

// `permitida`: string (aceita várias separadas por vírgula) ou array. Só origens válidas.
export function listarOrigensPermitidas(permitida) {
  const brutas = Array.isArray(permitida) ? permitida : String(permitida ?? '').split(',');
  return brutas.map(o => normalizarOrigem(o.trim())).filter(Boolean);
}

function prefixoCasa(caminho, prefixo) {
  if (prefixo.endsWith('/')) return caminho.startsWith(prefixo);
  return caminho === prefixo || caminho.startsWith(`${prefixo}/`);
}

function caminhoIsento(metodo, caminho, { prefixos = [], exatas = [] }) {
  if (prefixos.some(p => prefixoCasa(caminho, p))) return true;
  return exatas.some(([m, c]) => m === metodo && c === caminho);
}

function ehBearer(req) {
  return /^Bearer\s+\S/.test(req.headers?.authorization || '');
}

const limpar = (v) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200);

// Devolve true se a origem declarada pela requisição é uma das permitidas. Prioriza `Origin`;
// na falta dele (navegadores antigos em alguns formulários) usa a origem do `Referer`.
// Sem nenhum dos dois: `semCabecalho` (padrão true = servidor a servidor).
export function origemDaRequisicaoPermitida(req, permitidas, { semCabecalho = true } = {}) {
  const origin = req.headers?.origin;
  if (origin !== undefined) return permitidas.includes(normalizarOrigem(origin));
  const referer = req.headers?.referer;
  if (referer !== undefined && referer !== '') return permitidas.includes(normalizarOrigem(referer));
  return semCabecalho;
}

export function exigirOrigemConfiavel({ permitida, prefixos, exatas, log = console.warn } = {}) {
  const origens = listarOrigensPermitidas(permitida);
  const isencoes = { prefixos: prefixos ?? ISENCOES_PADRAO.prefixos, exatas: exatas ?? ISENCOES_PADRAO.exatas };
  return (req, res, next) => {
    if (!METODOS_QUE_ALTERAM.has(req.method)) return next();
    if (caminhoIsento(req.method, req.path, isencoes)) return next();
    if (ehBearer(req)) return next();
    if (origemDaRequisicaoPermitida(req, origens)) return next();
    // Só método, rota e a origem recusada (sem corpo, cookie ou cabeçalhos de autenticação).
    log(`[CSRF] recusado ${req.method} ${limpar(req.path)} origem=${limpar(req.headers?.origin ?? req.headers?.referer)}`);
    return res.status(403).json({ ok: false, erro: 'Origem não permitida.' });
  };
}

// Para rotas de LEITURA que gravam (legado): exige que o `Origin` exista e seja o do frontend.
// Um `<img>`/navegação de outro site num GET não envia Origin; um XHR/fetch do frontend envia.
export function exigirOrigemExplicita(permitida) {
  const origens = listarOrigensPermitidas(permitida);
  return (req, res, next) => {
    if (ehBearer(req) || (req.headers?.origin !== undefined && origemDaRequisicaoPermitida(req, origens, { semCabecalho: false }))) return next();
    return res.status(403).json({ ok: false, erro: 'Origem não permitida.' });
  };
}
