// S-27 (Onda 9, decisão D6): matriz do perfil júnior. Uma linha por regra, sempre com o Master
// ao lado provando que continua fazendo tudo. Nenhum teste toca o banco: `db` é um dublê que
// falha em qualquer consulta que o teste não tenha declarado.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import 'express-async-errors';
import jwt from 'jsonwebtoken';
import { definirCarregador, carregadorEcoDoToken } from '../middleware/sessao.js';
definirCarregador(carregadorEcoDoToken); // S-03: nestes testes a conta vale o que o token diz (sem banco)

process.env.JWT_SECRET = 'segredo-de-teste';
process.env.ENCRYPTION_KEY = 'ab'.repeat(32);
// Sem token do Google o serviço de Calendar retorna na hora: nenhum teste sai para a rede.
delete process.env.GOOGLE_REFRESH_TOKEN;

const { db } = await import('../db/index.js');
let consultas = [];
let regras = [];
const quando = (tipo, padrao, resposta) => regras.push({ tipo, padrao, resposta });
const REGRAS_DE_APOIO = [
  { tipo: 'execute', padrao: /INSERT INTO logs_auditoria/, resposta: { rowCount: 1 } },
  { tipo: 'queryOne', padrao: /^\s*SELECT (vara, notas|vara|notas|urgente|nome, whatsapp, email|ativo|resultado) FROM (processos|clientes|audiencias) WHERE id = \$1/, resposta: {} },
];
const responder = (tipo) => async (sql, params = []) => {
  consultas.push({ tipo, sql, params });
  // Leituras de apoio da auditoria (S-13: estado anterior de quem muda) e gravação do log: respostas neutras quando o
  // teste não define uma regra própria. As regras do teste têm prioridade.
  const regra = regras.find(r => r.tipo === tipo && r.padrao.test(sql)) || REGRAS_DE_APOIO.find(r => r.tipo === tipo && r.padrao.test(sql));
  if (!regra) throw new Error(`consulta inesperada (${tipo}): ${sql.replace(/\s+/g, ' ').slice(0, 180)}`);
  return typeof regra.resposta === 'function' ? regra.resposta(sql, params) : regra.resposta;
};
db.query = responder('query');
db.queryOne = responder('queryOne');
db.execute = responder('execute');
db.pool = { connect: async () => { throw new Error('transação proibida nos testes'); } };

const { autenticar } = await import('../middleware/auth.js');
const {
  mascararCpf, mascararCpfNoCorpo, condicaoBuscaCpf, protegerDadosDoJunior,
} = await import('../middleware/perfilJunior.js');
const { encrypt } = await import('../utils/crypto.js');
const { clientesRouter } = await import('./clientes.js');
const { processosRouter } = await import('./processos.js');
const { tarefasRouter } = await import('./tarefas.js');
const { triagemRouter } = await import('./triagem.js');
const { estimativasRouter } = await import('./estimativas.js');

const app = express();
app.use(express.json());
app.use('/api/clientes', autenticar, clientesRouter);
app.use('/api/processos', autenticar, processosRouter);
app.use('/api/tarefas', autenticar, tarefasRouter);
app.use('/api/estimativas', autenticar, estimativasRouter);
app.use((err, _req, res, _next) => res.status(500).json({ ok: false, erro: err.message }));
const servidor = app.listen(0);
const base = `http://127.0.0.1:${servidor.address().port}`;
after(async () => {
  servidor.close();
  // O teste do protocolo completo importa o sync, que abre um cliente Redis (localhost) que fica
  // reconectando sozinho e seguraria o processo; sem Redis aqui, é só fechar.
  const { redis } = await import('../cache/redis.js');
  redis.disconnect();
});

const assinar = payload => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
const MASTER = assinar({ id: 'm1', perfil: 'master', email: 'master@exemplo.com' });
const JUNIOR = assinar({ id: 'j1', perfil: 'junior', email: 'junior@exemplo.com', master_id: 'm1' });

const CLIENTE = '22222222-2222-4222-8222-222222222222';
const PROC = '11111111-1111-4111-8111-111111111111';
const PROC_B = '33333333-3333-4333-8333-333333333333';
const TAREFA = '44444444-4444-4444-8444-444444444444';
const CPF = '52998224725';
const CPF_MASCARADO = '***.982.247-**';

async function chamar(metodo, caminho, { token, corpo } = {}) {
  const r = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
  });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* CSV e texto puro */ }
  return { status: r.status, corpo: json, texto, cabecalhos: r.headers };
}

