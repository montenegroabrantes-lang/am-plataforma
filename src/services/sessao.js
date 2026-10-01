import crypto from 'node:crypto';
import jwt    from 'jsonwebtoken';
import { db } from '../db/index.js';
import { estadoUsuario, invalidarSessao } from '../middleware/sessao.js';

// S-03/S-04 (30/09/2026) — emissão, rotação e revogação de sessões.
//
// Acesso: JWT de 1 hora (cookie am_token), com `sv` (versão da conta) e `fam` (família do refresh).
// Refresh: JWT de até 7 dias (cookie am_refresh), UM por linha em `sessoes_refresh` (só o hash SHA-256).
// Cada refresh usado é trocado por outro da MESMA família; a família vale no máximo 30 dias desde o
// login (validade absoluta). Reuso de um refresh já usado há mais de 60 s = roubo provável: a família
// inteira é revogada. Dentro de 60 s é só concorrência (várias abas/requisições) e passa.
export const ACESSO_SEGUNDOS    = 60 * 60;
export const REFRESH_DIAS       = 7;
export const FAMILIA_DIAS       = 30;
export const TOLERANCIA_MS      = 60_000;
export const PRIMEIRO_ACESSO_SEGUNDOS = 5 * 60;
export const AUD_PRIMEIRO_ACESSO = 'am-primeiro-acesso';
export const SENHA_MIN = 10;
export const SENHA_MAX = 128;
const DIA_MS = 24 * 60 * 60 * 1000;

export const SQL_LINHA_POR_HASH = `SELECT * FROM sessoes_refresh WHERE token_hash = $1`;
export const SQL_INSERIR = `INSERT INTO sessoes_refresh
    (id, usuario_id, familia, token_hash, criado_em, expira_em, familia_expira_em, usado_em, ip)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`;
// Refresh antigo (anterior ao S-03) ou re-assinado por um código anterior: adotado como "já usado".
export const SQL_ADOTAR = `${SQL_INSERIR} ON CONFLICT (token_hash) DO NOTHING RETURNING id`;
export const SQL_USAR = `UPDATE sessoes_refresh SET usado_em = $2 WHERE id = $1 AND usado_em IS NULL RETURNING id`;
export const SQL_ESTADO_FAMILIA = `SELECT bool_or(revogado_em IS NOT NULL) AS revogada, MAX(familia_expira_em) AS familia_expira_em
     FROM sessoes_refresh WHERE familia = $1`;
export const SQL_REVOGAR_FAMILIA = `UPDATE sessoes_refresh SET revogado_em = $2 WHERE familia = $1 AND revogado_em IS NULL`;
export const SQL_REVOGAR_USUARIO = `UPDATE sessoes_refresh SET revogado_em = $2 WHERE usuario_id = $1 AND revogado_em IS NULL`;
export const SQL_LIMPAR = `DELETE FROM sessoes_refresh WHERE usuario_id = $1 AND expira_em < $2`;
export const SQL_SUBIR_VERSAO = `UPDATE usuarios SET sessao_versao = sessao_versao + 1 WHERE id = $1`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

// Campos que o frontend guarda (localStorage) e que o token sempre carregou.
export function payloadPublico(u) {
  return {
    id:                   u.id,
    nome:                 u.nome,
    email:                u.email,
    perfil:               u.perfil,
    master_id:            u.master_id ?? null,
    pode_marcar_restrito: u.pode_marcar_restrito,
  };
}

// Emite um par (acesso + refresh) e grava o refresh. `user` já vem do banco.
async function emitirPar(user, { familia, familiaExpiraEm, ip }) {
  const agora = new Date();
  const expira = new Date(Math.min(agora.getTime() + REFRESH_DIAS * DIA_MS, familiaExpiraEm.getTime()));
  const segundos = Math.floor((expira.getTime() - agora.getTime()) / 1000);
  if (segundos < 1) return null;

  const rid = crypto.randomUUID();
  const sv  = Number(user.sessao_versao ?? 0);
  const publico = payloadPublico(user);
  // O refresh mantém os campos antigos (id, nome, e-mail, perfil...) e acrescenta rid/fam/sv: se o código
  // voltar a uma versão anterior, o refresh novo continua valendo e ninguém vira "sem perfil".
  const refresh = jwt.sign({ ...publico, rid, fam: familia, sv }, process.env.JWT_REFRESH_SECRET, { expiresIn: segundos });
  await db.execute(SQL_INSERIR, [rid, user.id, familia, hashToken(refresh), agora, expira, familiaExpiraEm, null, ip ?? null]);
  const access = jwt.sign({ ...publico, sv, fam: familia }, process.env.JWT_SECRET, { expiresIn: Math.min(ACESSO_SEGUNDOS, segundos) });
  return { access, refresh, familia };
}

// Login: abre uma família nova (validade absoluta de 30 dias).
export async function abrirSessao(user, { ip } = {}) {
  const par = await emitirPar(user, {
    familia: crypto.randomUUID(),
    familiaExpiraEm: new Date(Date.now() + FAMILIA_DIAS * DIA_MS),
    ip,
  });
  limparVencidas(user.id);
  return par;
}

// Apaga as linhas vencidas há mais de 1 dia do mesmo usuário (sem atrasar nem derrubar o pedido).
function limparVencidas(usuarioId) {
  Promise.resolve()
    .then(() => db.execute(SQL_LIMPAR, [usuarioId, new Date(Date.now() - DIA_MS)]))
    .catch(e => console.warn('[sessao] limpeza de refresh vencidos falhou:', e.message));
}

