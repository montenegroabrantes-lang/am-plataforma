import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'segredo-de-teste';

const { db } = await import('../db/index.js');
// Guarda: nada aqui pode tocar o banco real.
for (const metodo of ['query', 'queryOne', 'execute']) {
  db[metodo] = async () => { throw new Error('banco real proibido nos testes'); };
}

const { autenticar } = await import('../middleware/auth.js');
const { definirCarregador, carregadorEcoDoToken } = await import('../middleware/sessao.js');
definirCarregador(carregadorEcoDoToken); // S-03: a conta é a que o token diz (sessão revogável testada em auth.test.js)
const { criarReprotocoloRouter } = await import('./reprotocolo.js');
const { levantarReprotocolo, SQL_HOJE, SQL_ADIADOS, SQL_DOCUMENTOS, SECAO_AGUARDANDO } = await import('../services/reprotocolo/levantamento.js');
const { ReferenciaEstadualError } = await import('../services/remuneracaoEstadual.js');
const { CONTA_SERVICO_EMAIL } = await import('../oauth/escopos.js');

const TAREFA = '11111111-1111-4111-8111-111111111111';
const CPF = '52998224725';

// Banco simulado com um item de "Novos ciclos" (Estado da Paraíba).
const bancoFalso = {
  async queryOne(sql) {
    if (sql === SQL_HOJE) return { hoje: '2026-09-28' };
    if (sql === SQL_ADIADOS) return { adiados: 0 };
    throw new Error('inesperado');
  },
  async query(sql) {
    if (sql === SQL_DOCUMENTOS) return [];
    return [{
      tarefa_id: TAREFA, secao: SECAO_AGUARDANDO, ciclo_inicio: '2024-01-01', cliente_id: 'c-1',
      cliente_nome: 'MARIA DA SILVA', cliente_cpf: CPF, cliente_ativo: true, cliente_vinculo_ativo: true,
      tem_pasta_drive: true, produto_id: 'p', produto_nome: 'FGTS', intervalo_meses: 25,
      polo_passivo: 'Estado da Paraíba', polo_vinculo_unico: 'Estado da Paraíba', qtd_vinculos_ativos: 1, qtd_vinculos: 1,
      anterior_id: 'x', anterior_numero: '0800000-00.2022.8.15.2001', anterior_periodo_fim: '2023-12-01',
      anterior_status: 'ativo', anterior_vara: '1º Juizado', anterior_tribunal: 'TJPB', anterior_visibilidade: 'normal',
      cobrindo_qtd: 0, resp_proc_id: 'u', resp_proc_nome: 'João', resp_proc_ativo: true,
    }];
  },
};

const auditoria = [];
const chamadasLevantar = [];
let respostaConferir = { ok: true, status: 'sem_fonte_oficial' };

const app = express();
app.use('/api/reprotocolo', autenticar, criarReprotocoloRouter({
  levantar: async (opcoes) => { chamadasLevantar.push(opcoes); return levantarReprotocolo({ ...opcoes, conexao: bancoFalso }); },
  conferir: async () => { if (respostaConferir instanceof Error) throw respostaConferir; return respostaConferir; },
  auditar: async (registro) => { auditoria.push(registro); },
  limitador: (_req, _res, next) => next(),
}));
// Áreas vizinhas, para conferir o confinamento dos tokens do conector.
app.use('/api/tarefas', autenticar, (_req, res) => res.json({ ok: true, area: 'tarefas' }));
app.use('/api/acervo', autenticar, (_req, res) => res.json({ ok: true, area: 'acervo' }));
app.use((err, _req, res, _next) => res.status(500).json({ ok: false, erro: err.message }));

const servidor = app.listen(0);
const base = `http://127.0.0.1:${servidor.address().port}`;
after(() => servidor.close());

const assinar = payload => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
const TOKENS = {
  master: assinar({ id: 'm1', perfil: 'master', email: 'master@exemplo.com' }),
  master01: assinar({ id: 'm0', perfil: 'master', email: 'dono@exemplo.com', pode_marcar_restrito: true }),
  junior: assinar({ id: 'j1', perfil: 'junior', email: 'junior@exemplo.com' }),
  conectorLegado: assinar({ id: 'svc', perfil: 'master', email: CONTA_SERVICO_EMAIL }),
  conectorAcervo: assinar({ id: 'svc', perfil: 'master', email: CONTA_SERVICO_EMAIL, escopos: ['acervo'] }),
  conectorReprotocolo: assinar({ id: 'svc', perfil: 'master', email: CONTA_SERVICO_EMAIL, escopos: ['reprotocolo'] }),
  conectorJuniorComEscopo: assinar({ id: 'x', perfil: 'junior', escopos: ['reprotocolo'] }),
};