const sqls = (tipo) => consultas.filter(c => c.tipo === tipo).map(c => c.sql);
const houveUpdate = (tabela) => consultas.some(c => c.tipo === 'execute' && new RegExp(`^\\s*UPDATE ${tabela} SET`).test(c.sql));
const ultimoUpdate = (tabela) => consultas.filter(c => c.tipo === 'execute' && new RegExp(`^\\s*UPDATE ${tabela} SET`).test(c.sql)).at(-1);
const consultouTarefas = () => consultas.some(c => /FROM tarefas\s+WHERE/.test(c.sql) || /SELECT DISTINCT processo_id FROM tarefas/.test(c.sql));

beforeEach(() => { consultas = []; regras = []; });

// ── Utilitários puros ────────────────────────────────────────────────────────

test('mascararCpf: mesma máscara de Tarefas, idempotente e sem vazar dígitos', () => {
  assert.equal(mascararCpf(CPF), CPF_MASCARADO);
  assert.equal(mascararCpf('529.982.247-25'), CPF_MASCARADO);
  assert.equal(mascararCpf(CPF_MASCARADO), CPF_MASCARADO);
  assert.equal(mascararCpf(null), null);
  assert.equal(mascararCpf(''), '');
  assert.equal(mascararCpf('123'), '***', 'valor que não é CPF some por inteiro');
  assert.ok(!mascararCpf(CPF).includes('529'), 'primeiros 3 dígitos escondidos');
  assert.ok(!mascararCpf(CPF).endsWith('25'), 'últimos 2 dígitos escondidos');
});

test('mascararCpfNoCorpo: em qualquer profundidade, só nas chaves de CPF, sem estragar datas nem booleanos', () => {
  const data = new Date('2026-09-30T12:00:00Z');
  const saida = mascararCpfNoCorpo({
    ok: true,
    cliente: { nome: 'Maria', cpf: CPF, whatsapp: '83999990000', criado_em: data },
    tarefas: [{ cliente_cpf: CPF, dados: { cpf: CPF } }, { cliente_cpf: null }],
    documentos_recebidos: { cpf: true, identidade: false },
    cpf_mascarado: '***.***.*72-25',
    numero: '0800000-00.2026.8.15.2001',
  });
  assert.equal(saida.cliente.cpf, CPF_MASCARADO);
  assert.equal(saida.cliente.whatsapp, '83999990000');
  assert.ok(saida.cliente.criado_em instanceof Date);
  assert.equal(saida.tarefas[0].cliente_cpf, CPF_MASCARADO);
  assert.equal(saida.tarefas[0].dados.cpf, CPF_MASCARADO);
  assert.equal(saida.tarefas[1].cliente_cpf, null);
  assert.deepEqual(saida.documentos_recebidos, { cpf: true, identidade: false });
  assert.equal(saida.cpf_mascarado, '***.***.*72-25');
  assert.equal(saida.numero, '0800000-00.2026.8.15.2001');
});

test('condicaoBuscaCpf: Master igual ao de sempre; júnior só com o CPF inteiro', () => {
  const master = { user: { perfil: 'master' } };
  const junior = { user: { perfil: 'junior' } };

  let params = [];
  assert.equal(condicaoBuscaCpf(master, '52998', params), '', 'menos de 6 dígitos: sem condição');
  assert.deepEqual(params, []);

  params = [];
  const cond = condicaoBuscaCpf(master, '529982', params);
  assert.match(cond, /REGEXP_REPLACE\(c\.cpf,'\[\^0-9\]','','g'\) ILIKE \$1$/);
  assert.deepEqual(params, ['%529982%']);

  params = [];
  assert.equal(condicaoBuscaCpf(junior, '529982', params), '', 'júnior: trecho parcial não busca por CPF');
  assert.deepEqual(params, []);
  assert.equal(condicaoBuscaCpf(junior, '5299822472', params), '', '10 dígitos ainda é parcial');

  params = ['x'];
  const exata = condicaoBuscaCpf(junior, CPF, params);
  assert.match(exata, /\) = \$2$/);
  assert.deepEqual(params, ['x', CPF]);

  assert.equal(condicaoBuscaCpf({}, CPF, []).includes('='), true, 'sem usuário = tratado como júnior (falha fechada)');
});

test('os 4 routers que devolvem CPF usam o protetor do júnior (remover a linha derruba este teste)', () => {
  for (const [nome, router] of Object.entries({ clientesRouter, processosRouter, tarefasRouter, triagemRouter })) {
    // (o express-async-errors embrulha `handle`; o nome da camada é o da função original)
    assert.ok(router.stack.some(camada => camada.name === protegerDadosDoJunior.name), `${nome} sem protegerDadosDoJunior`);
  }
});

// ── Clientes: CPF mascarado, sem anotações, sem `ativo` ──────────────────────

const linhaCliente = { id: CLIENTE, nome: 'MARIA DA SILVA', cpf: CPF, whatsapp: '83999990000', email: 'maria@exemplo.com' };

