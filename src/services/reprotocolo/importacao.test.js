import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/index.js';
import { validarPasta, validarOficial, importarDados } from './importacao.js';

for (const metodo of ['query', 'queryOne', 'execute']) {
  db[metodo] = async () => { throw new Error('banco real proibido nos testes'); };
}

const C1 = '44444444-4444-4444-8444-444444444444';
const T1 = '11111111-1111-4111-8111-111111111111';
const DRIVE = '1S6IMMEkOnW2VbWAdweLbJMUAznwPQEBG';
const pasta = (extra = {}) => ({ cliente_id: C1, status: 'unica', drive_pasta_id: DRIVE, titulo: 'MARIA X PB', pai: 'Outorgantes 2024',
  duplicidade: [{ pasta: 'MARIA X PB', pai: '_REPROTOCOLO - 2026', criada: '2026-08-10', exato: true, teses: ['FGTS'], onda_fgts: true }],
  documentos: { identidade: { qtd: 2, ultima: '2024-03-10', exemplo: 'RG maria.pdf' }, inicial: { qtd: 1, ultima: '2024-05-02' }, outro: { qtd: 9 } }, ...extra });

test('validarPasta: aceita linha correta, descarta nome de arquivo e tipos desconhecidos', () => {
  const v = validarPasta(pasta());
  assert.ok(v.ok);
  assert.deepEqual(Object.keys(v.ok.documentos), ['identidade', 'inicial']);
  assert.equal(v.ok.documentos.identidade.exemplo, undefined, 'nomes de arquivos não entram');
  assert.equal(v.ok.duplicidade[0].onda_fgts, true);
});

test('validarPasta: recusa cliente, status e pasta inválidos', () => {
  assert.match(validarPasta(pasta({ cliente_id: 'x' })).erro, /cliente_id/);
  assert.match(validarPasta(pasta({ status: 'talvez' })).erro, /status/);
  assert.match(validarPasta(pasta({ drive_pasta_id: 'curto' })).erro, /drive_pasta_id/);
  assert.match(validarPasta(pasta({ status: 'unica', drive_pasta_id: null })).erro, /exige/);
  assert.ok(validarPasta(pasta({ status: 'nao_encontrada', drive_pasta_id: null, duplicidade: [], documentos: null })).ok);
  assert.ok(validarPasta({ ...pasta(), duplicidade: 'lixo' }).ok.duplicidade.length === 0);
});

test('validarOficial: exige tarefa e resultado; limpa campos', () => {
  const v = validarOficial({ tarefa_id: T1, resultado: { status: 'encontrado', correspondencia: 'unica', risco: '6118.034', vinculos: [{ regime: 'TEMPORARIO', ultima_paga: '2026-08', sem_pgto_meses: 1, ref8: 999, extra: 'x' }] } });
  assert.equal(v.ok.resultado.risco, 6118.03);
  assert.deepEqual(Object.keys(v.ok.resultado.vinculos[0]).sort(), ['admissao', 'cargo', 'competencias', 'orgao', 'regime', 'sem_pgto_meses', 'ultima_paga']);
  assert.match(validarOficial({ tarefa_id: 'x', resultado: { status: 'ok' } }).erro, /tarefa_id/);
  assert.match(validarOficial({ tarefa_id: T1, resultado: { status: 'erro' } }).erro, /resultado/);
  assert.equal(validarOficial({ tarefa_id: T1, resultado: { status: 'encontrado', risco: null } }).ok.resultado.risco, null);
});

test('importarDados: dry_run valida e conta sem gravar', async () => {
  const conexao = { async execute() { throw new Error('não pode gravar em dry_run'); } };
  const r = await importarDados({ conexao, pastas: [pasta(), pasta({ status: 'x' })], oficiais: [{ tarefa_id: T1, resultado: { status: 'encontrado' } }], usuarioId: 'm1', dryRun: true });
  assert.equal(r.dry_run, true);
  assert.deepEqual([r.pastas.validas, r.pastas.gravadas, r.pastas.recusadas.length, r.oficiais.validas, r.oficiais.gravadas], [1, 0, 1, 1, 0]);
});

test('importarDados: grava; pasta vinculada manualmente é mantida; tarefa inexistente é recusada', async () => {
  const chamadas = [];
  const conexao = { async execute(sql, params) {
    chamadas.push(sql.slice(0, 40));
    if (sql.includes('reprotocolo_pasta_antiga')) return { rowCount: params[0] === C1 ? 1 : 0 };      // 2ª pasta: manual (WHERE origem <> 'manual' não casa)
    return { rowCount: params[0] === T1 ? 1 : 0 };
  } };
  const C2 = '99999999-9999-4999-8999-999999999999';
  const T2 = '88888888-8888-4888-8888-888888888888';
  const r = await importarDados({ conexao, pastas: [pasta(), pasta({ cliente_id: C2 })], oficiais: [{ tarefa_id: T1, resultado: { status: 'encontrado' } }, { tarefa_id: T2, resultado: { status: 'encontrado' } }], usuarioId: 'm1', dryRun: false });
  assert.deepEqual([r.pastas.gravadas, r.pastas.mantidas_manuais], [1, 1]);
  assert.deepEqual([r.oficiais.gravadas, r.oficiais.recusadas.length], [1, 1]);
  assert.match(r.oficiais.recusadas[0].erro, /não existe/);
  assert.equal(chamadas.length, 4);
});
