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
let consultas, auditorias, precedente;
function instalar() {
  consultas = []; auditorias = [];
  precedente = { id: ID, orgao: 'STF', ratio: 'Fundamento A', instancia: 'stf', data_julgamento: new Date('2026-01-10'), conferido: true, resultado: 'provido', vinculante: true };
  db.queryOne = async (sql, params = []) => {
    const s = sql.replace(/\s+/g, ' ').trim(); consultas.push(s);
    if (s.includes('FROM chaves_api_externas')) {
      const [k] = Object.entries(CHAVES).filter(([c]) => hash(c) === params[0]);
      return k ? { id: 'chave-1', master_id: MASTER, permissoes: k[1] } : null;
    }
    if (s.startsWith('SELECT * FROM acervo_precedentes')) return precedente;
    if (s.startsWith('SELECT * FROM acervo_pecas')) return { id: ID, ente: 'estado-paraiba' };
    if (s.startsWith('SELECT slug,label,drive_folder_id,ativo FROM teses_acervo')) return params[0] === 'fgts-nulidade' ? { slug: 'fgts-nulidade', label: 'FGTS', drive_folder_id: null, ativo: true } : null;
    if (s.startsWith('SELECT x.*')) return { id: ID, teses: [] };
    return null;
  };
  db.query = async (sql, params = []) => {
    const s = sql.replace(/\s+/g, ' ').trim(); consultas.push(s);
    if (s.startsWith('SELECT slug,label,drive_folder_id FROM teses_acervo')) return [{ slug: 'fgts-nulidade' }];
    if (s.startsWith('SELECT slug FROM teses_acervo')) return params[0].map(slug => ({ slug }));
    if (s.startsWith('SELECT a.*') || s.startsWith('SELECT p.*')) return [];
    if (s.startsWith('UPDATE acervo_precedentes SET') || s.startsWith('UPDATE acervo_pecas SET')) return [{ id: ID }];
    if (s.startsWith('INSERT INTO teses_acervo')) return [{ slug: params[0], label: params[1], drive_folder_id: params[2], ativo: true }];
    if (s.startsWith('UPDATE teses_acervo')) return [{ slug: params.at(-1), label: params[0], ativo: true }];
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

test('rotas fora da lista (Drive, prazos, arquivar) → 404 mesmo com acervo_edicao', async () => {
  for (const [m, c] of [['POST', '/drive/documentos'], ['POST', `/prazos/${ID}/cumprir`], ['POST', `/pecas/${ID}/arquivar`], ['GET', '/contexto-processo']]) {
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
