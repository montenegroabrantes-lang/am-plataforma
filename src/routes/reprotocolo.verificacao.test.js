import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'segredo-de-teste';

const { db } = await import('../db/index.js');
for (const metodo of ['query', 'queryOne', 'execute']) {
  db[metodo] = async () => { throw new Error('banco real proibido nos testes'); };
}

const { autenticar } = await import('../middleware/auth.js');
const { criarReprotocoloRouter } = await import('./reprotocolo.js');
const { montarItem, SECAO_AGUARDANDO } = await import('../services/reprotocolo/levantamento.js');
const { avaliarCiclo, hashVerificacao, situacaoConfirmacao } = await import('../services/reprotocolo/verificacao.js');
const { ReferenciaEstadualError } = await import('../services/remuneracaoEstadual.js');
const { CONTA_SERVICO_EMAIL } = await import('../oauth/escopos.js');

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const T3 = '33333333-3333-4333-8333-333333333333';
const CLIENTE = '44444444-4444-4444-8444-444444444444';

function linha(extra = {}) {
  return {
    tarefa_id: T1, secao: SECAO_AGUARDANDO, subtipo: 'ciclo', ciclo_inicio: '2024-01-01', ciclo_adiado_ate: null,
    cliente_id: 'c-1', cliente_nome: 'MARIA DA SILVA', cliente_cpf: '52998224725', cliente_ativo: true, cliente_vinculo_ativo: true,
    cliente_vinculo_fim: null, cliente_cargo: 'PROFESSOR', cliente_orgao: 'SEC', tem_pasta_drive: true, produto_id: 'p', produto_nome: 'FGTS',
    intervalo_meses: 25, documentos_exigidos: null, polo_passivo: 'Município de João Pessoa', polo_processo: null,
    polo_vinculo_unico: 'Município de João Pessoa', polo_cliente: 'Município de João Pessoa', polo_padrao_tese: null, padrao_tese_opcoes: 0,
    qtd_vinculos_ativos: 1, qtd_vinculos: 1, vinculos_ativos: [], vinculo_tarefa_id: null, anterior_id: 'x',
    anterior_numero: '0800000-00.2022.8.15.2001', anterior_periodo_fim: '2023-12-01', anterior_status: 'ativo', anterior_vara: '1º Juizado',
    anterior_tribunal: 'TJPB', anterior_comarca: null, anterior_grau: '1', anterior_visibilidade: 'normal', cobrindo_qtd: 0, cobrindo_lista: [],
    processos_mesma_tese: 1, resp_proc_id: 'u', resp_proc_nome: 'João', resp_proc_ativo: true, ...extra,
  };
}
const PASTA = { status: 'unica', drive_pasta_id: 'pasta-1', titulo: 'MARIA X PMJP', pai: 'Outorgantes 2024', duplicidade: [] };
function resultado(extra, pasta = PASTA) {
  const it = montarItem(linha(extra), { hoje: '2026-09-28' });
  const av = avaliarCiclo(it, { pasta });
  const hash = hashVerificacao(it, av, { pasta });
  return { item: it, ...av, hash, pasta, oficial: null, salva: null, confirmacao: situacaoConfirmacao({ ...av, hash }, null) };
}
const RESULTADOS = [
  resultado({ tarefa_id: T1, cliente_id: CLIENTE }),                                            // confirmado
  resultado({ tarefa_id: T2, cliente_nome: 'ANA LIMA' }, { status: 'ambigua' }),                  // conferir
  resultado({ tarefa_id: T3, cliente_nome: 'JOSE SOUZA', ciclo_inicio: '2026-06-01' }),           // bloqueado (prazo)
];

const auditoria = [];
const chamadas = { confirmar: [], oficial: [], pasta: [] };
let respostaConferir = { ok: true, status: 'encontrado', correspondencia: 'unica', vinculos_encontrados: [] };
let erroPasta = null;

const app = express();
app.use(express.json());
app.use('/api/reprotocolo', autenticar, criarReprotocoloRouter({
  levantar: async () => { throw new Error('não usado'); },
  conferir: async () => { if (respostaConferir instanceof Error) throw respostaConferir; return respostaConferir; },
  auditar: async (r) => { auditoria.push(r); },
  limitador: (_q, _s, next) => next(),
  verificar: async () => ({ hoje: '2026-09-28', resultados: RESULTADOS }),
  confirmar: async (args) => { chamadas.confirmar.push(args); return args.pedidos.map(p => ({ tarefa_id: p.tarefaId, ok: p.tarefaId !== T2 })); },
  salvarOficial: async (_tx, id, conf) => { chamadas.oficial.push([id, conf.status]); return { status: conf.status }; },
  vincularPasta: async (_tx, dados) => { if (erroPasta) throw erroPasta; chamadas.pasta.push(dados); },
  transacao: async (fn) => fn('tx'),
  podeAprovar: (usuario) => usuario.id === 'm1',
  pacotes: { porTarefas: async () => [{ id: 'pac-1', tarefa_id: T1, status: 'montado', valor_causa: null, aprovado_em: null }] },
}));
app.use((err, _req, res, _next) => res.status(500).json({ ok: false, erro: err.message }));
const servidor = app.listen(0);
const base = `http://127.0.0.1:${servidor.address().port}`;
after(() => servidor.close());

