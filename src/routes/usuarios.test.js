// S-05 — hierarquia de Masters, redefinição de senha auditada e marcação do aprovador do re-protocolo.
// Sem banco: o db é um cadastro em memória que devolve o que cada consulta pede e registra o que é gravado.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import 'express-async-errors';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { definirCarregador, carregadorEcoDoToken } from '../middleware/sessao.js';
definirCarregador(carregadorEcoDoToken); // S-03: nestes testes a conta vale o que o token diz (sem banco)

process.env.JWT_SECRET = 'segredo-de-teste';

const { db } = await import('../db/index.js');

// ── cadastro fictício ────────────────────────────────────────────────────────────────────────
const M01 = '00000000-0000-4000-8000-000000000001'; // Master 01 (pode_marcar_restrito)
const M02 = '00000000-0000-4000-8000-000000000002'; // Master comum
const M03 = '00000000-0000-4000-8000-000000000003'; // outro Master comum
const J02 = '00000000-0000-4000-8000-0000000000a2'; // júnior do M02
const J03 = '00000000-0000-4000-8000-0000000000a3'; // júnior do M03
const INEXISTENTE = '00000000-0000-4000-8000-0000000000ff';

let usuarios, gravacoes, auditoria, colisaoDeEmail;
function reiniciar() {
  usuarios = new Map([
    [M01, { id: M01, nome: 'Master Um', email: 'um@exemplo.com', perfil: 'master', master_id: null, pode_marcar_restrito: true, ativo: true, aprova_reprotocolo: false }],
    [M02, { id: M02, nome: 'Master Dois', email: 'dois@exemplo.com', perfil: 'master', master_id: null, pode_marcar_restrito: false, ativo: true, aprova_reprotocolo: false }],
    [M03, { id: M03, nome: 'Master Tres', email: 'tres@exemplo.com', perfil: 'master', master_id: null, pode_marcar_restrito: false, ativo: true, aprova_reprotocolo: true }],
    [J02, { id: J02, nome: 'Junior Dois', email: 'j2@exemplo.com', perfil: 'junior', master_id: M02, pode_marcar_restrito: false, ativo: true, aprova_reprotocolo: false }],
    [J03, { id: J03, nome: 'Junior Tres', email: 'j3@exemplo.com', perfil: 'junior', master_id: M03, pode_marcar_restrito: false, ativo: true, aprova_reprotocolo: false }],
  ]);
  gravacoes = []; auditoria = []; colisaoDeEmail = false;
}
reiniciar();
const lerUsuario = (id) => (usuarios.has(id) ? { ...usuarios.get(id) } : null); // cópia, como o banco devolve uma linha nova

db.queryOne = async (sql, params) => {
  if (/SELECT id, nome, email, perfil, master_id, ativo, aprova_reprotocolo, criado_em FROM usuarios WHERE id/.test(sql)) return lerUsuario(params[0]);
  if (/SELECT id, perfil, master_id FROM usuarios WHERE id/.test(sql)) { const u = lerUsuario(params[0]); return u && { id: u.id, perfil: u.perfil, master_id: u.master_id }; }
  if (/SELECT id FROM usuarios WHERE id = \$1 AND perfil = 'master' AND ativo = true/.test(sql)) { const u = lerUsuario(params[0]); return u && u.perfil === 'master' && u.ativo ? { id: u.id } : null; }
  if (/SELECT id, nome, email, perfil, ativo FROM usuarios WHERE id/.test(sql)) return lerUsuario(params[0]);
  // S-03/S-04 (G7): redefinir a senha grava provisória, sobe a versão de sessão e devolve o id.
  if (/UPDATE usuarios SET senha_hash = \$1, senha_temporaria = true, sessao_versao = sessao_versao \+ 1 WHERE id = \$2 RETURNING id/.test(sql)) {
    if (!usuarios.has(params[1])) return null;
    gravacoes.push({ senha: { hash: params[0], id: params[1] } });
    return { id: params[1] };
  }
  throw new Error(`queryOne inesperada: ${sql.replace(/\s+/g, ' ').slice(0, 90)}`);
};
db.query = async (sql, params) => {
  if (/SELECT id, nome, email, perfil, master_id, pode_marcar_restrito/.test(sql)) { gravacoes.push({ leitura: sql }); return [...usuarios.values()]; }
  if (/INSERT INTO usuarios/.test(sql)) {
    if (colisaoDeEmail) { const e = new Error('duplicate key'); e.code = '23505'; throw e; }
    const [nome, email, senha_hash, perfil, master_id] = params;
    const novo = { id: '00000000-0000-4000-8000-0000000000b1', nome, email, perfil, master_id };
    gravacoes.push({ insert: { ...novo, senha_hash } });
    return [novo];
  }
  throw new Error(`query inesperada: ${sql.replace(/\s+/g, ' ').slice(0, 90)}`);
};
db.execute = async (sql, params) => {
  if (/INSERT INTO logs_auditoria/.test(sql)) { auditoria.push({ usuario_id: params[0], acao: params[1], entidade: params[2], entidade_id: params[3], valor_antes: params[4], valor_depois: params[5] }); return { rowCount: 1 }; }
  if (/UPDATE usuarios SET nome = \$1, email = \$2, ativo = \$3, aprova_reprotocolo = \$4 WHERE id = \$5/.test(sql)) {
    if (colisaoDeEmail) { const e = new Error('duplicate key'); e.code = '23505'; throw e; }
    const [nome, email, ativo, aprova, id] = params;
    Object.assign(usuarios.get(id), { nome, email, ativo, aprova_reprotocolo: aprova });
    gravacoes.push({ atualizou: { id, nome, email, ativo, aprova_reprotocolo: aprova } });
    return { rowCount: 1 };
  }
  if (/UPDATE usuarios SET senha_hash = \$1 WHERE id = \$2/.test(sql)) { gravacoes.push({ senha: { hash: params[0], id: params[1] } }); return { rowCount: 1 }; }
  // S-03 (G7): desativar/trocar e-mail derruba as sessões (sobe a versão e revoga os refresh).
  if (/UPDATE usuarios SET sessao_versao = sessao_versao \+ 1 WHERE id = \$1/.test(sql) || /UPDATE sessoes_refresh SET revogado_em/.test(sql)) return { rowCount: 1 };
  throw new Error(`execute inesperada: ${sql.replace(/\s+/g, ' ').slice(0, 90)}`);
};

