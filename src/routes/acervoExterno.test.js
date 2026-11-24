import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createHash } from 'crypto';

// Chave externa do acervo (23/11/2026): acervo_leitura / acervo_edicao, rotas permitidas,
// nunca registros restritos, e edição de teses, peças e precedentes.

const MASTER = '44444444-4444-4444-8444-444444444444';
const ID = '55555555-5555-4555-8555-555555555555';
const CHAVES = { 'am_live_leitura': ['acervo_leitura'], 'am_live_edicao': ['acervo_edicao'], 'am_live_outra': ['processos'] };
const hash = c => createHash('sha256').update(c).digest('hex');

const { db } = await import('../db/index.js');
const TESE_ID = '77777777-7777-4777-8777-777777777777';
const DEFESA = '88888888-8888-4888-8888-888888888888';
const TESES = { 'fgts-nulidade': { id: TESE_ID, slug: 'fgts-nulidade', label: 'FGTS', drive_folder_id: null, ativo: true, tese_mae: null, status: 'ativa', status_motivo: null, skill_slug: null } };
let consultas, auditorias, precedente, argumento;
function instalar() {
  consultas = []; auditorias = [];
  argumento = { id: ID, tese_id: TESE_ID, tese: 'fgts-nulidade', tipo: 'resposta', responde_a_id: DEFESA, status: 'em_teste' };
  precedente = { id: ID, orgao: 'STF', ratio: 'Fundamento A', instancia: 'stf', data_julgamento: new Date('2026-01-10'), conferido: true, resultado: 'provido', vinculante: true };
  db.queryOne = async (sql, params = []) => {
    const s = sql.replace(/\s+/g, ' ').trim(); consultas.push(s);
    if (s.includes('FROM chaves_api_externas')) {
      const [k] = Object.entries(CHAVES).filter(([c]) => hash(c) === params[0]);
      return k ? { id: 'chave-1', master_id: MASTER, permissoes: k[1] } : null;
    }
    if (s.startsWith('SELECT * FROM acervo_precedentes')) return precedente;
    if (s.startsWith('SELECT * FROM acervo_pecas')) return { id: ID, ente: 'estado-paraiba' };
    if (s.startsWith('SELECT t.id, t.slug, t.label')) return TESES[params[0]] ?? null;
    if (s.startsWith('SELECT g.*, t.slug AS tese, ARRAY')) return argumento ? { ...argumento, precedentes: [] } : null;
    if (s.startsWith('SELECT g.*, t.slug AS tese FROM')) return argumento;
    if (s.startsWith('SELECT id, tipo, tese_id FROM acervo_argumentos')) return params[0] === DEFESA ? { id: DEFESA, tipo: 'defesa_fazenda', tese_id: TESE_ID } : null;
    if (s.startsWith('SELECT COUNT(*)::int AS n FROM acervo_argumentos')) return { n: 0 };
    if (s.startsWith('SELECT x.*')) return { id: ID, teses: [] };
    return null;
  };
  db.query = async (sql, params = []) => {
    const s = sql.replace(/\s+/g, ' ').trim(); consultas.push(s);
    if (s.startsWith('SELECT t.slug, t.label, t.drive_folder_id, m.slug AS tese_mae')) return [{ slug: 'fgts-nulidade' }];
    if (s.startsWith('WITH RECURSIVE arvore')) return [{ id: TESE_ID, slug: 'fgts-nulidade' }];
    if (s.startsWith('SELECT t.slug FROM acervo_pecas_teses')) return [];
    if (s.startsWith('SELECT p.id FROM acervo_precedentes')) return params[0].map(id => ({ id }));
    if (s.startsWith('SELECT a.id, a.titulo')) return [{ id: ID, processo_id: null, processo_numero: '0876116-26.2026.8.15.2001', cliente_nome: 'X' }];
    if (s.startsWith('SELECT precedente_id AS id') || s.startsWith('SELECT argumento_id AS id')) return [];
    if (s.startsWith('INSERT INTO acervo_argumentos')) return [{ id: ID }];
    if (s.startsWith('SELECT DISTINCT v.id, v.referencia')) return [];
    if (s.startsWith('SELECT g.*, t.slug AS tese, ARRAY')) return [];
    if (s.startsWith('SELECT slug FROM teses_acervo')) return params[0].map(slug => ({ slug }));
    if (s.startsWith('SELECT a.*') || s.startsWith('SELECT p.*')) return [];
    if (s.startsWith('UPDATE acervo_precedentes SET') || s.startsWith('UPDATE acervo_pecas SET')) return [{ id: ID }];
    if (s.startsWith('INSERT INTO teses_acervo')) return [{ id: TESE_ID, slug: params[0], label: params[1], drive_folder_id: params[2], ativo: true, status: params[4] }];
    if (s.startsWith('INSERT INTO logs_auditoria')) { auditorias.push(params); return []; }
    throw new Error(`consulta inesperada: ${s.slice(0, 80)}`);
  };
  db.execute = async (sql, params = []) => { const s = sql.replace(/\s+/g, ' ').trim(); consultas.push(s); if (s.startsWith('INSERT INTO logs_auditoria')) auditorias.push(params); return { rows: [] }; };
}
instalar();
beforeEach(instalar);