const assinar = p => jwt.sign(p, process.env.JWT_SECRET, { expiresIn: '1h' });
const TOKENS = {
  master: assinar({ id: 'm1', perfil: 'master', email: 'master@exemplo.com' }),
  junior: assinar({ id: 'j1', perfil: 'junior', email: 'junior@exemplo.com' }),
  conectorLegado: assinar({ id: 'svc', perfil: 'master', email: CONTA_SERVICO_EMAIL }),
  conectorReprotocolo: assinar({ id: 'svc', perfil: 'master', email: CONTA_SERVICO_EMAIL, escopos: ['reprotocolo'] }),
};
async function chamar(metodo, caminho, token, corpo) {
  const r = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { status: r.status, corpo: await r.json() };
}

// ── leitura ──

test('GET /verificacao: sem token 401, júnior 403, conector legado (só acervo) 403', async () => {
  assert.equal((await chamar('GET', '/api/reprotocolo/verificacao')).status, 401);
  assert.equal((await chamar('GET', '/api/reprotocolo/verificacao', TOKENS.junior)).status, 403);
  assert.equal((await chamar('GET', '/api/reprotocolo/verificacao', TOKENS.conectorLegado)).status, 403);
});

test('GET /verificacao: Master e conector com escopo leem totais e itens, confirmados primeiro', async () => {
  for (const token of [TOKENS.master, TOKENS.conectorReprotocolo]) {
    const r = await chamar('GET', '/api/reprotocolo/verificacao', token);
    assert.equal(r.status, 200);
    assert.deepEqual(r.corpo.totais, { confirmado: 1, conferir: 1, bloqueado: 1, confirmadas_validas: 0, total: 3 });
    assert.deepEqual(r.corpo.itens.map(i => i.grupo), ['confirmado', 'conferir', 'bloqueado']);
    const bloqueado = r.corpo.itens[2];
    assert.equal(bloqueado.motivos[0].codigo, 'intervalo_incompleto');
    assert.equal(bloqueado.motivos[0].tipo, 'bloqueio');
  }
  assert.equal(auditoria.at(-1).acao, 'consultar_verificacao_reprotocolo');
  assert.equal(auditoria.at(-1).valorDepois.via_conector, true);
});

test('GET /verificacao: filtros e validações', async () => {
  assert.equal((await chamar('GET', '/api/reprotocolo/verificacao?grupo=conferir', TOKENS.master)).corpo.itens.length, 1);
  assert.equal((await chamar('GET', '/api/reprotocolo/verificacao?ente=joão pessoa', TOKENS.master)).corpo.total_filtrado, 3);
  assert.equal((await chamar('GET', '/api/reprotocolo/verificacao?ente=pernambuco', TOKENS.master)).corpo.total_filtrado, 0);
  assert.equal((await chamar('GET', '/api/reprotocolo/verificacao?limite=1&offset=1', TOKENS.master)).corpo.itens[0].grupo, 'conferir');
  assert.equal((await chamar('GET', '/api/reprotocolo/verificacao?grupo=xyz', TOKENS.master)).status, 400);
  assert.equal((await chamar('GET', '/api/reprotocolo/verificacao?limite=0', TOKENS.master)).status, 400);
  assert.equal((await chamar('GET', '/api/reprotocolo/verificacao?offset=-1', TOKENS.master)).status, 400);
});

test('GET /verificacao não expõe CPF completo', async () => {
  const r = await chamar('GET', '/api/reprotocolo/verificacao', TOKENS.master);
  assert.ok(!JSON.stringify(r.corpo).includes('52998224725'));
  assert.equal(r.corpo.itens[0].cliente.cpf_mascarado, '***.***.*47-25');
});

// ── escrita: só sessão do AM ──

test('POST /verificacao/confirmar: conector do chat NÃO escreve (403), júnior 403', async () => {
  const corpo = { tarefa_ids: [T1] };
  assert.equal((await chamar('POST', '/api/reprotocolo/verificacao/confirmar', TOKENS.conectorReprotocolo, corpo)).status, 403);
  assert.equal((await chamar('POST', '/api/reprotocolo/verificacao/confirmar', TOKENS.junior, corpo)).status, 403);
  assert.equal(chamadas.confirmar.length, 0);
});

