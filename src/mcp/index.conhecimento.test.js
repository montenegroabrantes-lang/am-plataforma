// Ferramentas MCP da camada de conhecimento do acervo (24/11/2026): cada uma chama a rota certa de
// /api/acervo com o mesmo token, método, caminho e corpo esperados. A API é simulada no mesmo processo
// (harness igual ao de index.test.js); as regras (Master, escopo, auditoria, validação) são das rotas.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import { definirCarregador, carregadorEcoDoToken } from '../middleware/sessao.js';
definirCarregador(carregadorEcoDoToken);

process.env.JWT_SECRET = 'segredo-de-teste';

const app = express();
app.use(express.json());
const servidor = app.listen(0);
const porta = servidor.address().port;
after(() => servidor.close());
process.env.PORT = String(porta);

const { db } = await import('../db/index.js');
for (const metodo of ['query', 'queryOne', 'execute']) {
  db[metodo] = async () => { throw new Error('banco real proibido nos testes'); };
}
const { mcpRouter } = await import('./index.js');

const recebidas = [];
app.all('/api/acervo/*', (req, res) => {
  recebidas.push({ metodo: req.method, caminho: req.path, query: req.query, corpo: req.body, auth: req.headers.authorization });
  res.status(req.method === 'POST' && !req.path.endsWith('/arquivar') ? 201 : 200).json({ ok: true });
});
app.use('/mcp', mcpRouter);

const token = jwt.sign({ id: 'svc', perfil: 'master', escopos: ['acervo'] }, process.env.JWT_SECRET, { expiresIn: '1h' });

