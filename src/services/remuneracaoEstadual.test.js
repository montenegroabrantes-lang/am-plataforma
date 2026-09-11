import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buscarReferenciaEstadual,
  competenciasUltimosCincoAnos,
  consolidarRegistros,
  detectarUfEstadual,
} from './remuneracaoEstadual.js';

test('detecta apenas os estados suportados e tolera erros comuns em Pernambuco', () => {
  assert.equal(detectarUfEstadual('Governo do Estado da Paraíba'), 'PB');
  assert.equal(detectarUfEstadual('Estado de Pernanbuco'), 'PE');
  assert.equal(detectarUfEstadual('Estado de Pernenbuco'), 'PE');
  assert.equal(detectarUfEstadual('Município do Recife'), null);
});

test('limita a consulta a 60 competências e respeita período menor', () => {
  const agora = new Date('2026-09-15T12:00:00Z');
  const limitado = competenciasUltimosCincoAnos('07/2019', '', agora);
  assert.equal(limitado.length, 60);
  assert.deepEqual(limitado[0], { ano: 2021, mes: 10, indice: 2021 * 12 + 9 });
  assert.deepEqual(limitado.at(-1), { ano: 2026, mes: 9, indice: 2026 * 12 + 8 });

  const menor = competenciasUltimosCincoAnos('2026-07', '08/2026', agora);
  assert.equal(menor.length, 2);
});

test('consolida por vínculo, elimina duplicata mensal e exige nome exato', () => {
  const registros = [
    { nome: 'MARIA JOSÉ DA SILVA', matricula: '10', cargo: 'Professora', orgao: 'Secretaria de Educação', regime: 'Efetivo', admissao: '01/02/2020', competencia: '07/2026', indice: 1, remuneracao: 5000, totalVantagens: 5200 },
    { nome: 'MARIA JOSE DA SILVA', matricula: '10', cargo: 'Professora', orgao: 'Secretaria de Educação', regime: 'Efetivo', admissao: '01/02/2020', competencia: '07/2026', indice: 1, remuneracao: 5000, totalVantagens: 5200 },
    { nome: 'MARIA JOSE DA SILVA', matricula: '10', cargo: 'Professora', orgao: 'Secretaria de Educação', regime: 'Efetivo', admissao: '01/02/2020', competencia: '08/2026', indice: 2, remuneracao: 5100, totalVantagens: 5300 },
    { nome: 'MARIA JOSE SILVA SANTOS', matricula: '99', cargo: 'Professora', orgao: 'Secretaria de Educação', competencia: '08/2026', indice: 2, remuneracao: 99999, totalVantagens: 99999 },
  ];
  const resultado = consolidarRegistros(registros, {
    nome: 'Maria Jose da Silva', cargo: 'Professor', orgao: 'Estado da Paraíba - Educação',
  });
  assert.equal(resultado.length, 1);
  assert.equal(resultado[0].competencias_localizadas, 2);
  assert.equal(resultado[0].total_remuneracao_oficial, 10100);
  assert.equal(resultado[0].referencia_fgts_8pct, 808);
  assert.equal('cpf' in resultado[0], false);
});

test('consulta a API da Paraíba e devolve referência sem aprovar nada', async () => {
  const chamadas = [];
  const httpGet = async (_url, opcoes) => {
    chamadas.push(opcoes.params);
    return {
      data: {
        dados: [{
          nomeServidor: 'LUCAS BENJAMIN POTIGUARA',
          cpfServidor: '000.000.000-00',
          matricula: '123',
          nomeCargo: 'PROFESSOR',
          orgaoLotacao: 'SECRETARIA DE EDUCACAO',
          regimeContratual: 'EFETIVO',
          valorBruto: 6000,
          vantagemFixa: 5000,
          vantagemVariavel: 1000,
        }],
      },
    };
  };
  const resultado = await buscarReferenciaEstadual({
    nome: 'Lucas Benjamin Potiguara', cargo: 'Professor', orgao: 'Estado da Paraíba',
    inicio: '06/2026', fim: '07/2026', agora: new Date('2026-09-15T12:00:00Z'),
    httpGet, forcar: true,
  });
  assert.equal(chamadas.length, 2);
  assert.equal(chamadas[0].nomeServidor, 'Lucas Benjamin Potiguara');
  assert.equal(resultado.status, 'encontrado');
  assert.equal(resultado.vinculos[0].referencia_fgts_8pct, 960);
  assert.match(resultado.aviso, /conferência humana/i);
  assert.equal(JSON.stringify(resultado).includes('000.000.000-00'), false);
});

test('mapeia a resposta Pentaho de Pernambuco', async () => {
  const colunas = [
    'r_instituicao', 'r_matricula', 'r_nome', 'r_data_admissao', 'r_categoria',
    'r_cargo', 'r_remuneracao', 'r_total_vantagens', 'r_cpf',
  ];
  const httpGet = async (_url, opcoes) => {
    assert.equal(opcoes.params.parampara_ano, 2026);
    assert.equal(opcoes.params.parammes_, 8);
    return {
      data: {
        metadata: colunas.map(colName => ({ colName })),
        resultset: [[
          'SECRETARIA DE EDUCACAO', '456', 'EMYLLENA FIGUEREDO LEAL', '01/01/2020',
          'CONTRATO TEMPORARIO', 'PROFESSOR DE MATEMATICA', 5130.63, 5531.91, '000.000.000-00',
        ]],
      },
    };
  };
  const resultado = await buscarReferenciaEstadual({
    nome: 'Emyllena Figueredo Leal', cargo: 'Professor', orgao: 'Estado de Pernambuco',
    inicio: '08/2026', fim: '08/2026', agora: new Date('2026-09-15T12:00:00Z'),
    httpGet, forcar: true,
  });
  assert.equal(resultado.uf, 'PE');
  assert.equal(resultado.vinculos[0].cargo, 'PROFESSOR DE MATEMATICA');
  assert.equal(resultado.vinculos[0].referencia_fgts_8pct, 410.45);
  assert.equal(JSON.stringify(resultado).includes('000.000.000-00'), false);
});
