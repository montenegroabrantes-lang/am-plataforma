import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

// S-08 — o workflow do GitHub Actions ("Sync Publicações PJe") não pode ter chave escrita no arquivo:
// sem o secret SYNC_KEY ele falha ANTES de consultar qualquer coisa; com o secret, envia exatamente ele.
// O script embutido no YAML é extraído e executado num processo à parte, com `fetch` substituído
// (nenhuma chamada de rede real).

const YML = readFileSync(new URL('../../.github/workflows/sync-publicacoes.yml', import.meta.url), 'utf8');

function scriptEmbutido() {
  const linhas = YML.split('\n');
  const ini = linhas.findIndex(l => /node - <<'EOF'/.test(l));
  const fim = linhas.findIndex((l, i) => i > ini && l.trim() === 'EOF');
  assert.ok(ini > 0 && fim > ini, 'heredoc do script encontrado');
  const corpo = linhas.slice(ini + 1, fim);
  const recuo = Math.min(...corpo.filter(l => l.trim()).map(l => l.match(/^ */)[0].length));
  return corpo.map(l => l.slice(recuo)).join('\n');
}

const dir = mkdtempSync(path.join(tmpdir(), 'wf-sync-'));
after(() => rmSync(dir, { recursive: true, force: true }));
writeFileSync(path.join(dir, 'script.mjs'), scriptEmbutido());
// `fetch` falso: a consulta ao Comunica devolve 1 publicação; o POST ao Railway é registrado e respondido.
writeFileSync(path.join(dir, 'fetch-falso.mjs'), `
const chamadas = [];
globalThis.fetch = async (url, opcoes = {}) => {
  chamadas.push({ url: String(url), metodo: opcoes.method || 'GET', chave: opcoes.headers?.['x-sync-key'] ?? null });
  if (String(url).startsWith('https://comunicaapi.pje.jus.br/')) {
    return { ok: true, status: 200, json: async () => ({ status: 'success', count: 1, items: [{ id: 1, numero_processo: '00000000000000000000', ativo: true }] }) };
  }
  return { ok: true, status: 200, json: async () => ({ ok: true, inseridas: 1, vinculadas: 0 }) };
};
process.on('exit', () => { console.log('CHAMADAS=' + JSON.stringify(chamadas)); });
`);

function rodar(env) {
  return spawnSync(process.execPath, ['--import', path.join(dir, 'fetch-falso.mjs'), path.join(dir, 'script.mjs')], {
    encoding: 'utf8', timeout: 30000, env: { PATH: process.env.PATH, ...env },
  });
}
const chamadasDe = r => JSON.parse((r.stdout.match(/CHAMADAS=(.*)/) || [, '[]'])[1]);

test('o YAML não tem valor padrão para SYNC_KEY (nada de "|| \'...\'" na chave)', () => {
  assert.ok(!/SYNC_KEY\s*\|\|/.test(YML));
  assert.ok(!/const\s+KEY\s*=\s*[^;]*\|\|/.test(YML));
  assert.ok(/SYNC_KEY:\s*\$\{\{\s*secrets\.SYNC_KEY\s*\}\}/.test(YML), 'a chave continua vindo do secret');
});

test('sem SYNC_KEY (ausente ou vazia): falha (exit 1) antes de qualquer chamada de rede', () => {
  for (const env of [{ RAILWAY_URL: 'https://api.exemplo.test' }, { RAILWAY_URL: 'https://api.exemplo.test', SYNC_KEY: '' }]) {
    const r = rodar(env);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /SYNC_KEY ausente/);
    assert.deepEqual(chamadasDe(r), [], 'nenhuma consulta ao Comunica, nenhum envio');
  }
});

test('com SYNC_KEY: consulta o Comunica e envia ao Railway com exatamente essa chave (o fluxo continua funcionando)', () => {
  const r = rodar({ RAILWAY_URL: 'https://api.exemplo.test', SYNC_KEY: 'chave-ficticia-do-teste' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Importado — 1 novas/);
  const chamadas = chamadasDe(r);
  const envio = chamadas.find(c => c.metodo === 'POST');
  assert.equal(envio.url, 'https://api.exemplo.test/api/publicacoes/importar');
  assert.equal(envio.chave, 'chave-ficticia-do-teste');
});