const { autenticar } = await import('../middleware/auth.js');
const { usuariosRouter } = await import('./usuarios.js');
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req._ip = '127.0.0.1'; next(); });
app.use('/api/usuarios', autenticar, usuariosRouter);
app.use((err, _req, res, _next) => res.status(500).json({ ok: false, erro: err.message }));
const servidor = app.listen(0);
const base = `http://127.0.0.1:${servidor.address().port}`;
after(() => servidor.close());

const assinar = p => jwt.sign(p, process.env.JWT_SECRET, { expiresIn: '1h' });
const T = {
  m01: assinar({ id: M01, perfil: 'master', email: 'um@exemplo.com', pode_marcar_restrito: true }),
  m02: assinar({ id: M02, perfil: 'master', email: 'dois@exemplo.com', pode_marcar_restrito: false }),
  j02: assinar({ id: J02, perfil: 'junior', email: 'j2@exemplo.com', master_id: M02 }),
};
async function chamar(metodo, caminho, token, corpo) {
  const r = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await r.text();
  return { status: r.status, corpo: texto ? JSON.parse(texto) : null, texto };
}
beforeEach(reiniciar);
const escreveu = () => gravacoes.filter(g => !g.leitura);

// ───────────────────────────── PATCH /:id — hierarquia ─────────────────────────────
test('Master comum → 403 ao editar ou desativar outro Master e o Master 01; nada é gravado', async () => {
  for (const alvo of [M03, M01]) {
    assert.equal((await chamar('PATCH', `/api/usuarios/${alvo}`, T.m02, { nome: 'Outro Nome' })).status, 403, `editar ${alvo}`);
    assert.equal((await chamar('PATCH', `/api/usuarios/${alvo}`, T.m02, { ativo: false })).status, 403, `desativar ${alvo}`);
  }
  assert.equal(escreveu().length, 0);
  assert.equal(usuarios.get(M01).ativo, true);
});

test('Master comum: 200 nos próprios juniores; 403 no júnior de outro Master', async () => {
  const ok = await chamar('PATCH', `/api/usuarios/${J02}`, T.m02, { ativo: false });
  assert.equal(ok.status, 200);
  assert.equal(usuarios.get(J02).ativo, false);
  const negado = await chamar('PATCH', `/api/usuarios/${J03}`, T.m02, { ativo: false });
  assert.equal(negado.status, 403);
  assert.match(negado.corpo.erro, /próprios juniores/);
  assert.equal(usuarios.get(J03).ativo, true);
});

test('Master 01: 200 ao editar e desativar outro Master, e qualquer júnior', async () => {
  assert.equal((await chamar('PATCH', `/api/usuarios/${M03}`, T.m01, { ativo: false })).status, 200);
  assert.equal(usuarios.get(M03).ativo, false);
  assert.equal((await chamar('PATCH', `/api/usuarios/${J03}`, T.m01, { nome: 'Novo Nome' })).status, 200);
  assert.equal(usuarios.get(J03).nome, 'Novo Nome');
});