const recusa = (erro = 'Sessão expirada. Faça login novamente.') => ({ ok: false, status: 401, erro });

// Renovação. Devolve { ok:true, access, refresh, user } ou { ok:false, status, erro }.
// Erro de banco NÃO é capturado aqui: quem chama responde 503 e mantém os cookies (nunca desloga por falha nossa).
export async function renovarSessao(refreshJwt, ip) {
  let d;
  try { d = jwt.verify(refreshJwt, process.env.JWT_REFRESH_SECRET); } catch { return recusa(); }
  if (d.fin || !d.id) return recusa();

  const estado = await estadoUsuario(d.id, { claims: d, fresco: true });
  if (!estado?.ativo) return recusa();
  if (Number(d.sv ?? 0) !== Number(estado.sessao_versao)) return recusa();
  const user = { ...estado, id: d.id };

  const hash  = hashToken(refreshJwt);
  const agora = new Date();
  let linha = await db.queryOne(SQL_LINHA_POR_HASH, [hash]);

  let familia, familiaExpiraEm;
  if (!linha) {
    // Refresh sem linha: anterior ao S-03 (D-S1: sessões abertas continuam valendo, só com versão 0) ou
    // re-assinado por um código anterior (mantém `fam`). Vira uma linha "já usada" e segue a regra normal.
    familia = UUID_RE.test(String(d.fam)) ? d.fam : crypto.randomUUID();
    const est = await db.queryOne(SQL_ESTADO_FAMILIA, [familia]);
    if (est?.revogada) return recusa();
    familiaExpiraEm = est?.familia_expira_em ? new Date(est.familia_expira_em) : new Date(agora.getTime() + FAMILIA_DIAS * DIA_MS);
    if (familiaExpiraEm <= agora) return recusa();
    const expiraEm = d.exp ? new Date(d.exp * 1000) : new Date(agora.getTime() + REFRESH_DIAS * DIA_MS);
    const criada = await db.queryOne(SQL_ADOTAR, [crypto.randomUUID(), user.id, familia, hash, agora, expiraEm, familiaExpiraEm, agora, ip ?? null]);
    if (!criada) linha = await db.queryOne(SQL_LINHA_POR_HASH, [hash]); // outra requisição adotou no mesmo instante
  }

  if (linha) {
    if (linha.usuario_id !== user.id) return recusa();
    if (linha.revogado_em) return recusa();
    familia = linha.familia;
    familiaExpiraEm = new Date(linha.familia_expira_em);
    if (new Date(linha.expira_em) <= agora || familiaExpiraEm <= agora) return recusa();

    let usadoEm = linha.usado_em;
    if (!usadoEm) {
      const ganhou = await db.queryOne(SQL_USAR, [linha.id, agora]);
      if (!ganhou) {
        const atual = await db.queryOne(SQL_LINHA_POR_HASH, [hash]);
        if (atual?.revogado_em) return recusa();
        usadoEm = atual?.usado_em ?? agora;
      }
    }
    if (usadoEm && agora.getTime() - new Date(usadoEm).getTime() > TOLERANCIA_MS) {
      await revogarFamilia(familia);
      return recusa();
    }
  }

  const par = await emitirPar(user, { familia, familiaExpiraEm, ip });
  if (!par) return recusa();
  limparVencidas(user.id);
  return { ok: true, ...par, user: payloadPublico(user) };
}

export async function revogarFamilia(familia) {
  if (!UUID_RE.test(String(familia))) return;
  await db.execute(SQL_REVOGAR_FAMILIA, [familia, new Date()]);
}

// Revoga todos os refresh da conta e limpa o cache de estado (a versão já foi incrementada por quem chama).
export async function revogarSessoesDoUsuario(usuarioId) {
  try {
    await db.execute(SQL_REVOGAR_USUARIO, [usuarioId, new Date()]);
  } finally {
    invalidarSessao(usuarioId);
  }
}

// Derruba TODAS as sessões da conta: sobe a versão (tokens de acesso e refresh antigos morrem) e revoga as famílias.
export async function derrubarSessoes(usuarioId) {
  try {
    await db.execute(SQL_SUBIR_VERSAO, [usuarioId]);
  } finally {
    invalidarSessao(usuarioId);
  }
  await revogarSessoesDoUsuario(usuarioId);
}

// ── Token de primeiro acesso (S-04) ──
// Finalidade única, 5 minutos, `aud` próprio e assinado com uma chave DERIVADA do JWT_SECRET: mesmo que algum
// código verificasse o token com o JWT_SECRET puro, a assinatura não bateria. O `autenticar` ainda recusa `fin`/`aud`.
const segredoPrimeiroAcesso = () =>
  crypto.createHmac('sha256', String(process.env.JWT_SECRET)).update('am-primeiro-acesso').digest('hex');

export function emitirTokenPrimeiroAcesso(user) {
  return jwt.sign(
    { fin: 'primeiro_acesso', id: user.id, sv: Number(user.sessao_versao ?? 0) },
    segredoPrimeiroAcesso(),
    { expiresIn: PRIMEIRO_ACESSO_SEGUNDOS, audience: AUD_PRIMEIRO_ACESSO },
  );
}

export function lerTokenPrimeiroAcesso(token) {
  try {
    const p = jwt.verify(String(token), segredoPrimeiroAcesso(), { audience: AUD_PRIMEIRO_ACESSO });
    return p.fin === 'primeiro_acesso' && p.id ? p : null;
  } catch {
    return null;
  }
}
