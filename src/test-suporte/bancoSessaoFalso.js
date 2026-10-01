// Banco em memória para os testes de sessão (S-03/S-04): reconhece EXATAMENTE os SQL que o código de sessão
// executa (as constantes exportadas pelo próprio código) e simula o que o Postgres faria com eles. SQL novo
// ou alterado que não esteja aqui derruba o teste ("SQL inesperado"), em vez de passar em silêncio.
// Não é um teste: o arquivo não termina em .test.js.
import { SQL_ESTADO_USUARIO } from '../middleware/sessao.js';
import {
  SQL_LINHA_POR_HASH, SQL_INSERIR, SQL_ADOTAR, SQL_USAR, SQL_ESTADO_FAMILIA,
  SQL_REVOGAR_FAMILIA, SQL_REVOGAR_USUARIO, SQL_LIMPAR, SQL_SUBIR_VERSAO,
} from '../services/sessao.js';

const norm = (sql) => String(sql).replace(/\s+/g, ' ').trim();
const cede = () => new Promise((r) => setImmediate(r)); // deixa requisições paralelas se intercalarem

export function criarBancoFalso() {
  const banco = {
    usuarios: new Map(),   // id -> linha completa
    sessoes: [],           // linhas de sessoes_refresh
    logs: [],              // logs_auditoria: { usuarioId, acao, entidade, entidadeId, valorAntes, valorDepois, ip }
    consultas: [],
    fora: false,           // true: o banco "caiu"
    adicionarUsuario(u) {
      const linha = {
        ativo: true, perfil: 'master', master_id: null, pode_marcar_restrito: false, senha_temporaria: false,
        totp_ativo: false, totp_secret: null, sessao_versao: 0, ...u,
      };
      banco.usuarios.set(linha.id, linha);
      return linha;
    },
    porEmail: (email) => [...banco.usuarios.values()].find((u) => u.email === email),
    sessoesDo: (usuarioId) => banco.sessoes.filter((s) => s.usuario_id === usuarioId),
    acoes: () => banco.logs.map((l) => l.acao),
  };

  const ESTADO = norm(SQL_ESTADO_USUARIO);
  const Q = {
    LINHA: norm(SQL_LINHA_POR_HASH), INSERIR: norm(SQL_INSERIR), ADOTAR: norm(SQL_ADOTAR), USAR: norm(SQL_USAR),
    FAMILIA: norm(SQL_ESTADO_FAMILIA), REV_FAM: norm(SQL_REVOGAR_FAMILIA), REV_USU: norm(SQL_REVOGAR_USUARIO),
    LIMPAR: norm(SQL_LIMPAR), VERSAO: norm(SQL_SUBIR_VERSAO),
  };

  function inserirSessao(p, { ignorarConflito }) {
    if (banco.sessoes.some((s) => s.token_hash === p[3])) {
      if (ignorarConflito) return null;
      throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
    }
    const linha = {
      id: p[0], usuario_id: p[1], familia: p[2], token_hash: p[3], criado_em: p[4], expira_em: p[5],
      familia_expira_em: p[6], usado_em: p[7], revogado_em: null, ip: p[8],
    };
    banco.sessoes.push(linha);
    return linha;
  }

  async function despachar(sqlBruto, p = []) {
    if (banco.fora) throw new Error('conexão com o banco recusada (simulada)');
    await cede();
    const sql = norm(sqlBruto);
    banco.consultas.push(sql);
    const U = banco.usuarios;

    // ── contas ──
    if (sql === ESTADO) {
      const u = U.get(p[0]);
      if (!u) return { rows: [] };
      const { id, ativo, perfil, pode_marcar_restrito, master_id, email, nome, sessao_versao } = u;
      return { rows: [{ id, ativo, perfil, pode_marcar_restrito, master_id, email, nome, sessao_versao }] };
    }
    if (sql === 'SELECT * FROM usuarios WHERE email = $1 AND ativo = true') {
      const u = banco.porEmail(p[0]);
      return { rows: u && u.ativo ? [{ ...u }] : [] };
    }
    if (sql === 'SELECT * FROM usuarios WHERE id = $1 AND ativo = true') {
      const u = U.get(p[0]);
      return { rows: u && u.ativo ? [{ ...u }] : [] };
    }
    if (sql === 'SELECT id, nome, email, perfil, pode_marcar_restrito, master_id FROM usuarios WHERE id = $1 AND ativo = true') {
      const u = U.get(p[0]);
      if (!u || !u.ativo) return { rows: [] };
      const { id, nome, email, perfil, pode_marcar_restrito, master_id } = u;
      return { rows: [{ id, nome, email, perfil, pode_marcar_restrito, master_id }] };
    }
    if (sql === 'UPDATE usuarios SET ultimo_acesso = NOW() WHERE id = $1') {
      const u = U.get(p[0]); if (u) u.ultimo_acesso = new Date();
      return { rows: [], rowCount: u ? 1 : 0 };
    }
    if (sql.startsWith('UPDATE usuarios SET senha_hash = $1, senha_temporaria = false, sessao_versao = sessao_versao + 1, ultimo_acesso = NOW() WHERE id = $2 AND senha_temporaria = true RETURNING id')) {
      const u = U.get(p[1]);
      if (!u || !u.senha_temporaria) return { rows: [] };
      Object.assign(u, { senha_hash: p[0], senha_temporaria: false, sessao_versao: u.sessao_versao + 1 });
      return { rows: [{ id: u.id }] };
    }
    if (sql === 'UPDATE usuarios SET senha_hash = $1, sessao_versao = sessao_versao + 1 WHERE id = $2 RETURNING sessao_versao') {
      const u = U.get(p[1]);
      if (!u) return { rows: [] };
      Object.assign(u, { senha_hash: p[0], sessao_versao: u.sessao_versao + 1 });
      return { rows: [{ sessao_versao: u.sessao_versao }] };
    }
    if (sql === 'UPDATE usuarios SET senha_hash = $1, senha_temporaria = true, sessao_versao = sessao_versao + 1 WHERE id = $2 RETURNING id') {
      const u = U.get(p[1]);
      if (!u) return { rows: [] };
      Object.assign(u, { senha_hash: p[0], senha_temporaria: true, sessao_versao: u.sessao_versao + 1 });
      return { rows: [{ id: u.id }] };
    }
    if (sql === Q.VERSAO) {
      const u = U.get(p[0]); if (u) u.sessao_versao += 1;
      return { rows: [], rowCount: u ? 1 : 0 };
    }
    // usuarios.js
    if (sql === 'SELECT id, nome, email, perfil, ativo, criado_em FROM usuarios WHERE id = $1') {
      const u = U.get(p[0]);
      if (!u) return { rows: [] };
      const { id, nome, email, perfil, ativo, criado_em } = u;
      return { rows: [{ id, nome, email, perfil, ativo, criado_em }] };
    }
    if (sql === 'UPDATE usuarios SET nome = $1, email = $2, ativo = $3 WHERE id = $4') {
      const u = U.get(p[3]); if (u) Object.assign(u, { nome: p[0], email: p[1], ativo: p[2] });
      return { rows: [], rowCount: u ? 1 : 0 };
    }
    // S-05 (G4): PATCH /usuarios/:id lê o alvo inteiro e grava também a marcação de aprovador.
    if (sql === 'SELECT id, nome, email, perfil, master_id, ativo, aprova_reprotocolo, criado_em FROM usuarios WHERE id = $1') {
      const u = U.get(p[0]);
      if (!u) return { rows: [] };
      const { id, nome, email, perfil, master_id, ativo, aprova_reprotocolo, criado_em } = u;
      return { rows: [{ id, nome, email, perfil, master_id, ativo, aprova_reprotocolo: aprova_reprotocolo ?? false, criado_em }] };
    }
    if (sql === 'UPDATE usuarios SET nome = $1, email = $2, ativo = $3, aprova_reprotocolo = $4 WHERE id = $5') {
      const u = U.get(p[4]); if (u) Object.assign(u, { nome: p[0], email: p[1], ativo: p[2], aprova_reprotocolo: p[3] });
      return { rows: [], rowCount: u ? 1 : 0 };
    }
    // S-05 (G4): redefinir senha confere a hierarquia lendo id, perfil e master_id do alvo.
    if (sql === 'SELECT id, perfil, master_id FROM usuarios WHERE id = $1') {
      const u = U.get(p[0]);
      return { rows: u ? [{ id: u.id, perfil: u.perfil, master_id: u.master_id }] : [] };
    }
    // S-13 / D-S3 (G5): usuário com qualquer linha na auditoria não é excluído.
    if (sql === 'SELECT 1 AS existe FROM logs_auditoria WHERE usuario_id = $1 LIMIT 1') {
      return { rows: banco.logs.some((l) => l.usuarioId === p[0]) ? [{ existe: 1 }] : [] };
    }
    if (sql === 'SELECT perfil FROM usuarios WHERE id = $1') {
      const u = U.get(p[0]);
      return { rows: u ? [{ perfil: u.perfil }] : [] };
    }
    if (sql.startsWith('INSERT INTO usuarios (nome, email, senha_hash, perfil, master_id, senha_temporaria)')) {
      const id = `00000000-0000-4000-8000-${String(U.size + 1).padStart(12, '0')}`;
      const nova = banco.adicionarUsuario({ id, nome: p[0], email: p[1], senha_hash: p[2], perfil: p[3], master_id: p[4], senha_temporaria: true });
      return { rows: [{ id: nova.id, nome: nova.nome, email: nova.email, perfil: nova.perfil, master_id: nova.master_id }] };
    }
    if (sql === 'SELECT id, nome, email, perfil, ativo FROM usuarios WHERE id = $1') {
      const u = U.get(p[0]);
      return { rows: u ? [{ id: u.id, nome: u.nome, email: u.email, perfil: u.perfil, ativo: u.ativo }] : [] };
    }
    // anulações de FK e limpezas da exclusão de usuário: sem efeito nos dados deste banco falso
    if (/^UPDATE \w+ SET \w+ = NULL WHERE \w+ = \$1$/.test(sql) || /^DELETE FROM (credenciais_tribunal|notas) WHERE \w+ = \$1$/.test(sql)) return { rows: [] };
    if (sql === 'DELETE FROM usuarios WHERE id = $1') {
      U.delete(p[0]);
      banco.sessoes = banco.sessoes.filter((s) => s.usuario_id !== p[0]); // ON DELETE CASCADE
      return { rows: [], rowCount: 1 };
    }

    // ── sessoes_refresh ──
    if (sql === Q.LINHA) {
      const l = banco.sessoes.find((s) => s.token_hash === p[0]);
      return { rows: l ? [{ ...l }] : [] };
    }
    if (sql === Q.INSERIR) { inserirSessao(p, { ignorarConflito: false }); return { rows: [], rowCount: 1 }; }
    if (sql === Q.ADOTAR) {
      const l = inserirSessao(p, { ignorarConflito: true });
      return { rows: l ? [{ id: l.id }] : [] };
    }
    if (sql === Q.USAR) {
      const l = banco.sessoes.find((s) => s.id === p[0] && !s.usado_em);
      if (!l) return { rows: [] };
      l.usado_em = p[1];
      return { rows: [{ id: l.id }] };
    }
    if (sql === Q.FAMILIA) {
      const da = banco.sessoes.filter((s) => s.familia === p[0]);
      return { rows: [{
        revogada: da.length ? da.some((s) => s.revogado_em) : null,
        familia_expira_em: da.length ? new Date(Math.max(...da.map((s) => new Date(s.familia_expira_em)))) : null,
      }] };
    }
    if (sql === Q.REV_FAM) {
      banco.sessoes.filter((s) => s.familia === p[0] && !s.revogado_em).forEach((s) => { s.revogado_em = p[1]; });
      return { rows: [] };
    }
    if (sql === Q.REV_USU) {
      banco.sessoes.filter((s) => s.usuario_id === p[0] && !s.revogado_em).forEach((s) => { s.revogado_em = p[1]; });
      return { rows: [] };
    }
    if (sql === Q.LIMPAR) {
      banco.sessoes = banco.sessoes.filter((s) => !(s.usuario_id === p[0] && new Date(s.expira_em) < new Date(p[1])));
      return { rows: [] };
    }

    // ── auditoria ──
    if (sql.startsWith('INSERT INTO logs_auditoria')) {
      banco.logs.push({ usuarioId: p[0], acao: p[1], entidade: p[2], entidadeId: p[3], valorAntes: p[4], valorDepois: p[5], ip: p[6] });
      return { rows: [] };
    }
    throw new Error(`SQL inesperado no banco falso: ${sql}`);
  }

  banco.instalar = (db) => {
    db.query = async (sql, p) => (await despachar(sql, p)).rows;
    db.queryOne = async (sql, p) => (await despachar(sql, p)).rows[0] ?? null;
    db.execute = async (sql, p) => despachar(sql, p);
    db.transaction = async (fn) => fn({ query: db.query, queryOne: db.queryOne, execute: db.execute });
  };
  return banco;
}
