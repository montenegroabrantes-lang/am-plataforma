import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buscarClienteParaCamila,
  normalizarNomeCliente,
  variantesTelefoneCliente,
} from './clienteCamila.js';

// Mock decide qual resultado devolver olhando o SQL: a query de telefone lista todos os
// clientes ativos, a query de nome (com similarity()/pg_trgm) devolve os candidatos já com
// a pontuação -- exatamente como o Postgres devolveria de verdade.
function criarBanco({ telefoneRows = [], nomeRows = [] } = {}) {
  return {
    async query(sql) {
      if (/similarity\(/.test(sql)) return nomeRows;
      return telefoneRows;
    },
  };
}

test('extrai o nome do cliente do título de contato do Digisac', () => {
  assert.equal(
    normalizarNomeCliente('JOSE CARLOS DA SILVA x ESTADO PB - JULIANO MOREIRA'),
    'JOSE CARLOS SILVA'
  );
  assert.equal(normalizarNomeCliente('José Carlos da Silva'), 'JOSE CARLOS SILVA');
});

test('compara telefone brasileiro com ou sem país e nono dígito', () => {
  const variantes = variantesTelefoneCliente('558386559174');
  assert.ok(variantes.includes('8386559174'));
  assert.ok(variantes.includes('5583986559174'));
});

test('localiza cliente por telefone e devolve somente o resumo necessário', async () => {
  const banco = criarBanco({
    telefoneRows: [{
      nome: 'JOSE CARLOS DA SILVA',
      whatsapp: '558386559174',
      ativo: true,
      vinculo_ativo: true,
      total_processos: 2,
    }],
  });
  const cliente = await buscarClienteParaCamila({
    telefone: '558386559174',
    nome: 'JOSE CARLOS DA SILVA x ESTADO PB - JULIANO MOREIRA',
  }, banco);
  assert.deepEqual(cliente, {
    nome: 'JOSE CARLOS DA SILVA',
    ativo: true,
    vinculoAtivo: true,
    possuiProcesso: true,
    totalProcessos: 2,
  });
  assert.equal('cpf' in cliente, false);
  assert.equal('numero' in cliente, false);
});

test('localiza cliente por nome via similarity() do pg_trgm quando o telefone não bate', async () => {
  const banco = criarBanco({
    telefoneRows: [],
    nomeRows: [{
      nome: 'JOSE CARLOS DA SILVA',
      whatsapp: null,
      ativo: true,
      vinculo_ativo: true,
      total_processos: 2,
      pontuacao: 1,
    }],
  });
  const cliente = await buscarClienteParaCamila({
    nome: 'JOSE CARLOS DA SILVA x ESTADO PB - JULIANO MOREIRA',
  }, banco);
  assert.deepEqual(cliente, {
    nome: 'JOSE CARLOS DA SILVA',
    ativo: true,
    vinculoAtivo: true,
    possuiProcesso: true,
    totalProcessos: 2,
  });
});

test('tolera pequena variação de digitação/acentuação no nome (fuzzy match)', async () => {
  const banco = criarBanco({
    telefoneRows: [],
    // "MARIA DE FATIMA NASCIMENTO" cadastrado, Digisac manda "MARIA FATIMA NASCIMENTO"
    // (sem o "DE") -- similarity() ainda encontra alta pontuação apesar da diferença.
    nomeRows: [{
      nome: 'MARIA DE FATIMA NASCIMENTO',
      whatsapp: null,
      ativo: true,
      vinculo_ativo: true,
      total_processos: 1,
      pontuacao: 0.82,
    }],
  });
  const cliente = await buscarClienteParaCamila({ nome: 'Maria Fatima Nascimento' }, banco);
  assert.equal(cliente?.nome, 'MARIA DE FATIMA NASCIMENTO');
});

test('não escolhe por nome quando há homônimos (mais de um acima do limiar)', async () => {
  const banco = criarBanco({
    telefoneRows: [],
    nomeRows: [
      { nome: 'ANA SILVA', whatsapp: null, ativo: true, vinculo_ativo: true, total_processos: 1, pontuacao: 1 },
      { nome: 'ANA SILVA', whatsapp: null, ativo: true, vinculo_ativo: true, total_processos: 3, pontuacao: 1 },
    ],
  });
  assert.equal(await buscarClienteParaCamila({ nome: 'Ana Silva' }, banco), null);
});

test('não escolhe quando a pontuação de similaridade fica abaixo do limiar', async () => {
  const banco = criarBanco({
    telefoneRows: [],
    // O SQL (WHERE ... % $1) normalmente já teria descartado isso, mas o filtro em JS é a
    // segunda trava de segurança caso o limiar do pg_trgm no banco esteja mais permissivo.
    nomeRows: [
      { nome: 'FRANCISCO DAS CHAGAS', whatsapp: null, ativo: true, vinculo_ativo: true, total_processos: 1, pontuacao: 0.31 },
    ],
  });
  assert.equal(await buscarClienteParaCamila({ nome: 'Francisco Chagas Neto' }, banco), null);
});
