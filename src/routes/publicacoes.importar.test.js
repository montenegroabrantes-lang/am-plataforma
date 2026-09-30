import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import express from 'express';

// S-08 (chave do GitHub Actions em tempo constante, sem webhook morto) e S-23 (link só https://).
// O backend não pode quebrar quem chama de fora: o workflow "Sync Publicações PJe" manda POST com x-sync-key.

const { db } = await import('../db/index.js');
let inserts;
let consultas;
function instalarBancoFalso() {
  inserts = [];
  consultas = 0;
  db.query = async (sql, params = []) => {
    consultas++;
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('INSERT INTO publicacoes')) { inserts.push(params); return [{ inserted: true }]; }
    if (s.startsWith('INSERT INTO configuracoes')) return [];
    if (s.includes('FROM processos')) return [];
    throw new Error(`consulta inesperada no teste: ${s.slice(0, 70)}`);
  };
  db.queryOne = async () => null;
  db.execute = async () => ({ rows: [] });
}
instalarBancoFalso();

const { publicacoesRouter, importarPublicacoesHandler } = await import('./publicacoes.js');

const CHAVE = 'chave-de-teste-somente-em-memoria-0123456789';
const MASTER = { id: '44444444-4444-4444-8444-444444444444', perfil: 'master' };

const app = express();
app.use(express.json());
app.post('/api/publicacoes/importar', importarPublicacoesHandler);
app.use('/api/publicacoes', (req, _res, next) => { req.user = MASTER; next(); }, publicacoesRouter);
const servidor = app.listen(0);
const base = `http://127.0.0.1:${servidor.address().port}`;
after(() => servidor.close());

const anterior = process.env.SYNC_KEY;
after(() => { if (anterior === undefined) delete process.env.SYNC_KEY; else process.env.SYNC_KEY = anterior; });
beforeEach(() => { process.env.SYNC_KEY = CHAVE; instalarBancoFalso(); });

const item = (id, link, extra = {}) => ({ id, ativo: true, numero_processo: '00000000000000000000', data_disponibilizacao: '2026-09-29', siglaTribunal: 'TJPB', link, ...extra });

async function importar(chave, corpo = { items: [] }) {
  const headers = { 'Content-Type': 'application/json' };
  if (chave !== undefined) headers['x-sync-key'] = chave;
  const r = await fetch(`${base}/api/publicacoes/importar`, { method: 'POST', headers, body: JSON.stringify(corpo) });
  return { status: r.status, corpo: await r.json().catch(() => null) };
}

// ── S-08: a chave ─────────────────────────────────────────────────────────
test('servidor sem SYNC_KEY → 503 (mesmo se o chamador mandar alguma chave)', async () => {
  delete process.env.SYNC_KEY;
  for (const chave of [undefined, '', 'qualquer-coisa']) {
    const r = await importar(chave);
    assert.equal(r.status, 503);
  }
  assert.equal(consultas, 0);
});

test('sem chave, chave errada, de tamanho diferente ou só o começo da certa → 401 e o banco não é tocado', async () => {
  for (const chave of [undefined, '', 'errada', CHAVE.slice(0, 10), CHAVE + 'x', CHAVE.toUpperCase(), CHAVE.replace(/.$/, 'X')]) {
    const r = await importar(chave, { items: [item('1', 'https://exemplo.test/a')] });
    assert.equal(r.status, 401, `chave ${JSON.stringify(chave)}`);
    assert.equal(r.corpo.ok, false);
  }
  assert.equal(consultas, 0);
  assert.equal(inserts.length, 0);
});

test('chave certa sem itens → 200 e nada gravado', async () => {
  const r = await importar(CHAVE, { items: [] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo, { ok: true, inseridas: 0, vinculadas: 0 });
  assert.equal(consultas, 0);
});

test('chave certa com itens → segue e grava (o fluxo do GitHub Actions continua funcionando)', async () => {
  const r = await importar(CHAVE, { items: [item('101', 'https://pje.exemplo.test/x'), item('102', 'https://pje.exemplo.test/y')] });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.ok, true);
  assert.equal(r.corpo.inseridas, 2);
  assert.equal(inserts.length, 2);
});

test('a comparação usa mesmaChave (tempo constante), não !==', () => {
  const fonte = readFileSync(new URL('./publicacoes.js', import.meta.url), 'utf8');
  assert.ok(fonte.includes("from '../utils/seguranca.js'"));
  assert.ok(/mesmaChave\(req\.headers\['x-sync-key'\], chaveEnv\)/.test(fonte));
  assert.ok(!/x-sync-key'\]\s*!==/.test(fonte), 'sem comparação direta com !==');
});

test('a integração da Camila e o importar de publicações usam a MESMA função de comparação', () => {
  const camila = readFileSync(new URL('./integracaoCamila.js', import.meta.url), 'utf8');
  assert.ok(camila.includes("from '../utils/seguranca.js'"));
  assert.ok(!/timingSafeEqual/.test(camila), 'a cópia local saiu');
});

// ── S-08: webhook morto removido ──────────────────────────────────────────
test('webhook DataJud removido: arquivo, import e montagem sumiram do backend', async () => {
  assert.equal(existsSync(new URL('./webhook.js', import.meta.url)), false);
  const index = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  assert.ok(!/webhook/i.test(index), 'index.js não fala mais de webhook');
  const r = await fetch(`${base}/api/webhook/datajud`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"numeroProcesso":"1"}' });
  assert.equal(r.status, 404);
  const g = await fetch(`${base}/api/webhook/datajud/status`);
  assert.equal(g.status, 404);
});

// ── S-23: link só https:// ────────────────────────────────────────────────
const LINKS_RUINS = ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'http://pje.exemplo.test/x', 'file:///etc/passwd', '//exemplo.test/x', 'exemplo.test', '', 'https://usuario:senha@exemplo.test'];

test('importar (chave): link fora de https vira null, https é mantido, e o lote NÃO é derrubado', async () => {
  const items = [item('201', 'https://pje.exemplo.test/ok'), ...LINKS_RUINS.map((l, i) => item(String(300 + i), l)), item('999', undefined)];
  const r = await importar(CHAVE, { items });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.inseridas, items.length, 'todas as publicações entram, só o link ruim é descartado');
  const linkDe = id => inserts.find(p => p[0] === id)[10];
  assert.equal(linkDe('201'), 'https://pje.exemplo.test/ok');
  for (let i = 0; i < LINKS_RUINS.length; i++) assert.equal(linkDe(String(300 + i)), null, JSON.stringify(LINKS_RUINS[i]));
  assert.equal(linkDe('999'), null);
});

test('importar-browser (Master): mesma regra de link', async () => {
  const items = [item('401', 'https://pje.exemplo.test/ok'), item('402', 'javascript:alert(document.cookie)'), item('403', 'http://pje.exemplo.test/x')];
  const r = await fetch(`${base}/api/publicacoes/importar-browser`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
  assert.equal(r.status, 200);
  const linkDe = id => inserts.find(p => p[0] === id)[10];
  assert.equal(linkDe('401'), 'https://pje.exemplo.test/ok');
  assert.equal(linkDe('402'), null);
  assert.equal(linkDe('403'), null);
});

test('o UPSERT preserva o link bom já gravado quando o novo vem inválido (COALESCE)', () => {
  const fonte = readFileSync(new URL('./publicacoes.js', import.meta.url), 'utf8');
  assert.ok(fonte.includes('link = COALESCE(EXCLUDED.link, publicacoes.link)'));
});