test('POST /verificacao/confirmar: valida entrada e devolve o resultado de cada tarefa', async () => {
  const url = '/api/reprotocolo/verificacao/confirmar';
  assert.equal((await chamar('POST', url, TOKENS.master, { tarefa_ids: [] })).status, 400);
  assert.equal((await chamar('POST', url, TOKENS.master, { tarefa_ids: ['nao-e-uuid'] })).status, 400);
  assert.equal((await chamar('POST', url, TOKENS.master, { tarefa_ids: Array(201).fill(T1) })).status, 400);
  assert.equal((await chamar('POST', url, TOKENS.master, { tarefa_ids: [T1], motivos_aceitos: [] })).status, 400);
  const r = await chamar('POST', url, TOKENS.master, { tarefa_ids: [T1, T2], motivos_aceitos: { [T2]: ['pasta_ambigua'] }, observacao: 'Pasta conferida' });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.confirmadas, 1);
  assert.equal(r.corpo.recusadas, 1);
  const args = chamadas.confirmar.at(-1);
  assert.equal(args.usuarioId, 'm1');
  assert.deepEqual(args.pedidos, [{ tarefaId: T1, motivosAceitos: [] }, { tarefaId: T2, motivosAceitos: ['pasta_ambigua'] }]);
  assert.equal(auditoria.at(-1).acao, 'confirmar_verificacao_reprotocolo');
  assert.deepEqual(auditoria.at(-1).valorDepois.ids, [T1]);
});

test('POST /verificacao/:id/oficial: guarda o resumo; sem fonte oficial não guarda; erros da fonte viram 4xx/5xx', async () => {
  const url = `/api/reprotocolo/verificacao/${T1}/oficial`;
  assert.equal((await chamar('POST', url, TOKENS.conectorReprotocolo)).status, 403);
  assert.equal((await chamar('POST', '/api/reprotocolo/verificacao/x/oficial', TOKENS.master)).status, 400);
  const ok = await chamar('POST', url, TOKENS.master);
  assert.deepEqual(ok.corpo, { ok: true, guardado: true, status: 'encontrado' });
  assert.deepEqual(chamadas.oficial.at(-1), [T1, 'encontrado']);
  respostaConferir = { ok: true, status: 'sem_fonte_oficial', mensagem: 'Município sem fonte' };
  const sem = await chamar('POST', url, TOKENS.master);
  assert.equal(sem.corpo.guardado, false);
  assert.equal(chamadas.oficial.length, 1);
  respostaConferir = null;
  assert.equal((await chamar('POST', url, TOKENS.master)).status, 404);
  respostaConferir = new ReferenciaEstadualError('Fonte fora do ar', 503, 'fonte_indisponivel');
  assert.equal((await chamar('POST', url, TOKENS.master)).status, 503);
});

test('PUT /pasta-antiga/:clienteId: valida ids, vincula e audita; conector do chat 403; cliente inexistente 404', async () => {
  const url = `/api/reprotocolo/pasta-antiga/${CLIENTE}`;
  const corpo = { drive_pasta_id: '1S6IMMEkOnW2VbWAdweLbJMUAznwPQEBG', titulo: 'MARIA X PMJP', pai: 'Outorgantes 2025' };
  assert.equal((await chamar('PUT', url, TOKENS.conectorReprotocolo, corpo)).status, 403);
  assert.equal((await chamar('PUT', '/api/reprotocolo/pasta-antiga/x', TOKENS.master, corpo)).status, 400);
  assert.equal((await chamar('PUT', url, TOKENS.master, { ...corpo, drive_pasta_id: 'curto' })).status, 400);
  assert.equal((await chamar('PUT', url, TOKENS.master, { ...corpo, drive_pasta_id: 'com espaço e /barra ok' })).status, 400);
  assert.equal((await chamar('PUT', url, TOKENS.master, corpo)).status, 200);
  assert.deepEqual(chamadas.pasta.at(-1), { clienteId: CLIENTE, driveId: corpo.drive_pasta_id, titulo: corpo.titulo, pai: corpo.pai, usuarioId: 'm1', origem: 'manual' });
  assert.equal(auditoria.at(-1).acao, 'vincular_pasta_antiga_reprotocolo');
  erroPasta = Object.assign(new Error('fk'), { code: '23503' });
  assert.equal((await chamar('PUT', url, TOKENS.master, corpo)).status, 404);
  erroPasta = null;
});

test('GET /verificacao: traz o pacote ativo de cada ciclo e se o usuário pode aprovar', async () => {
  const r = await chamar('GET', '/api/reprotocolo/verificacao', TOKENS.master);
  assert.equal(r.corpo.pode_aprovar, true);
  const primeiro = r.corpo.itens.find(i => i.tarefa_id === T1);
  assert.deepEqual(primeiro.pacote, { id: 'pac-1', status: 'montado', valor_causa: null, aprovado_em: null });
  assert.equal(r.corpo.itens.find(i => i.tarefa_id === T2).pacote, null);
  assert.equal((await chamar('GET', '/api/reprotocolo/verificacao', TOKENS.conectorReprotocolo)).corpo.pode_aprovar, false);
});
