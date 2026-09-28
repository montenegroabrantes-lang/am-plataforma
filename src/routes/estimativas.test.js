import test from 'node:test';
import assert from 'node:assert/strict';
import { buscarClientesExistentesPorNome } from './estimativas.js';

// O mock devolve exatamente o formato que a query com similarity()/pg_trgm devolveria:
// já filtrada (posicao = 1 AND acima_do_limiar = 1), então um lead com homônimo (mais de um
// cliente acima do limiar) simplesmente não aparece nas linhas -- é assim que a função de
// verdade sinaliza "não escolho sozinho".
function bancoComLinhas(linhas) {
  return { async query() { return linhas; } };
}

test('cruzamento "já é cliente": encontra por similaridade de nome (pg_trgm)', async () => {
  const banco = bancoComLinhas([{
    lead_nome: 'Beatriz Azevedo',
    cliente_id: 'c1',
    cliente_nome: 'BEATRIZ AZEVEDO ALVES',
    cliente_criado_em: '2026-08-07',
  }]);
  const mapa = await buscarClientesExistentesPorNome(['Beatriz Azevedo', 'Outro Lead Sem Match'], banco);
  assert.equal(mapa.size, 1);
  assert.deepEqual(mapa.get('Beatriz Azevedo'), {
    id: 'c1',
    nome: 'BEATRIZ AZEVEDO ALVES',
    criado_em: '2026-08-07',
  });
  assert.equal(mapa.get('Outro Lead Sem Match'), undefined);
});

test('cruzamento "já é cliente": homônimo (mais de um cliente acima do limiar) não aparece', async () => {
  // O SQL real já filtra isso com "acima_do_limiar = 1"; aqui simulamos o caso ambíguo não
  // devolvendo nenhuma linha pro nome em questão -- exatamente o que a query faria.
  const banco = bancoComLinhas([]);
  const mapa = await buscarClientesExistentesPorNome(['Ana Silva'], banco);
  assert.equal(mapa.has('Ana Silva'), false);
});

test('cruzamento "já é cliente": sem nomes não consulta o banco', async () => {
  let chamou = false;
  const banco = { async query() { chamou = true; return []; } };
  const mapa = await buscarClientesExistentesPorNome([], banco);
  assert.equal(mapa.size, 0);
  assert.equal(chamou, false);
});