test('ninguém altera o próprio `ativo` (nem o Master 01); editar o próprio nome continua permitido', async () => {
  for (const [token, id] of [[T.m02, M02], [T.m01, M01]]) {
    const r = await chamar('PATCH', `/api/usuarios/${id}`, token, { ativo: false });
    assert.equal(r.status, 403);
    assert.equal(usuarios.get(id).ativo, true);
  }
  assert.equal(escreveu().length, 0);
  assert.equal((await chamar('PATCH', `/api/usuarios/${M02}`, T.m02, { nome: 'Nome Novo' })).status, 200);
  assert.equal((await chamar('PATCH', `/api/usuarios/${M02}`, T.m02, { ativo: true })).status, 200, 'mesmo valor não é alteração');
});

test('PATCH valida: ativo booleano, e-mail válido e normalizado, nome não vazio, id UUID, usuário existente, e-mail repetido', async () => {
  assert.equal((await chamar('PATCH', `/api/usuarios/${J02}`, T.m02, { ativo: 'false' })).status, 400);
  assert.equal((await chamar('PATCH', `/api/usuarios/${J02}`, T.m02, { ativo: 0 })).status, 400);
  assert.equal((await chamar('PATCH', `/api/usuarios/${J02}`, T.m02, { email: 'sem-arroba' })).status, 400);
  assert.equal((await chamar('PATCH', `/api/usuarios/${J02}`, T.m02, { email: { a: 1 } })).status, 400);
  assert.equal((await chamar('PATCH', `/api/usuarios/${J02}`, T.m02, { nome: '   ' })).status, 400);
  assert.equal((await chamar('PATCH', '/api/usuarios/nao-uuid', T.m02, { nome: 'x' })).status, 400);
  assert.equal((await chamar('PATCH', `/api/usuarios/${INEXISTENTE}`, T.m02, { nome: 'x' })).status, 404);
  assert.equal(escreveu().length, 0);

  assert.equal((await chamar('PATCH', `/api/usuarios/${J02}`, T.m02, { email: '  Novo.Email@Exemplo.COM ' })).status, 200);
  assert.equal(usuarios.get(J02).email, 'novo.email@exemplo.com');

  colisaoDeEmail = true;
  const dup = await chamar('PATCH', `/api/usuarios/${J02}`, T.m02, { email: 'tres@exemplo.com' });
  assert.equal(dup.status, 409, 'antes virava 500 cru do Postgres');
});

test('júnior não usa PATCH /usuarios/:id (403) e sem token é 401', async () => {
  assert.equal((await chamar('PATCH', `/api/usuarios/${J02}`, T.j02, { nome: 'x' })).status, 403);
  assert.equal((await chamar('PATCH', `/api/usuarios/${J02}`, null, { nome: 'x' })).status, 401);
  assert.equal(escreveu().length, 0);
});

// ───────────────────────────── PATCH /:id/senha ─────────────────────────────
test('redefinir senha: Master comum → 403 no Master e no Master 01 e no júnior de outro Master; 200 no próprio júnior', async () => {
  for (const alvo of [M03, M01, J03]) {
    assert.equal((await chamar('PATCH', `/api/usuarios/${alvo}/senha`, T.m02, { senha: 'senha-nova-123' })).status, 403, alvo);
  }
  assert.equal(escreveu().filter(g => g.senha).length, 0);
  assert.equal((await chamar('PATCH', `/api/usuarios/${J02}/senha`, T.m02, { senha: 'senha-nova-123' })).status, 200);
  assert.equal(escreveu().filter(g => g.senha).length, 1);
});

test('redefinir senha: Master 01 redefine a de qualquer usuário; a senha é gravada como hash bcrypt', async () => {
  for (const alvo of [M03, J03, J02]) assert.equal((await chamar('PATCH', `/api/usuarios/${alvo}/senha`, T.m01, { senha: 'outra-senha-456' })).status, 200);
  const g = escreveu().filter(x => x.senha);
  assert.equal(g.length, 3);
  assert.notEqual(g[0].senha.hash, 'outra-senha-456');
  assert.equal(await bcrypt.compare('outra-senha-456', g[0].senha.hash), true);
});

