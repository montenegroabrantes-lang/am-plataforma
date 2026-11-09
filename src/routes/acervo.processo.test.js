import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

// A peça registrada pelas skills chega só com o número CNJ. O acervo liga a peça ao processo
// (e ao cliente) quando o número aponta para um único processo; senão grava só o texto.

const PROC_1G = '11111111-1111-4111-8111-111111111111';
const PROC_2G = '22222222-2222-4222-8222-222222222222';
const CLIENTE = '33333333-3333-4333-8333-333333333333';
const NUMERO = '5021017-44.2025.4.03.6100';

const { db } = await import('../db/index.js');
let inserts, buscas, processos, listagens;
function instalarBancoFalso() {
  inserts = []; buscas = []; listagens = [];
  processos = [{ id: PROC_1G, numero: NUMERO, grau: '1', cliente_id: CLIENTE, visibilidade: 'normal', cliente_nome: 'CLIENTE TESTE' }];
  db.query = async (sql, params = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('SELECT slug FROM teses_acervo')) return params[0].map(slug => ({ slug }));
    if (s.startsWith('SELECT p.id, p.numero, p.grau')) { buscas.push(params[0]); return processos.filter(p => p.numero.replace(/\D/g, '') === params[0]); }
    if (s.startsWith('INSERT INTO acervo_pecas ')) { inserts.push(params); return [{ id: '55555555-5555-4555-8555-555555555555' }]; }
    if (s.startsWith('INSERT INTO acervo_precedentes ')) { inserts.push(params); return [{ id: '66666666-6666-4666-8666-666666666666' }]; }
    if (s.startsWith('SELECT a.*')) { listagens.push({ sql: s, params }); return []; }
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
app.use((req, _res, next) => { req.user = { id: '44444444-4444-4444-8444-444444444444', perfil: 'master', pode_marcar_restrito: true }; next(); });
app.use('/api/acervo', acervoRouter);
const servidor = app.listen(0);
const base = `http://127.0.0.1:${servidor.address().port}`;
after(() => servidor.close());

async function enviar(caminho, corpo) {
  const r = await fetch(`${base}/api/acervo${caminho}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  return { status: r.status, corpo: await r.json().catch(() => null) };
}
const peca = (extra = {}) => ({ teses: ['fgts'], titulo: 'Inicial', tipo_peca: 'inicial', ente: 'uniao', instancia: '1grau', ...extra });
// índices no INSERT de acervo_pecas: 0 processo_id, 1 processo_numero, 2 cliente_id, 3 cliente_nome
const IDX = { processo: 0, numero: 1, cliente: 2, nome: 3 };

test('número CNJ de processo existente liga a peça ao processo e ao cliente', async () => {
  const r = await enviar('/pecas', peca({ processo_numero: '50210174420254036100', cliente_nome: 'nome digitado' }));
  assert.equal(r.status, 201);
  assert.deepEqual(buscas, ['50210174420254036100']);
  assert.equal(inserts[0][IDX.processo], PROC_1G);
  assert.equal(inserts[0][IDX.numero], NUMERO);
  assert.equal(inserts[0][IDX.cliente], CLIENTE);
  assert.equal(inserts[0][IDX.nome], 'CLIENTE TESTE');
});

test('número com pontuação também é encontrado', async () => {
  const r = await enviar('/pecas', peca({ processo_numero: NUMERO }));
  assert.equal(r.status, 201);
  assert.equal(inserts[0][IDX.processo], PROC_1G);
});

test('número que não existe no AM grava só o texto, sem erro', async () => {
  const r = await enviar('/pecas', peca({ processo_numero: '0000001-00.2026.8.15.2001', cliente_nome: 'Fulano' }));
  assert.equal(r.status, 201);
  assert.equal(inserts[0][IDX.processo], null);
  assert.equal(inserts[0][IDX.numero], '0000001-00.2026.8.15.2001');
  assert.equal(inserts[0][IDX.nome], 'Fulano');
});

test('número incompleto não consulta o banco', async () => {
  const r = await enviar('/pecas', peca({ processo_numero: '123' }));
  assert.equal(r.status, 201);
  assert.equal(buscas.length, 0);
  assert.equal(inserts[0][IDX.processo], null);
});

test('mesmo número em 1º e 2º grau: desempata pela instância', async () => {
  processos.push({ ...processos[0], id: PROC_2G, grau: '2' });
  const r2 = await enviar('/pecas', peca({ processo_numero: NUMERO, instancia: '2grau', tipo_peca: 'apelacao' }));
  assert.equal(r2.status, 201);
  assert.equal(inserts[0][IDX.processo], PROC_2G);
});

test('mesmo número em dois processos sem instância que desempate: não liga', async () => {
  processos.push({ ...processos[0], id: PROC_2G, grau: '2' });
  const r = await enviar('/pecas', peca({ processo_numero: NUMERO, instancia: 'stj', tipo_peca: 'recurso-especial' }));
  assert.equal(r.status, 201);
  assert.equal(inserts[0][IDX.processo], null);
});

test('precedente com número CNJ também é ligado ao processo', async () => {
  const r = await enviar('/precedentes', { teses: ['fgts'], orgao: 'Turma', instancia: '1grau', data_julgamento: '2026-09-01', ratio: 'x', resultado: 'procedente', processo_numero: NUMERO });
  assert.equal(r.status, 201);
  assert.equal(inserts[0][0], PROC_1G);
});

test('GET ?processo_id filtra as peças do processo; id inválido → 400', async () => {
  const ok = await fetch(`${base}/api/acervo?aba=pecas&processo_id=${PROC_1G}`);
  assert.equal(ok.status, 200);
  assert.match(listagens[0].sql, /a\.processo_id=\$1/);
  assert.equal(listagens[0].params[0], PROC_1G);
  const ruim = await fetch(`${base}/api/acervo?aba=pecas&processo_id=abc`);
  assert.equal(ruim.status, 400);
});