test('clientes: lista com CPF mascarado para o júnior e completo para o Master', async () => {
  quando('query', /SELECT COUNT\(\*\) AS total FROM clientes c/, [{ total: '1' }]);
  quando('query', /SELECT c\.id, c\.nome, c\.cpf/, [{ ...linhaCliente, total_processos: '2' }]);

  const j = await chamar('GET', '/api/clientes', { token: JUNIOR });
  assert.equal(j.status, 200);
  assert.equal(j.corpo.clientes[0].cpf, CPF_MASCARADO);
  assert.ok(!j.texto.includes(CPF), 'o CPF cru não pode aparecer em lugar nenhum da resposta');
  assert.equal(j.corpo.clientes[0].whatsapp, '83999990000', 'WhatsApp segue visível (trabalho diário)');
  assert.equal(j.corpo.clientes[0].email, 'maria@exemplo.com');

  const m = await chamar('GET', '/api/clientes', { token: MASTER });
  assert.equal(m.corpo.clientes[0].cpf, CPF);
});

test('clientes: busca por trecho do CPF só funciona para o Master; o júnior busca pelo CPF inteiro', async () => {
  quando('query', /SELECT COUNT\(\*\) AS total FROM clientes c/, [{ total: '0' }]);
  quando('query', /SELECT c\.id, c\.nome, c\.cpf/, []);

  await chamar('GET', '/api/clientes?busca=529982', { token: JUNIOR });
  assert.ok(sqls('query').every(s => !/REGEXP_REPLACE\(c\.cpf/.test(s)), 'júnior + trecho parcial: nada de busca por CPF');

  consultas = [];
  await chamar('GET', '/api/clientes?busca=529982', { token: MASTER });
  assert.ok(sqls('query').some(s => /REGEXP_REPLACE\(c\.cpf.*ILIKE/.test(s)), 'Master: busca parcial igual à de antes');

  consultas = [];
  await chamar('GET', `/api/clientes?busca=${CPF}`, { token: JUNIOR });
  const contagem = consultas.find(c => /SELECT COUNT/.test(c.sql));
  assert.match(contagem.sql, /REGEXP_REPLACE\(c\.cpf,'\[\^0-9\]','','g'\) = \$2/);
  // (o array de parâmetros é o mesmo da consulta seguinte, que acrescenta limite e offset)
  assert.deepEqual(contagem.params.slice(0, 2), [`%${CPF}%`, CPF]);
});

test('clientes: ficha sem anotações e com CPF mascarado para o júnior; Master lê tudo', async () => {
  const segredo = 'portal do contracheque: usuario 000 senha 123';
  quando('queryOne', /FROM clientes c\s+LEFT JOIN usuarios u/, () => ({ ...linhaCliente, anotacoes_enc: encrypt(segredo) }));
  quando('query', /./, []);

  const j = await chamar('GET', `/api/clientes/${CLIENTE}`, { token: JUNIOR });
  assert.equal(j.status, 200);
  assert.equal(j.corpo.cliente.anotacoes, null);
  assert.equal(j.corpo.cliente.cpf, CPF_MASCARADO);
  assert.ok(!j.texto.includes('senha 123') && !j.texto.includes('gcm:'), 'nem texto aberto nem o blob cifrado');
  assert.ok(!('anotacoes_enc' in j.corpo.cliente));

  const m = await chamar('GET', `/api/clientes/${CLIENTE}`, { token: MASTER });
  assert.equal(m.corpo.cliente.anotacoes, segredo);
  assert.equal(m.corpo.cliente.cpf, CPF);
});

test('clientes: PATCH do júnior não grava anotações nem `ativo` (403); nome e contato seguem liberados', async () => {
  quando('execute', /^\s*UPDATE clientes SET/, { rowCount: 1 });

  for (const corpo of [{ anotacoes: 'nova senha' }, { ativo: false }, { ativo: true }, { nome: 'X', ativo: false }]) {
    const r = await chamar('PATCH', `/api/clientes/${CLIENTE}`, { token: JUNIOR, corpo });
    assert.equal(r.status, 403, JSON.stringify(corpo));
  }
  assert.equal(houveUpdate('clientes'), false, 'nenhum UPDATE nas tentativas barradas');

  const ok = await chamar('PATCH', `/api/clientes/${CLIENTE}`, { token: JUNIOR, corpo: { nome: 'Maria S.', whatsapp: '83988887777', email: 'm@exemplo.com' } });
  assert.equal(ok.status, 200);
  const up = ultimoUpdate('clientes');
  assert.match(up.sql, /nome = \$1/);
  assert.ok(!/ativo =/.test(up.sql.replace(/vinculo_ativo/g, '')));
});

test('clientes: Master continua alterando `ativo` e anotações', async () => {
  quando('execute', /^\s*UPDATE clientes SET/, { rowCount: 1 });
  const a = await chamar('PATCH', `/api/clientes/${CLIENTE}`, { token: MASTER, corpo: { ativo: false } });
  assert.equal(a.status, 200);
  assert.match(ultimoUpdate('clientes').sql, /ativo = \$1/);
  const n = await chamar('PATCH', `/api/clientes/${CLIENTE}`, { token: MASTER, corpo: { anotacoes: 'senha nova' } });
  assert.equal(n.status, 200);
  assert.match(ultimoUpdate('clientes').sql, /anotacoes_enc = \$1/);
});

// ── Processos: CPF, CSV, urgência, edição ────────────────────────────────────

const linhaProcesso = (id, extra = {}) => ({ id, numero: `0800000-00.2026.8.15.${id.slice(0, 4)}`, situacao_atual: 'em_conhecimento', urgente: false, status: 'ativo', ...extra });
const temTarefa = (sim) => quando('queryOne', /FROM tarefas\s+WHERE processo_id = \$1 AND atribuido_a = \$2/, sim ? { ok: 1 } : null);

test('processos: ficha traz `pode_editar` (Master sempre; júnior só com tarefa) e CPF mascarado para o júnior', async () => {
  quando('queryOne', /FROM processos p\s+LEFT JOIN clientes c/, () => ({ ...linhaProcesso(PROC, { cliente_id: CLIENTE, cliente_cpf: CPF, cliente_nome: 'MARIA', tribunal: 'TJPB', visibilidade: 'normal' }) }));
  quando('query', /./, []);

  temTarefa(false);
  const semTarefa = await chamar('GET', `/api/processos/${PROC}`, { token: JUNIOR });
  assert.equal(semTarefa.status, 200);
  assert.equal(semTarefa.corpo.processo.pode_editar, false);
  assert.equal(semTarefa.corpo.processo.cliente_cpf, CPF_MASCARADO);
  assert.ok(!semTarefa.texto.includes(CPF));

  regras = regras.filter(r => !/atribuido_a/.test(String(r.padrao)));
  temTarefa(true);
  const comTarefa = await chamar('GET', `/api/processos/${PROC}`, { token: JUNIOR });
  assert.equal(comTarefa.corpo.processo.pode_editar, true);

  consultas = [];
  const m = await chamar('GET', `/api/processos/${PROC}`, { token: MASTER });
  assert.equal(m.corpo.processo.pode_editar, true);
  assert.equal(m.corpo.processo.cliente_cpf, CPF);
  assert.equal(consultouTarefas(), false, 'Master não gasta consulta de tarefas');
});

test('processos: lista marca `pode_editar` linha a linha para o júnior e libera tudo ao Master', async () => {
  quando('query', /SELECT COUNT\(\*\) AS total\s+FROM processos p/, [{ total: '2' }]);
  quando('query', /SELECT p\.id, p\.numero/, [linhaProcesso(PROC), linhaProcesso(PROC_B)]);
  quando('query', /FROM processo_classif/, []);
  quando('query', /SELECT DISTINCT processo_id FROM tarefas/, [{ processo_id: PROC }]);

  const j = await chamar('GET', '/api/processos', { token: JUNIOR });
  assert.equal(j.status, 200);
  const porId = Object.fromEntries(j.corpo.processos.map(p => [p.id, p.pode_editar]));
  assert.deepEqual(porId, { [PROC]: true, [PROC_B]: false });
  const consulta = consultas.find(c => /SELECT DISTINCT processo_id FROM tarefas/.test(c.sql));
  assert.deepEqual(consulta.params, ['j1', [PROC, PROC_B]]);

  consultas = [];
  const m = await chamar('GET', '/api/processos', { token: MASTER });
  assert.ok(m.corpo.processos.every(p => p.pode_editar === true));
  assert.equal(consultouTarefas(), false);
});

test('processos: busca por trecho de CPF vale só para o Master (lista e exportação)', async () => {
  quando('query', /SELECT COUNT\(\*\) AS total\s+FROM processos p/, [{ total: '0' }]);
  quando('query', /SELECT p\.id, p\.numero/, []);
  quando('query', /FROM processos p\s+LEFT JOIN clientes c ON c\.id = p\.cliente_id\s+WHERE/, []);

  await chamar('GET', '/api/processos?busca=529982', { token: JUNIOR });
  await chamar('GET', '/api/processos/exportar-excel?busca=529982', { token: JUNIOR });
  assert.ok(sqls('query').every(s => !/REGEXP_REPLACE\(c\.cpf/.test(s)), 'júnior: sem busca parcial por CPF em nenhuma das duas rotas');

  consultas = [];
  await chamar('GET', '/api/processos?busca=529982', { token: MASTER });
  await chamar('GET', '/api/processos/exportar-excel?busca=529982', { token: MASTER });
  assert.ok(sqls('query').filter(s => /REGEXP_REPLACE\(c\.cpf/.test(s)).length >= 2, 'Master: a busca parcial continua nas duas rotas');
});

test('processos: CSV do júnior sai sem a coluna CPF; o do Master traz a coluna', async () => {
  quando('query', /FROM processos p\s+LEFT JOIN clientes c ON c\.id = p\.cliente_id\s+WHERE/, () => [
    { numero: '0800000-00.2026.8.15.2001', cliente_nome: 'MARIA DA SILVA', cliente_cpf: CPF, situacao_atual: 'em_conhecimento', tribunal: 'TJPB', vara: '1ª Vara', polo_passivo: 'Município', urgente: false, tem_cessao: false },
  ]);

  const j = await chamar('GET', '/api/processos/exportar-excel', { token: JUNIOR });
  assert.equal(j.status, 200);
  const cabecalhoJ = j.texto.replace(/^﻿/, '').split('\r\n')[0];
  assert.ok(!/CPF/.test(cabecalhoJ), `cabeçalho sem CPF: ${cabecalhoJ}`);
  assert.ok(!j.texto.includes(CPF) && !j.texto.includes(CPF_MASCARADO), 'nem o CPF nem a versão mascarada no arquivo');
  assert.equal(cabecalhoJ.split(';').length, 10);
  assert.ok(sqls('query').every(s => !/c\.cpf/.test(s)), 'o júnior nem chega a selecionar o CPF');
  assert.ok(j.texto.includes('MARIA DA SILVA'), 'o resto do CSV segue igual');

  consultas = [];
  const m = await chamar('GET', '/api/processos/exportar-excel', { token: MASTER });
  const cabecalhoM = m.texto.replace(/^﻿/, '').split('\r\n')[0];
  assert.match(cabecalhoM, /"CPF"/);
  assert.equal(cabecalhoM.split(';').length, 11);
  assert.ok(m.texto.includes(CPF));
});

function prepararPatchProcesso({ tarefa, atuais = { status: 'ativo', valor_causa: '1000.00', valor_rpv: null } } = {}) {
  quando('queryOne', /SELECT master_responsavel_id, compartilhado, visibilidade, tribunal, grau FROM processos/, { master_responsavel_id: 'm1', compartilhado: false, visibilidade: 'normal', tribunal: 'TJPB', grau: '1' });
  quando('queryOne', /SELECT status, valor_causa, valor_rpv FROM processos/, atuais);
  quando('queryOne', /FROM tarefas\s+WHERE processo_id = \$1 AND atribuido_a = \$2/, tarefa ? { ok: 1 } : null);
  quando('execute', /^\s*UPDATE processos SET/, { rowCount: 1 });
}

test('processos: PATCH do júnior sem tarefa no processo → 403 (IDOR de 11/07 fechado)', async () => {
  prepararPatchProcesso({ tarefa: false });
  const r = await chamar('PATCH', `/api/processos/${PROC}`, { token: JUNIOR, corpo: { vara: '2ª Vara' } });
  assert.equal(r.status, 403);
  assert.match(r.corpo.erro, /tarefa atribuída/);
  assert.equal(houveUpdate('processos'), false);
  const conferiu = consultas.find(c => /FROM tarefas\s+WHERE processo_id/.test(c.sql));
  assert.deepEqual(conferiu.params, [PROC, 'j1']);
});

test('processos: PATCH do júnior com tarefa edita vara, notas e polo, mas nunca valor da causa, RPV e status', async () => {
  prepararPatchProcesso({ tarefa: true });

  const ok = await chamar('PATCH', `/api/processos/${PROC}`, { token: JUNIOR, corpo: { vara: '2ª Vara', notas: 'ligar amanhã' } });
  assert.equal(ok.status, 200);
  assert.match(ultimoUpdate('processos').sql, /vara = \$1, notas = \$2/);

  for (const corpo of [{ valor_causa: '2000.00' }, { valor_causa: '1.234,50' }, { valor_rpv: '500' }, { status: 'arquivado' }, { vara: 'X', status: 'encerrado' }]) {
    consultas = consultas.filter(c => c.tipo !== 'execute');
    const r = await chamar('PATCH', `/api/processos/${PROC}`, { token: JUNIOR, corpo });
    assert.equal(r.status, 403, JSON.stringify(corpo));
    assert.match(r.corpo.erro, /valor da causa.*status/);
    assert.equal(houveUpdate('processos'), false, `sem UPDATE para ${JSON.stringify(corpo)}`);
  }
});

test('processos: formulário antigo reenvia `status` igual ao gravado — passa, mas o campo não entra no UPDATE', async () => {
  prepararPatchProcesso({ tarefa: true });
  const r = await chamar('PATCH', `/api/processos/${PROC}`, { token: JUNIOR, corpo: { status: 'ativo', vara: '3ª Vara', valor_causa: 1000, valor_rpv: '' } });
  assert.equal(r.status, 200);
  const up = ultimoUpdate('processos');
  assert.match(up.sql, /SET vara = \$1, atualizado_em = NOW\(\) WHERE id = \$2/);
  assert.deepEqual(up.params, ['3ª Vara', PROC]);
});

test('processos: Master edita valor da causa, RPV e status de qualquer processo, sem conferir tarefa', async () => {
  prepararPatchProcesso({ tarefa: false });
  const r = await chamar('PATCH', `/api/processos/${PROC}`, { token: MASTER, corpo: { valor_causa: '2000.00', valor_rpv: '500.00', status: 'arquivado' } });
  assert.equal(r.status, 200);
  assert.match(ultimoUpdate('processos').sql, /status = \$1, valor_causa = \$2, valor_rpv = \$3/);
  assert.equal(consultouTarefas(), false);
});

test('processos: urgência do júnior só onde tem tarefa; Master marca em qualquer processo', async () => {
  quando('queryOne', /SELECT master_responsavel_id, compartilhado(, visibilidade)? FROM processos/, { master_responsavel_id: 'm1', compartilhado: false, visibilidade: 'normal' });
  quando('execute', /^\s*UPDATE processos SET urgente/, { rowCount: 1 });

  quando('queryOne', /FROM tarefas\s+WHERE processo_id = \$1 AND atribuido_a = \$2/, null);
  const negado = await chamar('PATCH', `/api/processos/${PROC}/urgente`, { token: JUNIOR, corpo: { urgente: true } });
  assert.equal(negado.status, 403);
  assert.equal(houveUpdate('processos'), false);

  regras = regras.filter(r => !/atribuido_a/.test(String(r.padrao)));
  quando('queryOne', /FROM tarefas\s+WHERE processo_id = \$1 AND atribuido_a = \$2/, { ok: 1 });
  const liberado = await chamar('PATCH', `/api/processos/${PROC}/urgente`, { token: JUNIOR, corpo: { urgente: true } });
  assert.equal(liberado.status, 200);
  assert.deepEqual(ultimoUpdate('processos').params, [true, 'j1', PROC]);

  consultas = [];
  const m = await chamar('PATCH', `/api/processos/${PROC}/urgente`, { token: MASTER, corpo: { urgente: true } });
  assert.equal(m.status, 200);
  assert.equal(consultouTarefas(), false);
});

function prepararSituacao({ tarefa, atual = { valor_homologado: '15000.00' }, urgenteAtual = false } = {}) {
  quando('queryOne', /SELECT master_responsavel_id, compartilhado, situacao_atual, etapa_atual/, { situacao_atual: 'em_conhecimento', etapa_atual: null, numero: '0800000-00.2026.8.15.2001', visibilidade: 'normal', cliente_id: CLIENTE, valor_homologado: atual.valor_homologado });
  quando('queryOne', /SELECT valor_homologado FROM processos/, atual);
  quando('queryOne', /SELECT urgente FROM processos/, { urgente: urgenteAtual });
  quando('queryOne', /FROM tarefas\s+WHERE processo_id = \$1 AND atribuido_a = \$2/, tarefa ? { ok: 1 } : null);
  quando('execute', /./, { rowCount: 1 });
}

test('situação: a classificação do dia a dia segue aberta ao júnior em qualquer processo', async () => {
  prepararSituacao({ tarefa: false });
  const r = await chamar('PATCH', `/api/processos/${PROC}/situacao`, { token: JUNIOR, corpo: { situacao_atual: 'sentenca_proferida', localizacao_processual: 'cartorio', status_rpv: 'nao_iniciado' } });
  assert.equal(r.status, 200);
  assert.match(ultimoUpdate('processos').sql, /situacao_atual = \$1/);
});

test('situação: valor homologado é do Master; reenviar o mesmo valor não conta como alteração', async () => {
  prepararSituacao({ tarefa: true });

  const barrado = await chamar('PATCH', `/api/processos/${PROC}/situacao`, { token: JUNIOR, corpo: { valor_homologado: '99999.00' } });
  assert.equal(barrado.status, 403);
  assert.match(barrado.corpo.erro, /valor homologado/);
  assert.equal(houveUpdate('processos'), false);

  const mesmo = await chamar('PATCH', `/api/processos/${PROC}/situacao`, { token: JUNIOR, corpo: { situacao_atual: 'em_recurso', valor_homologado: '15000.0' } });
  assert.equal(mesmo.status, 200);
  assert.ok(!/valor_homologado =/.test(ultimoUpdate('processos').sql), 'o campo reenviado igual sai do UPDATE');

  const limpar = await chamar('PATCH', `/api/processos/${PROC}/situacao`, { token: JUNIOR, corpo: { valor_homologado: null } });
  assert.equal(limpar.status, 403, 'apagar o valor gravado também é alteração');
});

test('situação: urgência do júnior só onde tem tarefa (mudança); o mesmo valor passa; Master altera tudo', async () => {
  prepararSituacao({ tarefa: false, urgenteAtual: false });
  const barrado = await chamar('PATCH', `/api/processos/${PROC}/situacao`, { token: JUNIOR, corpo: { urgente: true } });
  assert.equal(barrado.status, 403);
  assert.equal(houveUpdate('processos'), false);

  const igual = await chamar('PATCH', `/api/processos/${PROC}/situacao`, { token: JUNIOR, corpo: { situacao_atual: 'em_recurso', urgente: false } });
  assert.equal(igual.status, 200, 'o formulário sempre manda `urgente`; sem mudança não é bloqueio');

  regras = []; consultas = [];
  prepararSituacao({ tarefa: true, urgenteAtual: false });
  const liberado = await chamar('PATCH', `/api/processos/${PROC}/situacao`, { token: JUNIOR, corpo: { urgente: true } });
  assert.equal(liberado.status, 200);
  assert.match(ultimoUpdate('processos').sql, /urgente = \$1/);

  regras = []; consultas = [];
  prepararSituacao({ tarefa: false, urgenteAtual: false });
  const m = await chamar('PATCH', `/api/processos/${PROC}/situacao`, { token: MASTER, corpo: { urgente: true, valor_homologado: '99999.00' } });
  assert.equal(m.status, 200);
  assert.match(ultimoUpdate('processos').sql, /valor_homologado = \$1, urgente = \$2/);
  assert.equal(consultouTarefas(), false);
});

test('situação: urgência enviada como texto ("false", "f", "0") não contorna a regra do responsável', async () => {
  // Processo urgente que não é do júnior: a rota grava o valor cru e o Postgres lê "false" como falso.
  for (const valor of ['false', 'f', '0', 'off', 0, null, [], {}]) {
    regras = []; consultas = [];
    prepararSituacao({ tarefa: false, urgenteAtual: true });
    const r = await chamar('PATCH', `/api/processos/${PROC}/situacao`, { token: JUNIOR, corpo: { urgente: valor } });
    assert.equal(r.status, 403, `urgente=${JSON.stringify(valor)} deve ser tratado como mudança`);
    assert.equal(houveUpdate('processos'), false);
  }
  // O mesmo valor booleano continua passando (formulário antigo) e o Master não é afetado.
  regras = []; consultas = [];
  prepararSituacao({ tarefa: false, urgenteAtual: true });
  const igual = await chamar('PATCH', `/api/processos/${PROC}/situacao`, { token: JUNIOR, corpo: { situacao_atual: 'em_recurso', urgente: true } });
  assert.equal(igual.status, 200);
  regras = []; consultas = [];
  prepararSituacao({ tarefa: false, urgenteAtual: true });
  const m = await chamar('PATCH', `/api/processos/${PROC}/situacao`, { token: MASTER, corpo: { urgente: 'false' } });
  assert.equal(m.status, 200);
});

// ── Conversas de lead ────────────────────────────────────────────────────────

test('conversas de lead: 403 para o júnior; o Master passa da guarda (segue para a validação do id)', async () => {
  const j = await chamar('GET', '/api/estimativas/leads/nao-e-uuid/mensagens', { token: JUNIOR });
  assert.equal(j.status, 403, 'a guarda vem antes de qualquer outra coisa');
  assert.match(j.corpo.erro, /Masters/);

  const m = await chamar('GET', '/api/estimativas/leads/nao-e-uuid/mensagens', { token: MASTER });
  assert.equal(m.status, 400, 'Master chegou ao handler (id inválido = 400, sem tocar o Digisac)');
});

// ── Registro de protocolo pelo responsável ───────────────────────────────────

const CNJ = '0800123-45.2026.8.15.2001';
const tarefaProtocolo = (extra = {}) => ({ id: TAREFA, tipo: 'protocolar', status: 'pendente', precisa_triagem: false, atribuido_a: 'j1', cliente_id: CLIENTE, ...extra });

test('protocolo: o júnior responsável passa da guarda; quem não é responsável leva 403 sem descobrir o estado da tarefa', async () => {
  const concluir = (token, corpo = { numero_processo: CNJ, periodo_fim: '2026-08-01' }) =>
    chamar('PATCH', `/api/tarefas/${TAREFA}/concluir-com-numero`, { token, corpo });

  // Responsável: a tarefa já concluída prova que passou da guarda (o resto do fluxo é o de sempre).
  quando('queryOne', /FROM tarefas t\s+JOIN cliente_produtos cp/, tarefaProtocolo({ status: 'concluida' }));
  const responsavel = await concluir(JUNIOR);
  assert.equal(responsavel.status, 409);
  assert.match(responsavel.corpo.erro, /já concluída/);

  regras = [];
  quando('queryOne', /FROM tarefas t\s+JOIN cliente_produtos cp/, tarefaProtocolo({ atribuido_a: 'outra-pessoa', status: 'bloqueada' }));
  const alheia = await concluir(JUNIOR);
  assert.equal(alheia.status, 403);
  assert.match(alheia.corpo.erro, /responsável/);
  assert.ok(!/bloqueada|cadastro/i.test(alheia.corpo.erro), 'a mensagem não revela que a tarefa alheia está bloqueada');

  const master = await concluir(MASTER);
  assert.equal(master.status, 409, 'Master não é barrado pela conferência de responsável');
  assert.match(master.corpo.erro, /cadastro do cliente/);
});

test('protocolo: o júnior responsável registra o protocolo até o fim (processo criado, tarefa concluída, auditoria com o id dele)', async () => {
  const transacao = [];
  db.pool = { connect: async () => ({
    async query(sql, params) {
      transacao.push({ sql, params });
      if (/^\s*SELECT status FROM tarefas/.test(sql)) return { rows: [{ status: 'pendente' }] };
      if (/SELECT id, cliente_id, produto_id FROM processos WHERE numero/.test(sql)) return { rows: [] };
      if (/INSERT INTO processos/.test(sql)) return { rows: [{ id: PROC }] };
      return { rows: [], rowCount: 1 }; // BEGIN, UPDATE tarefas, COMMIT
    },
    release() {},
  }) };
  try {
    quando('queryOne', /FROM tarefas t\s+JOIN cliente_produtos cp/, tarefaProtocolo({ produto_id: 'p1', cliente_polo_passivo: 'Município de João Pessoa', demanda_id: null, onboarding_id: null, ciclo_inicio: null }));
    quando('query', /FROM cliente_vinculos WHERE cliente_id/, []);
    quando('execute', /INSERT INTO logs_auditoria/, { rowCount: 1 });

    const r = await chamar('PATCH', `/api/tarefas/${TAREFA}/concluir-com-numero`, { token: JUNIOR, corpo: { numero_processo: CNJ, periodo_fim: '2026-01-01' } });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual([r.corpo.ok, r.corpo.processo_id, r.corpo.numero], [true, PROC, CNJ]);

    const insercao = transacao.find(t => /INSERT INTO processos/.test(t.sql));
    assert.equal(insercao.params[0], CNJ);
    assert.equal(insercao.params[5], 'm1', 'o processo fica com o Master do júnior (master_id do token)');
    assert.ok(transacao.some(t => /UPDATE tarefas SET status='concluida'/.test(t.sql)), 'tarefa concluída');
    assert.equal(transacao.at(-1).sql, 'COMMIT');
    const auditoria = consultas.find(c => c.tipo === 'execute' && /INSERT INTO logs_auditoria/.test(c.sql));
    assert.equal(auditoria.params[0], 'j1');
    assert.equal(auditoria.params[1], 'protocolar');

    // Mesma chamada, tarefa de outra pessoa: 403 e a transação nem é aberta.
    transacao.length = 0; regras = []; consultas = [];
    quando('queryOne', /FROM tarefas t\s+JOIN cliente_produtos cp/, tarefaProtocolo({ atribuido_a: 'outra-pessoa' }));
    const alheia = await chamar('PATCH', `/api/tarefas/${TAREFA}/concluir-com-numero`, { token: JUNIOR, corpo: { numero_processo: CNJ, periodo_fim: '2026-01-01' } });
    assert.equal(alheia.status, 403);
    assert.equal(transacao.length, 0);
  } finally {
    db.pool = { connect: async () => { throw new Error('transação proibida nos testes'); } };
  }
});

test('protocolo: número CNJ inválido segue barrado para o júnior (400) antes de tocar o banco', async () => {
  const r = await chamar('PATCH', `/api/tarefas/${TAREFA}/concluir-com-numero`, { token: JUNIOR, corpo: { numero_processo: '123' } });
  assert.equal(r.status, 400);
  assert.equal(consultas.length, 0);
});

// ── Tarefas: CPF mascarado ───────────────────────────────────────────────────

test('tarefas: o júnior recebe `cliente_cpf` mascarado; o Master, completo', async () => {
  quando('query', /SELECT COUNT\(\*\) AS total/, [{ total: '1' }]);
  quando('query', /SELECT t\.\*/, [{ id: TAREFA, descricao: 'Protocolar', cliente_nome: 'MARIA', cliente_cpf: CPF }]);

  const j = await chamar('GET', '/api/tarefas', { token: JUNIOR });
  assert.equal(j.status, 200);
  assert.equal(j.corpo.tarefas[0].cliente_cpf, CPF_MASCARADO);
  assert.ok(!j.texto.includes(CPF));

  const m = await chamar('GET', '/api/tarefas', { token: MASTER });
  assert.equal(m.corpo.tarefas[0].cliente_cpf, CPF);
});
