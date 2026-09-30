import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

// S-23 — links do acervo (Drive e fonte primária) só com https://. Fora disso: 422, nada gravado.
// Vazio continua valendo como "sem link".

const { db } = await import('../db/index.js');
let inserts;   // { tabela, params }
let updates;
function instalarBancoFalso() {
  inserts = []; updates = [];
  db.query = async (sql, params = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('SELECT slug FROM teses_acervo')) return params[0].map(slug => ({ slug }));
    if (s.startsWith('INSERT INTO acervo_pecas ')) { inserts.push({ tabela: 'acervo_pecas', params }); return [{ id: '55555555-5555-4555-8555-555555555555' }]; }
    if (s.startsWith('INSERT INTO acervo_precedentes ')) { inserts.push({ tabela: 'acervo_precedentes', params }); return [{ id: '66666666-6666-4666-8666-666666666666' }]; }
    if (s.startsWith('UPDATE acervo_precedentes SET conferido=true')) { updates.push(params); return [{ id: params[2] }]; }
    throw new Error(`consulta inesperada no teste: ${s.slice(0, 70)}`);
  };
  db.queryOne = async () => null;
  db.execute = async () => ({ rows: [] });
}
instalarBancoFalso();
beforeEach(instalarBancoFalso);

const { acervoRouter } = await import('./acervo.js');
const app = express();
app.use(express.json());
let perfil = 'master';
app.use((req, _res, next) => { req.user = { id: '44444444-4444-4444-8444-444444444444', perfil, pode_marcar_restrito: true }; next(); });
app.use('/api/acervo', acervoRouter);
const servidor = app.listen(0);
const base = `http://127.0.0.1:${servidor.address().port}`;
after(() => servidor.close());

async function enviar(metodo, caminho, corpo) {
  const r = await fetch(`${base}/api/acervo${caminho}`, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  return { status: r.status, corpo: await r.json().catch(() => null) };
}
const peca = (extra = {}) => ({ teses: ['fgts'], titulo: 'Inicial de teste', tipo_peca: 'inicial', ente: 'estado-paraiba', instancia: '1grau', ...extra });
const precedente = (extra = {}) => ({ teses: ['fgts'], orgao: 'Turma Recursal', instancia: 'turma-recursal', data_julgamento: '2026-09-01', ratio: 'Fundamento fictício.', resultado: 'provido', favoravel: true, ...extra });
const RUINS = ['javascript:alert(1)', 'data:text/html,x', 'http://drive.exemplo.test/x', 'ftp://exemplo.test', 'exemplo.test/x', 'https://u:p@exemplo.test', 'https://exem plo.test'];

// índices dos parâmetros nos INSERTs (ver a rota)
const IDX_PECA_DRIVE_URL = 14;
const IDX_PREC_FONTE = 13;
const IDX_PREC_DRIVE_URL = 15;

test('POST /pecas: drive_url com javascript:/data:/http: → 422 e nada é gravado', async () => {
  for (const ruim of RUINS) {
    const r = await enviar('POST', '/pecas', peca({ drive_url: ruim }));
    assert.equal(r.status, 422, ruim);
    assert.equal(r.corpo.erro, 'validacao');
    assert.match(r.corpo.mensagem, /https:\/\//);
  }
  assert.equal(inserts.length, 0);
});

test('POST /pecas: https é gravado como veio; vazio/ausente grava null', async () => {
  let r = await enviar('POST', '/pecas', peca({ drive_url: 'https://drive.google.com/file/d/abc/view' }));
  assert.equal(r.status, 201);
  assert.equal(inserts.at(-1).params[IDX_PECA_DRIVE_URL], 'https://drive.google.com/file/d/abc/view');
  for (const vazio of [undefined, '', '   ', null]) {
    r = await enviar('POST', '/pecas', peca({ drive_url: vazio }));
    assert.equal(r.status, 201, JSON.stringify(vazio));
    assert.equal(inserts.at(-1).params[IDX_PECA_DRIVE_URL], null);
  }
});

test('POST /precedentes: fonte_primaria_url e drive_url ruins → 422; https passa', async () => {
  for (const ruim of RUINS) {
    assert.equal((await enviar('POST', '/precedentes', precedente({ fonte_primaria_url: ruim }))).status, 422, `fonte ${ruim}`);
    assert.equal((await enviar('POST', '/precedentes', precedente({ drive_url: ruim }))).status, 422, `drive ${ruim}`);
  }
  assert.equal(inserts.length, 0);
  const ok = await enviar('POST', '/precedentes', precedente({ fonte_primaria_url: 'https://www.stf.jus.br/x', drive_url: 'https://drive.google.com/y' }));
  assert.equal(ok.status, 201);
  assert.equal(inserts.at(-1).params[IDX_PREC_FONTE], 'https://www.stf.jus.br/x');
  assert.equal(inserts.at(-1).params[IDX_PREC_DRIVE_URL], 'https://drive.google.com/y');
  const semLinks = await enviar('POST', '/precedentes', precedente());
  assert.equal(semLinks.status, 201);
  assert.equal(inserts.at(-1).params[IDX_PREC_FONTE], null);
  assert.equal(inserts.at(-1).params[IDX_PREC_DRIVE_URL], null);
});

test('PATCH /precedentes/:id/conferir: fonte fora de https → 422 sem gravar; https confere', async () => {
  const id = '66666666-6666-4666-8666-666666666666';
  for (const ruim of RUINS) {
    const r = await enviar('PATCH', `/precedentes/${id}/conferir`, { fonte_primaria_url: ruim });
    assert.equal(r.status, 422, ruim);
  }
  assert.equal(updates.length, 0);
  const vazio = await enviar('PATCH', `/precedentes/${id}/conferir`, { fonte_primaria_url: '' });
  assert.equal(vazio.status, 422);
  const ok = await enviar('PATCH', `/precedentes/${id}/conferir`, { fonte_primaria_url: '  https://www.stf.jus.br/processos/1  ' });
  assert.equal(ok.status, 200);
  assert.equal(updates.length, 1);
  assert.equal(updates[0][1], 'https://www.stf.jus.br/processos/1');
});

test('não-Master continua recusado (403) antes de qualquer validação de link', async () => {
  perfil = 'junior';
  try {
    assert.equal((await enviar('POST', '/pecas', peca({ drive_url: 'https://drive.google.com/x' }))).status, 403);
    assert.equal((await enviar('POST', '/precedentes', precedente())).status, 403);
  } finally { perfil = 'master'; }
});
