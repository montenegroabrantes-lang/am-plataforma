import test from 'node:test';
import assert from 'node:assert/strict';
import {
  siglaEnte, nomePastaEquipe, palavrasDoNome, semelhancaNomes, clienteDaPasta,
  numerosCnj, ehComprovante, pastasConfiguradas,
} from './pastasEquipe.js';

test('siglaEnte: padrões da equipe e polo desconhecido em maiúsculas', () => {
  assert.equal(siglaEnte('Estado da Paraíba'), 'PB');
  assert.equal(siglaEnte('Município de João Pessoa'), 'PMJP');
  assert.equal(siglaEnte('EMLUR - Autarquia Especial Municipal de Limpeza Urbana'), 'EMLUR');
  assert.equal(siglaEnte('Município de Natal'), 'NATAL');
  assert.equal(siglaEnte('União Federal'), 'UNIAO');
  assert.equal(siglaEnte('Município de Alhandra'), 'MUNICIPIO DE ALHANDRA');
  assert.equal(siglaEnte(''), null);
});

test('nomePastaEquipe: "NOME x ENTE" sem acento', () => {
  assert.equal(nomePastaEquipe('Ismania Ferreira De Oliveira Vitorino', 'Estado da Paraíba'), 'ISMANIA FERREIRA DE OLIVEIRA VITORINO x PB');
  assert.equal(nomePastaEquipe('José  Araújo', null), 'JOSE ARAUJO');
});

test('palavrasDoNome: ignora ente, complementos e ligações', () => {
  assert.deepEqual(palavrasDoNome('VERA LUCIA VITORINO X PMJP - AUX SALA DE AULA'), ['VERA', 'LUCIA', 'VITORINO']);
  assert.deepEqual(palavrasDoNome('HUDISON CLEBER DE BRITO FERREIRA x PB -PROF'), ['HUDISON', 'CLEBER', 'BRITO', 'FERREIRA', 'PB', 'PROF'].slice(0, 4));
});

test('semelhancaNomes: tolera erro de digitação, exige o primeiro nome', () => {
  assert.ok(semelhancaNomes('FRANKLIN HERIK SOARES DE MATO LOURENCO x PB', 'FRANKLIN HERIK SOARES DE MATOS LOURENCO') >= 0.8);
  assert.equal(semelhancaNomes('MARIA DA SILVA x PB', 'ANA DA SILVA'), 0);
  assert.ok(semelhancaNomes('VERA LUCIA VITORINO X PMJP', 'VERA LUCIA') < 0.8);
});

test('clienteDaPasta: pasta vinculada vence; nome único casa; dois candidatos = ambíguo', () => {
  const clientes = [
    { id: 'a', nome: 'FRANKLIN HERIK SOARES DE MATOS LOURENCO', drive_pasta_id: 'p-sistema' },
    { id: 'b', nome: 'Ismania Ferreira De Oliveira Vitorino', drive_pasta_id: null },
    { id: 'c', nome: 'JOSE CARLOS SILVA', drive_pasta_id: null },
    { id: 'd', nome: 'JOSE CARLOS SILVA', drive_pasta_id: null },
  ];
  assert.equal(clienteDaPasta({ id: 'p-sistema', nome: 'qualquer' }, clientes).por, 'pasta_vinculada');
  const f = clienteDaPasta({ id: 'p1', nome: 'FRANKLIN HERIK SOARES DE MATO LOURENCO x PB' }, clientes);
  assert.equal(f.cliente.id, 'a'); assert.equal(f.por, 'nome');
  assert.equal(clienteDaPasta({ id: 'p2', nome: 'ISMANIA FERREIRA DE OLIVEIRA VITORINO x PB' }, clientes).cliente.id, 'b');
  const amb = clienteDaPasta({ id: 'p3', nome: 'JOSE CARLOS SILVA x PB' }, clientes);
  assert.equal(amb.por, 'ambiguo'); assert.equal(amb.candidatos.length, 2);
  assert.equal(clienteDaPasta({ id: 'p4', nome: 'VERA LUCIA VITORINO X PMJP' }, clientes).por, 'nenhum');
});

test('numerosCnj e ehComprovante', () => {
  assert.deepEqual(numerosCnj('Processo 0801815-11.2026.8.15.2001 distribuído; ref 0801815-11.2026.8.15.2001'), ['0801815-11.2026.8.15.2001']);
  assert.ok(ehComprovante('Comprovante PROTOCOLO FGTS 13 FERIAS - IRADIRA X PMJP.pdf'));
  assert.ok(!ehComprovante('PROCURACAO - FULANO.pdf'));
});

test('pastasConfiguradas: lê ids do ambiente', () => {
  assert.deepEqual(pastasConfiguradas({ GOOGLE_DRIVE_PASTA_PENDENTES: 'pendAM, pend', GOOGLE_DRIVE_PASTA_OUTORGANTES: 'out26, out25' }), { pendentes: 'pendAM', pendentesTodas: ['pendAM', 'pend'], outorgantes: ['out26', 'out25'] });
  assert.deepEqual(pastasConfiguradas({}), { pendentes: null, pendentesTodas: [], outorgantes: [] });
});