async function get(caminho, token) {
  const r = await fetch(`${base}${caminho}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: r.status, corpo: await r.json() };
}

test('sem token ou token inválido → 401', async () => {
  assert.equal((await get('/api/reprotocolo/levantamento')).status, 401);
  assert.equal((await get(`/api/reprotocolo/${TAREFA}/vinculo-oficial`)).status, 401);
  assert.equal((await get('/api/reprotocolo/levantamento', 'lixo.invalido.token')).status, 401);
  const outraChave = jwt.sign({ id: 'm1', perfil: 'master' }, 'outra-chave');
  assert.equal((await get('/api/reprotocolo/levantamento', outraChave)).status, 401);
});

test('não-Master → 403, mesmo com escopo de conector', async () => {
  assert.equal((await get('/api/reprotocolo/levantamento', TOKENS.junior)).status, 403);
  assert.equal((await get(`/api/reprotocolo/${TAREFA}/vinculo-oficial`, TOKENS.junior)).status, 403);
  assert.equal((await get('/api/reprotocolo/levantamento', TOKENS.conectorJuniorComEscopo)).status, 403);
});

test('Master (sessão do AM) → 200, com CPF mascarado e consulta auditada', async () => {
  const { status, corpo } = await get('/api/reprotocolo/levantamento?detalhe=itens', TOKENS.master);
  assert.equal(status, 200);
  assert.equal(corpo.somente_leitura, true);
  assert.equal(corpo.aguardando_autorizacao.total, 1);
  const item = corpo.aguardando_autorizacao.grupos[0].itens[0];
  assert.equal(item.cliente.cpf_mascarado, '***.***.*47-25');
  assert.equal(JSON.stringify(corpo).includes(CPF), false);
  assert.equal(chamadasLevantar.at(-1).podeVerRestrito, false);
  const registro = auditoria.at(-1);
  assert.equal(registro.acao, 'consultar_levantamento_reprotocolo');
  assert.equal(registro.usuarioId, 'm1');
  assert.equal(registro.valorDepois.via_conector, false);

  await get('/api/reprotocolo/levantamento', TOKENS.master01);
  assert.equal(chamadasLevantar.at(-1).podeVerRestrito, true, 'Master 01 vê processo restrito');
});

test('conector: token antigo (sem escopos) → 401 (S-18); token só "acervo" → 403; token "reprotocolo" → 200', async () => {
  const legado = await get('/api/reprotocolo/levantamento', TOKENS.conectorLegado);
  assert.equal(legado.status, 401);
  assert.match(legado.corpo.erro, /reconecte o conector/i);

  const acervo = await get('/api/reprotocolo/levantamento', TOKENS.conectorAcervo);
  assert.equal(acervo.status, 403);

  const ok = await get('/api/reprotocolo/levantamento?detalhe=resumo', TOKENS.conectorReprotocolo);
  assert.equal(ok.status, 200);
  assert.equal(auditoria.at(-1).valorDepois.via_conector, true);
});

test('token do conector com escopos fica confinado às áreas dos escopos', async () => {
  assert.equal((await get('/api/tarefas', TOKENS.conectorReprotocolo)).status, 403);
  assert.equal((await get('/api/acervo', TOKENS.conectorReprotocolo)).status, 403);
  assert.equal((await get('/api/acervo', TOKENS.conectorAcervo)).status, 200);
  assert.equal((await get('/api/tarefas', TOKENS.conectorAcervo)).status, 403);
  // Sessões normais do AM não mudam.
  assert.equal((await get('/api/tarefas', TOKENS.master)).status, 200);
  assert.equal((await get('/api/tarefas', TOKENS.junior)).status, 200);
});

test('parâmetros inválidos → 400', async () => {
  assert.equal((await get('/api/reprotocolo/levantamento?secao=xyz', TOKENS.master)).status, 400);
  assert.equal((await get('/api/reprotocolo/levantamento?detalhe=tudo', TOKENS.master)).status, 400);
  assert.equal((await get('/api/reprotocolo/levantamento?limite=0', TOKENS.master)).status, 400);
  assert.equal((await get('/api/reprotocolo/levantamento?limite=501', TOKENS.master)).status, 400);
  assert.equal((await get('/api/reprotocolo/nao-e-uuid/vinculo-oficial', TOKENS.master)).status, 400);
});

test('vínculo oficial: 404 fora das filas, 502 com fonte fora do ar, 200 auditado', async () => {
  respostaConferir = null;
  assert.equal((await get(`/api/reprotocolo/${TAREFA}/vinculo-oficial`, TOKENS.master)).status, 404);

  respostaConferir = new ReferenciaEstadualError('fora do ar', 502, 'fonte_oficial_indisponivel');
  const fora = await get(`/api/reprotocolo/${TAREFA}/vinculo-oficial`, TOKENS.master);
  assert.equal(fora.status, 502);
  assert.equal(fora.corpo.codigo, 'fonte_oficial_indisponivel');

  respostaConferir = { ok: true, status: 'encontrado', uf: 'PB' };
  const ok = await get(`/api/reprotocolo/${TAREFA}/vinculo-oficial`, TOKENS.conectorReprotocolo);
  assert.equal(ok.status, 200);
  const registro = auditoria.at(-1);
  assert.equal(registro.acao, 'conferir_vinculo_oficial');
  assert.equal(registro.entidadeId, TAREFA);
  assert.deepEqual(registro.valorDepois, { status: 'encontrado', uf: 'PB', via_conector: true, autorizado_por: null });
});