test('redefinir senha é AUDITADA sem o valor (nem a senha, nem o hash)', async () => {
  const senha = 'segredo-que-nao-pode-vazar-9';
  assert.equal((await chamar('PATCH', `/api/usuarios/${J02}/senha`, T.m02, { senha })).status, 200);
  const hash = escreveu().find(x => x.senha).senha.hash;
  const log = auditoria.find(a => a.acao === 'redefinir_senha');
  assert.ok(log, 'a ação redefinir_senha foi registrada');
  assert.equal(log.usuario_id, M02);
  assert.equal(log.entidade, 'usuario');
  assert.equal(log.entidade_id, J02);
  const tudo = JSON.stringify(auditoria);
  assert.ok(!tudo.includes(senha) && !tudo.includes(hash), 'a auditoria não pode conter a senha nem o hash');
});

test('redefinir senha recusada (403) não deixa registro de sucesso na auditoria', async () => {
  await chamar('PATCH', `/api/usuarios/${M03}/senha`, T.m02, { senha: 'senha-nova-123' });
  assert.equal(auditoria.filter(a => a.acao === 'redefinir_senha').length, 0);
});

test('redefinir senha valida: mínimo 8 caracteres e texto, id UUID e usuário existente (antes: ok mudo)', async () => {
  assert.equal((await chamar('PATCH', `/api/usuarios/${J02}/senha`, T.m02, { senha: 'curta' })).status, 400);
  assert.equal((await chamar('PATCH', `/api/usuarios/${J02}/senha`, T.m02, { senha: 12345678 })).status, 400);
  assert.equal((await chamar('PATCH', `/api/usuarios/${J02}/senha`, T.m02, {})).status, 400);
  assert.equal((await chamar('PATCH', '/api/usuarios/nao-uuid/senha', T.m02, { senha: 'senha-nova-123' })).status, 400);
  assert.equal((await chamar('PATCH', `/api/usuarios/${INEXISTENTE}/senha`, T.m02, { senha: 'senha-nova-123' })).status, 404);
  assert.equal(escreveu().length, 0);
});

// ───────────────────────────── POST / ─────────────────────────────
const novoBase = { nome: 'Pessoa Nova', email: 'Nova@Exemplo.com', senha: 'senha-inicial-1' };
test('criar usuário: Master comum → 403 ao criar Master; 403 ao criar júnior de outro Master; 201 no próprio júnior', async () => {
  assert.equal((await chamar('POST', '/api/usuarios', T.m02, { ...novoBase, perfil: 'master' })).status, 403);
  assert.equal((await chamar('POST', '/api/usuarios', T.m02, { ...novoBase, perfil: 'junior', master_id: M03 })).status, 403);
  assert.equal((await chamar('POST', '/api/usuarios', T.m02, { ...novoBase, perfil: 'junior', master_id: M01 })).status, 403);
  assert.equal(escreveu().length, 0);
  const ok = await chamar('POST', '/api/usuarios', T.m02, { ...novoBase, perfil: 'junior', master_id: M02 });
  assert.equal(ok.status, 201);
  const ins = escreveu().find(g => g.insert).insert;
  assert.equal(ins.master_id, M02);
  assert.equal(ins.email, 'nova@exemplo.com');
  assert.equal(ins.perfil, 'junior');
});

test('criar usuário: Master 01 cria Master (sem master_id) e júnior de qualquer Master ativo', async () => {
  const m = await chamar('POST', '/api/usuarios', T.m01, { ...novoBase, perfil: 'master', master_id: M03 });
  assert.equal(m.status, 201);
  assert.equal(escreveu().find(g => g.insert).insert.master_id, null, 'Master não tem master_id');
  const j = await chamar('POST', '/api/usuarios', T.m01, { ...novoBase, perfil: 'junior', master_id: M03 });
  assert.equal(j.status, 201);
});

test('criar usuário valida: master_id UUID de um Master ativo, e-mail, campos obrigatórios e perfil; júnior não cria', async () => {
  assert.equal((await chamar('POST', '/api/usuarios', T.m01, { ...novoBase, perfil: 'junior', master_id: 'nao-uuid' })).status, 400);
  assert.equal((await chamar('POST', '/api/usuarios', T.m01, { ...novoBase, perfil: 'junior', master_id: INEXISTENTE })).status, 400);
  assert.equal((await chamar('POST', '/api/usuarios', T.m01, { ...novoBase, perfil: 'junior', master_id: J02 })).status, 400, 'júnior não pode ser o responsável');
  usuarios.get(M03).ativo = false;
  assert.equal((await chamar('POST', '/api/usuarios', T.m01, { ...novoBase, perfil: 'junior', master_id: M03 })).status, 400, 'Master inativo');
  assert.equal((await chamar('POST', '/api/usuarios', T.m02, { ...novoBase, email: 'sem-arroba', perfil: 'junior', master_id: M02 })).status, 400);
  assert.equal((await chamar('POST', '/api/usuarios', T.m02, { ...novoBase, perfil: 'junior' })).status, 400);
  assert.equal((await chamar('POST', '/api/usuarios', T.m02, { ...novoBase, perfil: 'admin' })).status, 400);
  assert.equal((await chamar('POST', '/api/usuarios', T.m02, { ...novoBase, senha: 12345678, perfil: 'junior', master_id: M02 })).status, 400);
  assert.equal((await chamar('POST', '/api/usuarios', T.j02, { ...novoBase, perfil: 'junior', master_id: M02 })).status, 403);
  assert.equal(escreveu().length, 0);
  colisaoDeEmail = true;
  assert.equal((await chamar('POST', '/api/usuarios', T.m02, { ...novoBase, perfil: 'junior', master_id: M02 })).status, 409);
});