let seq = 0;
async function rpc(method, params = {}) {
  const r = await fetch(`http://127.0.0.1:${porta}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method, params }),
  });
  const texto = await r.text();
  return texto.includes('data:')
    ? JSON.parse(texto.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5)).join(''))
    : JSON.parse(texto);
}
const chamar = (name, args) => rpc('tools/call', { name, arguments: args });
const falhou = r => Boolean(r.error || r.result?.isError);
const ID = '66666666-6666-4666-8666-666666666666';

test('lista as ferramentas novas; leitura marcada como somente leitura e arquivar como destrutiva', async () => {
  const { result } = await rpc('tools/list');
  const f = Object.fromEntries(result.tools.map(t => [t.name, t]));
  for (const nome of ['criar_tese', 'atualizar_tese', 'listar_argumentos', 'ler_argumento', 'criar_argumento', 'atualizar_argumento', 'atualizar_peca', 'atualizar_precedente', 'arquivar_peca', 'arquivar_precedente', 'impacto_tese', 'listar_vigilancia', 'ler_vigilancia', 'criar_vigilancia', 'atualizar_vigilancia', 'listar_orgaos', 'ler_orgao', 'criar_orgao', 'atualizar_orgao', 'painel_acervo', 'contexto_redacao', 'impacto_precedente', 'registrar_decisao_peca', 'relatorio_acervo']) {
    assert.ok(f[nome], nome);
  }
  for (const nome of ['listar_argumentos', 'ler_argumento', 'impacto_tese', 'listar_vigilancia', 'ler_vigilancia', 'listar_orgaos', 'ler_orgao', 'painel_acervo', 'contexto_redacao', 'impacto_precedente', 'relatorio_acervo']) assert.equal(f[nome].annotations.readOnlyHint, true, nome);
  for (const nome of ['arquivar_peca', 'arquivar_precedente']) assert.equal(f[nome].annotations.destructiveHint, true, nome);
  assert.deepEqual(f.criar_argumento.inputSchema.required.sort(), ['tese', 'tipo', 'titulo']);
});

test('cada ferramenta chama a rota certa, com o mesmo token e só os campos enviados', async () => {
  const casos = [
    ['criar_tese', { slug: 'fgts-bahia', label: 'FGTS — Bahia', tese_mae: 'fgts-nulidade' }, 'POST', '/api/acervo/teses', { slug: 'fgts-bahia', label: 'FGTS — Bahia', tese_mae: 'fgts-nulidade' }],
    ['atualizar_tese', { slug: 'piso-salarial-magisterio-pb', status: 'em_risco', status_motivo: 'Tema 1308 modulado' }, 'PATCH', '/api/acervo/teses/piso-salarial-magisterio-pb', { status: 'em_risco', status_motivo: 'Tema 1308 modulado' }],
    ['atualizar_tese', { slug: 'fgts-pernambuco', tese_mae: null }, 'PATCH', '/api/acervo/teses/fgts-pernambuco', { tese_mae: null }],
    ['criar_argumento', { tese: 'fgts-nulidade', tipo: 'resposta', titulo: 'R', responde_a_id: ID, precedentes: [ID] }, 'POST', '/api/acervo/argumentos', { tese: 'fgts-nulidade', tipo: 'resposta', titulo: 'R', responde_a_id: ID, precedentes: [ID] }],
    ['atualizar_argumento', { id: ID, status: 'aprovado' }, 'PATCH', `/api/acervo/argumentos/${ID}`, { status: 'aprovado' }],
    ['atualizar_peca', { id: ID, data_decisao: '2026-11-20', resultado_por_pedido: [{ pedido: 'FGTS', resultado: 'deferido' }], argumentos: [ID] }, 'PATCH', `/api/acervo/pecas/${ID}`, { data_decisao: '2026-11-20', resultado_por_pedido: [{ pedido: 'FGTS', resultado: 'deferido' }], argumentos: [ID] }],
    ['atualizar_precedente', { id: ID, ratio: 'Nova ratio' }, 'PATCH', `/api/acervo/precedentes/${ID}`, { ratio: 'Nova ratio' }],
    ['arquivar_peca', { id: ID }, 'POST', `/api/acervo/pecas/${ID}/arquivar`, null],
    ['arquivar_precedente', { id: ID }, 'POST', `/api/acervo/precedentes/${ID}/arquivar`, null],
    ['ler_argumento', { id: ID }, 'GET', `/api/acervo/argumentos/${ID}`, null],
    ['atualizar_peca', { id: ID, decisao_id: ID }, 'PATCH', `/api/acervo/pecas/${ID}`, { decisao_id: ID }],
    ['criar_vigilancia', { referencia: 'Tema 1218', teses: ['piso-salarial-magisterio-pb'], ultima_situacao: 'Pedido de vista' }, 'POST', '/api/acervo/vigilancia', { referencia: 'Tema 1218', teses: ['piso-salarial-magisterio-pb'], ultima_situacao: 'Pedido de vista' }],
    ['atualizar_vigilancia', { id: ID, ultima_situacao: 'Julgado' }, 'PATCH', `/api/acervo/vigilancia/${ID}`, { ultima_situacao: 'Julgado' }],
    ['ler_vigilancia', { id: ID }, 'GET', `/api/acervo/vigilancia/${ID}`, null],
    ['listar_vigilancia', { tese: 'fgts-nulidade' }, 'GET', '/api/acervo/vigilancia', null],
    ['criar_orgao', { nome: '1º JEFP', tribunal: 'TJPB', instancia: '1grau' }, 'POST', '/api/acervo/orgaos', { nome: '1º JEFP', tribunal: 'TJPB', instancia: '1grau' }],
    ['atualizar_orgao', { id: ID, notas: 'nega reflexo no 13º' }, 'PATCH', `/api/acervo/orgaos/${ID}`, { notas: 'nega reflexo no 13º' }],
    ['ler_orgao', { id: ID }, 'GET', `/api/acervo/orgaos/${ID}`, null],
    ['listar_orgaos', { tribunal: 'TJPB' }, 'GET', '/api/acervo/orgaos', null],
    ['painel_acervo', {}, 'GET', '/api/acervo/painel', null],
    ['relatorio_acervo', { mes: '2026-10' }, 'GET', '/api/acervo/relatorio', null],
    ['registrar_decisao_peca', { id: ID, data_decisao: '2026-11-20', evidencia: '20 nov 2026~JULGADO PROCEDENTE O PEDIDO', resultado: 'procedente' }, 'POST', `/api/acervo/pecas/${ID}/decisao`, { data_decisao: '2026-11-20', evidencia: '20 nov 2026~JULGADO PROCEDENTE O PEDIDO', resultado: 'procedente' }],
    ['contexto_redacao', { tese: 'fgts-nulidade' }, 'GET', '/api/acervo/contexto-redacao', null],
    ['impacto_precedente', { precedente_id: ID }, 'GET', '/api/acervo/impacto', null],
    ['criar_peca', { teses: ['fgts-nulidade'], titulo: 'Impugnação', tipo_peca: 'impugnacao-contestacao', ente: 'estado-paraiba', instancia: '1grau', argumentos: [ID], precedentes: [ID] }, 'POST', '/api/acervo/pecas', { teses: ['fgts-nulidade'], titulo: 'Impugnação', tipo_peca: 'impugnacao-contestacao', ente: 'estado-paraiba', instancia: '1grau', argumentos: [ID], precedentes: [ID] }],
    ['atualizar_vigilancia', { id: ID, ultima_situacao: 'Julgado', criar_tarefa: false }, 'PATCH', `/api/acervo/vigilancia/${ID}`, { ultima_situacao: 'Julgado', criar_tarefa: false }],
    ['atualizar_peca', { id: ID, orgao_julgador_id: ID }, 'PATCH', `/api/acervo/pecas/${ID}`, { orgao_julgador_id: ID }],
  ];
  for (const [nome, args, metodo, caminho, corpo] of casos) {
    recebidas.length = 0;
    const r = await chamar(nome, args);
    assert.equal(falhou(r), false, `${nome}: ${JSON.stringify(r)}`);
    assert.equal(recebidas.length, 1, nome);
    const [x] = recebidas;
    assert.equal(x.metodo, metodo, nome);
    assert.equal(x.caminho, caminho, nome);
    assert.equal(x.auth, `Bearer ${token}`, nome);
    if (corpo) assert.deepEqual(x.corpo, corpo, nome);
  }
});

test('listar_argumentos e impacto_tese levam os filtros na query; variantes só vai quando false', async () => {
  recebidas.length = 0;
  await chamar('listar_argumentos', { tese: 'fgts-pernambuco', incluir_maes: true, tipo: 'defesa_fazenda' });
  assert.deepEqual(recebidas[0].query, { tese: 'fgts-pernambuco', incluir_maes: 'true', tipo: 'defesa_fazenda' });
  await chamar('impacto_tese', { tese: 'piso-salarial-magisterio-pb', protocolo_desde: '2026-04-17' });
  assert.equal(recebidas[1].caminho, '/api/acervo/impacto');
  assert.deepEqual(recebidas[1].query, { tese: 'piso-salarial-magisterio-pb', protocolo_desde: '2026-04-17' });
  await chamar('impacto_tese', { tese: 'fgts-nulidade', variantes: false });
  assert.deepEqual(recebidas[2].query, { tese: 'fgts-nulidade', variantes: 'false' });
});

test('valores fora da lista são recusados antes de chamar a API', async () => {
  recebidas.length = 0;
  assert.ok(falhou(await chamar('atualizar_tese', { slug: 'x', status: 'arriscada' })));
  assert.ok(falhou(await chamar('criar_argumento', { tese: 'x', tipo: 'opiniao', titulo: 'T' })));
  assert.ok(falhou(await chamar('atualizar_peca', { id: ID, resultado_por_pedido: [{ pedido: 'FGTS', resultado: 'ganhou' }] })));
  assert.ok(falhou(await chamar('atualizar_peca', { id: ID, drive_url: 'javascript:alert(1)' })));
  assert.ok(falhou(await chamar('criar_tese', { slug: 'Inválido!', label: 'X' })));
  assert.ok(falhou(await chamar('criar_vigilancia', { referencia: 'X', teses: [] })));
  assert.ok(falhou(await chamar('atualizar_peca', { id: ID, decisao_id: 'nao-e-uuid' })));
  assert.ok(falhou(await chamar('criar_orgao', { nome: 'X', tribunal: 'TJPB', instancia: 'nenhuma' })));
  assert.equal(recebidas.length, 0);
});

test('contexto_redacao e impacto_precedente levam os filtros na query', async () => {
  recebidas.length = 0;
  await chamar('contexto_redacao', { tese: 'fgts-nulidade', ente: 'estado-paraiba', orgao_julgador_id: ID, tipo_peca: 'impugnacao-contestacao' });
  assert.deepEqual(recebidas[0].query, { tese: 'fgts-nulidade', ente: 'estado-paraiba', orgao_julgador_id: ID, tipo_peca: 'impugnacao-contestacao' });
  await chamar('impacto_precedente', { precedente_id: ID, variantes: false, protocolo_desde: '2026-04-17' });
  assert.deepEqual(recebidas[1].query, { protocolo_desde: '2026-04-17', precedente: ID, variantes: 'false' });
  await chamar('impacto_precedente', { vigilancia_id: ID });
  assert.deepEqual(recebidas[2].query, { vigilancia: ID });
});