const { integracoesExternasRouter } = await import('./integracoesExternas.js');
const app = express();
app.use(express.json());
app.use('/api/integracoes', integracoesExternasRouter);
const servidor = app.listen(0);
const base = `http://127.0.0.1:${servidor.address().port}/api/integracoes/v1/acervo`;
after(() => servidor.close());

async function chamar(chave, metodo, caminho, corpo) {
  const r = await fetch(base + caminho, { method: metodo, headers: { 'Content-Type': 'application/json', ...(chave ? { 'X-AM-API-Key': chave } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
  return { status: r.status, corpo: await r.json().catch(() => null) };
}

test('sem chave → 401; chave sem permissão de acervo → 403', async () => {
  assert.equal((await chamar(null, 'GET', '/')).status, 401);
  assert.equal((await chamar('am_live_outra', 'GET', '/')).status, 403);
});

test('acervo_leitura: lê lista, teses e item; não escreve', async () => {
  assert.equal((await chamar('am_live_leitura', 'GET', '/?q=fgts')).status, 200);
  assert.equal((await chamar('am_live_leitura', 'GET', '/teses')).status, 200);
  assert.equal((await chamar('am_live_leitura', 'GET', `/precedentes/${ID}`)).status, 200);
  assert.equal((await chamar('am_live_leitura', 'PATCH', `/pecas/${ID}`, { titulo: 'x' })).status, 403);
  assert.equal((await chamar('am_live_leitura', 'POST', '/teses', { slug: 'nova', label: 'Nova' })).status, 403);
});

test('a chave nunca vê processo restrito', async () => {
  await chamar('am_live_edicao', 'GET', '/');
  assert.ok(consultas.filter(s => s.startsWith('SELECT a.*') || s.startsWith('SELECT p.*')).every(s => s.includes("visibilidade_snapshot = 'normal'")));
});

test('rotas fora da lista (Drive, prazos, restaurar) → 404 mesmo com acervo_edicao', async () => {
  for (const [m, c] of [['POST', '/drive/documentos'], ['POST', `/prazos/${ID}/cumprir`], ['POST', `/pecas/${ID}/restaurar`], ['GET', '/contexto-processo']]) {
    assert.equal((await chamar('am_live_edicao', m, c, m === 'GET' ? undefined : {})).status, 404, `${m} ${c}`);
  }
});

test('acervo_edicao: cria e edita tese; edita peça', async () => {
  const t = await chamar('am_live_edicao', 'POST', '/teses', { slug: 'tese-nova', label: 'Tese nova' });
  assert.equal(t.status, 201);
  assert.equal((await chamar('am_live_edicao', 'POST', '/teses', { slug: 'Inválida!', label: 'x' })).status, 422);
  assert.equal((await chamar('am_live_edicao', 'PATCH', '/teses/fgts-nulidade', { label: 'FGTS — nulidade' })).status, 200);
  assert.equal((await chamar('am_live_edicao', 'PATCH', '/teses/nao-existe', { label: 'x' })).status, 404);
  const p = await chamar('am_live_edicao', 'PATCH', `/pecas/${ID}`, { titulo: 'Novo título', teses: ['fgts-nulidade'] });
  assert.equal(p.status, 200);
  assert.equal((await chamar('am_live_edicao', 'PATCH', `/pecas/${ID}`, {})).status, 422);
  assert.equal((await chamar('am_live_edicao', 'PATCH', `/pecas/${ID}`, { drive_url: 'javascript:alert(1)' })).status, 422);
});

test('editar conteúdo do precedente conferido derruba o selo; mudar só favoravel não', async () => {
  const r = await chamar('am_live_edicao', 'PATCH', `/precedentes/${ID}`, { ratio: 'Fundamento B' });
  assert.equal(r.status, 200);
  assert.match(r.corpo.aviso, /não conferido/);
  assert.ok(consultas.some(s => s.startsWith('UPDATE acervo_precedentes SET') && s.includes('conferido=false')));
  instalar();
  const r2 = await chamar('am_live_edicao', 'PATCH', `/precedentes/${ID}`, { favoravel: true, data_julgamento: '2026-01-10' });
  assert.equal(r2.status, 200);
  assert.equal(r2.corpo.aviso, undefined);
});

// Camada de conhecimento (23/11/2026): status e árvore de tese, argumentos, ligações da peça,
// arquivar e impacto pela chave.
test('tese: status fora de "ativa" exige motivo; mãe inexistente → 422; volta a ativa limpa o motivo', async () => {
  assert.equal((await chamar('am_live_edicao', 'PATCH', '/teses/fgts-nulidade', { status: 'em_risco' })).status, 422);
  assert.equal((await chamar('am_live_edicao', 'PATCH', '/teses/fgts-nulidade', { status: 'ruim', status_motivo: 'x' })).status, 422);
  assert.equal((await chamar('am_live_edicao', 'PATCH', '/teses/fgts-nulidade', { tese_mae: 'nao-existe' })).status, 422);
  assert.equal((await chamar('am_live_edicao', 'PATCH', '/teses/fgts-nulidade', { status: 'em_risco', status_motivo: 'Tema 1308 modulado' })).status, 200);
  assert.ok(consultas.some(s => s.startsWith('UPDATE teses_acervo SET status=$1, status_motivo=$2, atualizado_em=NOW()')));
  instalar();
  assert.equal((await chamar('am_live_edicao', 'PATCH', '/teses/fgts-nulidade', { status: 'ativa' })).status, 200);
  assert.ok(consultas.some(s => s.startsWith('UPDATE teses_acervo SET status=$1, status_motivo=$2')));
  const nova = await chamar('am_live_edicao', 'POST', '/teses', { slug: 'fgts-filha', label: 'Filha', tese_mae: 'fgts-nulidade', skill_slug: 'temas-551-916-stf-am' });
  assert.equal(nova.status, 201);
  assert.equal(nova.corpo.tese.tese_mae, 'fgts-nulidade');
  assert.equal((await chamar('am_live_edicao', 'POST', '/teses', { slug: 'x', label: 'X', skill_slug: 'Não vale' })).status, 422);
});

test('argumentos: leitura lê; edição cria e edita; resposta só aponta para defesa da Fazenda', async () => {
  assert.equal((await chamar('am_live_leitura', 'GET', '/argumentos?tese=fgts-nulidade')).status, 200);
  assert.equal((await chamar('am_live_leitura', 'GET', `/argumentos/${ID}`)).status, 200);
  assert.equal((await chamar('am_live_leitura', 'POST', '/argumentos', { tese: 'fgts-nulidade', tipo: 'fundamento', titulo: 'x' })).status, 403);
  assert.equal((await chamar('am_live_edicao', 'POST', '/argumentos', { tese: 'fgts-nulidade', tipo: 'resposta', titulo: 'Tema 1344 não alcança desvirtuamento', responde_a_id: DEFESA })).status, 201);
  assert.equal((await chamar('am_live_edicao', 'POST', '/argumentos', { tese: 'fgts-nulidade', tipo: 'fundamento', titulo: 'x', responde_a_id: DEFESA })).status, 422);
  assert.equal((await chamar('am_live_edicao', 'POST', '/argumentos', { tese: 'fgts-nulidade', tipo: 'resposta', titulo: 'x', responde_a_id: ID })).status, 422);
  assert.equal((await chamar('am_live_edicao', 'POST', '/argumentos', { tese: 'fgts-nulidade', tipo: 'opiniao', titulo: 'x' })).status, 422);
  assert.equal((await chamar('am_live_edicao', 'POST', '/argumentos', { tipo: 'fundamento', titulo: 'x' })).status, 422);
  const a = await chamar('am_live_edicao', 'PATCH', `/argumentos/${ID}`, { status: 'aprovado', precedentes: [ID] });
  assert.equal(a.status, 200);
  const aud = auditorias.at(-1);
  assert.equal(aud[1], 'editar');
  assert.deepEqual(JSON.parse(aud[4]), { status: 'em_teste', precedentes: [] });
  assert.equal(JSON.parse(aud[5]).via_chave, 'chave-1');
  assert.equal((await chamar('am_live_edicao', 'PATCH', `/argumentos/${ID}`, { tipo: 'fundamento' })).status, 422);
  assert.equal((await chamar('am_live_edicao', 'PATCH', `/argumentos/${ID}`, {})).status, 422);
});

test('peça: resultado por pedido (JSON), data da decisão e ligações; formato inválido → 422', async () => {
  const p = await chamar('am_live_edicao', 'PATCH', `/pecas/${ID}`, { data_decisao: '2026-11-20', resultado_por_pedido: [{ pedido: 'FGTS', resultado: 'deferido' }, { pedido: 'Reflexo 13º', resultado: 'indeferido' }], precedentes: [ID] });
  assert.equal(p.status, 200);
  const upd = consultas.find(s => s.startsWith('UPDATE acervo_pecas SET'));
  assert.match(upd, /resultado_por_pedido=\$2/);
  assert.ok(consultas.some(s => s.startsWith('DELETE FROM acervo_pecas_precedentes') && s.includes("visibilidade_snapshot = 'normal'")), 'a chave só troca ligações que enxerga');
  assert.equal((await chamar('am_live_edicao', 'PATCH', `/pecas/${ID}`, { resultado_por_pedido: [{ pedido: 'FGTS', resultado: 'ganhou' }] })).status, 422);
  assert.equal((await chamar('am_live_edicao', 'PATCH', `/pecas/${ID}`, { resultado_por_pedido: 'FGTS deferido' })).status, 422);
  assert.equal((await chamar('am_live_edicao', 'PATCH', `/pecas/${ID}`, { data_decisao: '20/11/2026' })).status, 422);
  assert.equal((await chamar('am_live_edicao', 'PATCH', `/pecas/${ID}`, { argumentos: ['nao-e-uuid'] })).status, 422);
});

test('arquivar peça e precedente pela chave de edição, com auditoria; leitura não arquiva', async () => {
  assert.equal((await chamar('am_live_leitura', 'POST', `/pecas/${ID}/arquivar`)).status, 403);
  for (const tipo of ['pecas', 'precedentes']) {
    assert.equal((await chamar('am_live_edicao', 'POST', `/${tipo}/${ID}/arquivar`)).status, 200);
    const aud = auditorias.at(-1);
    assert.equal(aud[1], 'arquivar');
    assert.equal(JSON.parse(aud[5]).via_chave, 'chave-1');
  }
  assert.ok(consultas.filter(s => s.includes('SET arquivada_em=NOW()')).every(s => s.includes("visibilidade_snapshot = 'normal'")));
});

test('impacto: lista peças e processos da tese, sem restritos; tese inexistente → 404', async () => {
  const r = await chamar('am_live_leitura', 'GET', '/impacto?tese=fgts-nulidade&protocolo_desde=2026-04-17');
  assert.equal(r.status, 200);
  assert.equal(r.corpo.total_pecas, 1);
  assert.equal(r.corpo.processos[0].numero, '0876116-26.2026.8.15.2001');
  assert.ok(consultas.some(s => s.startsWith('SELECT a.id, a.titulo') && s.includes("visibilidade_snapshot = 'normal'") && s.includes('a.data_protocolo >= $2')));
  assert.equal((await chamar('am_live_leitura', 'GET', '/impacto?tese=nao-existe')).status, 404);
  assert.equal((await chamar('am_live_leitura', 'GET', '/impacto')).status, 422);
});

test('vigilância e decisão da peça pela chave: leitura lê, edição escreve, o resto fica de fora', async () => {
  const { permissaoNecessaria } = await import('./acervoExterno.js');
  assert.equal(permissaoNecessaria('GET', '/vigilancia'), 'acervo_leitura');
  assert.equal(permissaoNecessaria('GET', `/vigilancia/${ID}`), 'acervo_leitura');
  assert.equal(permissaoNecessaria('POST', '/vigilancia'), 'acervo_edicao');
  assert.equal(permissaoNecessaria('PATCH', `/vigilancia/${ID}`), 'acervo_edicao');
  assert.equal(permissaoNecessaria('DELETE', `/vigilancia/${ID}`), null);
  assert.equal(permissaoNecessaria('POST', `/vigilancia/${ID}/arquivar`), null);
  assert.equal(permissaoNecessaria('POST', '/decisoes-publicacoes/reprocessar'), 'acervo_edicao');
  assert.equal(permissaoNecessaria('GET', '/decisoes-publicacoes/reprocessar'), null);
  assert.equal(permissaoNecessaria('GET', '/cobertura'), 'acervo_leitura');
  assert.equal(permissaoNecessaria('GET', '/produtos'), 'acervo_leitura');
  assert.equal(permissaoNecessaria('PATCH', `/produtos/${ID}/tese`), 'acervo_edicao');
  assert.equal(permissaoNecessaria('PATCH', `/produtos/${ID}`), null);
  assert.equal((await chamar('am_live_leitura', 'POST', '/vigilancia', { referencia: 'Tema 1', teses: ['fgts-nulidade'] })).status, 403);
  assert.equal((await chamar('am_live_edicao', 'PATCH', `/pecas/${ID}`, { decisao_id: 'nao-e-uuid' })).status, 422);
});

test('órgão julgador pela chave e sentido do resultado (contrarrazões invertem)', async () => {
  const { permissaoNecessaria } = await import('./acervoExterno.js');
  assert.equal(permissaoNecessaria('GET', '/orgaos'), 'acervo_leitura');
  assert.equal(permissaoNecessaria('GET', `/orgaos/${ID}`), 'acervo_leitura');
  assert.equal(permissaoNecessaria('POST', '/orgaos'), 'acervo_edicao');
  assert.equal(permissaoNecessaria('PATCH', `/orgaos/${ID}`), 'acervo_edicao');
  assert.equal(permissaoNecessaria('DELETE', `/orgaos/${ID}`), null);
  assert.equal((await chamar('am_live_leitura', 'POST', '/orgaos', { nome: 'X', tribunal: 'TJPB', instancia: '1grau' })).status, 403);
  assert.equal((await chamar('am_live_edicao', 'PATCH', `/pecas/${ID}`, { orgao_julgador_id: 'nao-e-uuid' })).status, 422);
  const { sentidoResultado } = await import('./acervo.js');
  assert.equal(sentidoResultado('inicial', 'parcialmente-procedente'), 'favoravel');
  assert.equal(sentidoResultado('inicial', 'improcedente'), 'desfavoravel');
  assert.equal(sentidoResultado('recurso-inominado', 'desprovido'), 'desfavoravel');
  assert.equal(sentidoResultado('contrarrazoes', 'desprovido'), 'favoravel');
  assert.equal(sentidoResultado('contrarrazoes', 'provido'), 'desfavoravel');
  assert.equal(sentidoResultado('inicial', 'pendente'), null);
  assert.equal(sentidoResultado('inicial', 'desistencia'), null);
});

test('painel pela chave: só leitura', async () => {
  const { permissaoNecessaria } = await import('./acervoExterno.js');
  assert.equal(permissaoNecessaria('GET', '/painel'), 'acervo_leitura');
  assert.equal(permissaoNecessaria('POST', '/painel'), null);
  assert.equal(permissaoNecessaria('PATCH', '/painel'), null);
});

test('contexto de redação pela chave: só leitura; impacto por precedente ou vigilância também', async () => {
  const { permissaoNecessaria } = await import('./acervoExterno.js');
  assert.equal(permissaoNecessaria('GET', '/contexto-redacao'), 'acervo_leitura');
  assert.equal(permissaoNecessaria('POST', '/contexto-redacao'), null);
  assert.equal(permissaoNecessaria('GET', '/impacto'), 'acervo_leitura');
});

test('decisão detectada pela chave: só com edição', async () => {
  const { permissaoNecessaria } = await import('./acervoExterno.js');
  assert.equal(permissaoNecessaria('POST', `/pecas/${ID}/decisao`), 'acervo_edicao');
  assert.equal(permissaoNecessaria('GET', `/pecas/${ID}/decisao`), null);
  assert.equal(permissaoNecessaria('PATCH', `/pecas/${ID}/decisao`), null);
});

test('relatório mensal pela chave: só leitura; fechar não', async () => {
  const { permissaoNecessaria } = await import('./acervoExterno.js');
  assert.equal(permissaoNecessaria('GET', '/relatorio'), 'acervo_leitura');
  assert.equal(permissaoNecessaria('POST', '/relatorio/2026-10/fechar'), null);
});
