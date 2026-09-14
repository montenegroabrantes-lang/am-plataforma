import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buscarClienteParaCamila,
  normalizarNomeCliente,
  variantesTelefoneCliente,
} from './clienteCamila.js';

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

test('localiza cliente por nome exato e devolve somente o resumo necessário', async () => {
  const banco = {
    async query() {
      return [{
        nome: 'JOSE CARLOS DA SILVA',
        whatsapp: null,
        ativo: true,
        vinculo_ativo: true,
        total_processos: 2,
      }];
    },
  };
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

test('não escolhe por nome quando há homônimos', async () => {
  const banco = {
    async query() {
      return [
        { nome: 'ANA SILVA', whatsapp: null, ativo: true, vinculo_ativo: true, total_processos: 1 },
        { nome: 'ANA SILVA', whatsapp: null, ativo: true, vinculo_ativo: true, total_processos: 3 },
      ];
    },
  };
  assert.equal(await buscarClienteParaCamila({ nome: 'Ana Silva' }, banco), null);
});
