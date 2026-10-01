import { db } from '../db/index.js';

// Registra ações destrutivas no log de auditoria
export function auditar(req, _res, next) {
  // `req.ip` respeita o `trust proxy` de index.js (o salto do Railway acrescenta o IP real do
  // cliente ao fim do X-Forwarded-For). O primeiro valor do cabeçalho é escrito pelo próprio
  // cliente: quem o forjasse gravaria um IP falso na auditoria e escaparia dos limites por IP.
  req._ip = req.ip || req.socket.remoteAddress;
  next();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ehObjetoSimples = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// `conexao` opcional: passe o `tx` de um db.transaction() pra gravar o log na
// MESMA transação da ação que ele audita -- se a ação for revertida (ROLLBACK),
// o log também é, em vez de sobrar um registro de auditoria "órfão" de uma ação
// que na prática nunca aconteceu.
//
// S-13: a linha guarda o retrato do autor (nome e e-mail no momento), lido do cadastro no próprio
// INSERT, e `entidade_id` só aceita UUID: outro formato (id numérico de publicação, contactId do
// Digisac) iria derrubar o INSERT e o log se perderia; então vai para `valor_depois.entidade_ref`.
export async function registrarAuditoria({ usuarioId, acao, entidade, entidadeId, valorAntes, valorDepois, ip }, conexao = db) {
  let idEntidade = entidadeId ?? null;
  let depois = valorDepois;
  if (idEntidade !== null && !UUID_RE.test(String(idEntidade))) {
    const ref = String(idEntidade).slice(0, 80);
    depois = ehObjetoSimples(valorDepois) ? { ...valorDepois, entidade_ref: ref }
           : valorDepois ? { valor: valorDepois, entidade_ref: ref } : { entidade_ref: ref };
    idEntidade = null;
  }
  try {
    await conexao.execute(
      `INSERT INTO logs_auditoria (usuario_id, acao, entidade, entidade_id, valor_antes, valor_depois, ip, usuario_nome, usuario_email)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7,
               (SELECT nome  FROM usuarios WHERE id = $1::uuid),
               (SELECT email FROM usuarios WHERE id = $1::uuid))`,
      [
        usuarioId  ?? null,
        acao,
        entidade,
        idEntidade,
        valorAntes  ? JSON.stringify(valorAntes)  : null,
        depois      ? JSON.stringify(depois)      : null,
        ip ?? null,
      ]
    );
  } catch (err) {
    // Dentro de uma transação o INSERT que falha deixa a transação abortada: o COMMIT viraria
    // ROLLBACK em silêncio e a rota responderia "ok". Relança para a rota falhar de verdade.
    if (conexao !== db) throw err;
    // Fora de transação, o log nunca pode derrubar o request principal
    console.error('[Auditoria] Falha ao registrar:', acao, err.code || '', err.message);
  }
}
