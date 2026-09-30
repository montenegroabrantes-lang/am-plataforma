// S-21 — a regra única de visibilidade de processos. Sem banco: o `conexao` é um dublê.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { podeVerProcesso, filtroVisibilidade, usuarioVeVisibilidade } from './visibilidade.js';

const PID = '11111111-1111-4111-8111-111111111111';
const master = { id: 'm1', perfil: 'master' };
const master01 = { id: 'm0', perfil: 'master', pode_marcar_restrito: true };
const junior = { id: 'j1', perfil: 'junior' };

// dublê: devolve a linha pedida e conta as consultas
function conexaoCom(linha) {
  const chamadas = [];
  return { chamadas, async queryOne(sql, params) { chamadas.push({ sql, params }); return linha; } };
}

test('usuarioVeVisibilidade: normal todos veem; restrito só o Master 01', () => {
  for (const u of [master, master01, junior, null, undefined]) assert.equal(usuarioVeVisibilidade(u, 'normal'), true);
  assert.equal(usuarioVeVisibilidade(master01, 'restrito'), true);
  assert.equal(usuarioVeVisibilidade(master, 'restrito'), false);
  assert.equal(usuarioVeVisibilidade(junior, 'restrito'), false);
  assert.equal(usuarioVeVisibilidade(null, 'restrito'), false);
  assert.equal(usuarioVeVisibilidade({ pode_marcar_restrito: false }, 'restrito'), false);
});

test('filtroVisibilidade: vazio para o Master 01; trecho AND com o alias pedido para os demais', () => {
  assert.equal(filtroVisibilidade(master01), '');
  assert.equal(filtroVisibilidade(master), `AND (p.visibilidade = 'normal')`);
  assert.equal(filtroVisibilidade(junior, 'processos'), `AND (processos.visibilidade = 'normal')`);
  assert.equal(filtroVisibilidade(undefined), `AND (p.visibilidade = 'normal')`);
});

test('podeVerProcesso: true / false / null conforme a visibilidade e o usuário', async () => {
  assert.equal(await podeVerProcesso(master, PID, conexaoCom({ visibilidade: 'normal' })), true);
  assert.equal(await podeVerProcesso(junior, PID, conexaoCom({ visibilidade: 'normal' })), true);
  assert.equal(await podeVerProcesso(master01, PID, conexaoCom({ visibilidade: 'restrito' })), true);
  assert.equal(await podeVerProcesso(master, PID, conexaoCom({ visibilidade: 'restrito' })), false);
  assert.equal(await podeVerProcesso(junior, PID, conexaoCom({ visibilidade: 'restrito' })), false);
  assert.equal(await podeVerProcesso(master, PID, conexaoCom(null)), null, 'processo inexistente');
});

test('podeVerProcesso: id malformado ou ausente vira null SEM consultar o banco', async () => {
  const c = conexaoCom({ visibilidade: 'normal' });
  for (const id of ['nao-uuid', '', null, undefined, "1' OR '1'='1", 42]) assert.equal(await podeVerProcesso(master, id, c), null, String(id));
  assert.equal(c.chamadas.length, 0);
});

test('podeVerProcesso: consulta só a visibilidade, parametrizada pelo id', async () => {
  const c = conexaoCom({ visibilidade: 'normal' });
  await podeVerProcesso(master, PID, c);
  assert.equal(c.chamadas.length, 1);
  assert.match(c.chamadas[0].sql, /SELECT visibilidade FROM processos WHERE id = \$1/);
  assert.deepEqual(c.chamadas[0].params, [PID]);
});