// ───────────────────────────── aprova_reprotocolo (D-S4) ─────────────────────────────
test('aprova_reprotocolo: só o Master 01 marca; Master comum recebe 403 (inclusive em si e nos próprios juniores)', async () => {
  for (const alvo of [M02, J02, M03]) {
    const r = await chamar('PATCH', `/api/usuarios/${alvo}`, T.m02, { aprova_reprotocolo: true });
    assert.equal(r.status, 403, alvo);
  }
  assert.equal(escreveu().length, 0);
  assert.equal(usuarios.get(M02).aprova_reprotocolo, false);
});

test('aprova_reprotocolo: Master 01 marca e desmarca outro Master; a mudança é auditada (antes/depois)', async () => {
  assert.equal((await chamar('PATCH', `/api/usuarios/${M02}`, T.m01, { aprova_reprotocolo: true })).status, 200);
  assert.equal(usuarios.get(M02).aprova_reprotocolo, true);
  const log = auditoria.find(a => a.acao === 'definir_aprovador_reprotocolo');
  assert.ok(log);
  assert.equal(log.usuario_id, M01);
  assert.equal(log.entidade_id, M02);
  assert.deepEqual(JSON.parse(log.valor_antes), { aprova_reprotocolo: false });
  assert.deepEqual(JSON.parse(log.valor_depois), { aprova_reprotocolo: true });

  assert.equal((await chamar('PATCH', `/api/usuarios/${M03}`, T.m01, { aprova_reprotocolo: false })).status, 200);
  assert.equal(usuarios.get(M03).aprova_reprotocolo, false);
});

test('aprova_reprotocolo: só Master ativo pode ser marcado; valor precisa ser booleano; editar outro campo não altera a marcação', async () => {
  assert.equal((await chamar('PATCH', `/api/usuarios/${J02}`, T.m01, { aprova_reprotocolo: true })).status, 400, 'júnior');
  assert.equal((await chamar('PATCH', `/api/usuarios/${M02}`, T.m01, { aprova_reprotocolo: true, ativo: false })).status, 400, 'desativando no mesmo pedido');
  usuarios.get(M02).ativo = false;
  assert.equal((await chamar('PATCH', `/api/usuarios/${M02}`, T.m01, { aprova_reprotocolo: true })).status, 400, 'inativo');
  usuarios.get(M02).ativo = true;
  assert.equal((await chamar('PATCH', `/api/usuarios/${M02}`, T.m01, { aprova_reprotocolo: 'sim' })).status, 400);
  assert.equal(escreveu().length, 0);

  assert.equal((await chamar('PATCH', `/api/usuarios/${M03}`, T.m01, { nome: 'Outro Nome' })).status, 200);
  assert.equal(usuarios.get(M03).aprova_reprotocolo, true, 'a marcação de quem já aprovava é preservada');
  assert.equal(auditoria.filter(a => a.acao === 'definir_aprovador_reprotocolo').length, 0);
});

// ───────────────────────────── listagem e exclusão ─────────────────────────────
test('GET /usuarios: só o Master 01 recebe a coluna aprova_reprotocolo', async () => {
  await chamar('GET', '/api/usuarios', T.m01);
  assert.match(gravacoes.find(g => g.leitura).leitura, /aprova_reprotocolo/);
  gravacoes.length = 0;
  await chamar('GET', '/api/usuarios', T.m02);
  assert.doesNotMatch(gravacoes.find(g => g.leitura).leitura, /aprova_reprotocolo/);
});

test('DELETE /usuarios/:id continua só do Master 01 (regressão)', async () => {
  assert.equal((await chamar('DELETE', `/api/usuarios/${J02}`, T.m02)).status, 403);
  assert.equal((await chamar('DELETE', `/api/usuarios/${J02}`, T.j02)).status, 403);
});
