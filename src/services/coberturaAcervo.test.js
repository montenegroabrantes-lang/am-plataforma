import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enteDoPoloPassivo, sugerirTese, listarCobertura } from './coberturaAcervo.js';

test('ente pelo polo passivo: variações de escrita', () => {
  const e = (t, trib) => enteDoPoloPassivo(t, trib).ente;
  assert.equal(e('ESTADO DA PARAÍBA'), 'estado-paraiba');
  assert.equal(e('Estado da Paraiba - Secretaria de Estado da Educação'), 'estado-paraiba');
  assert.equal(e('Município de João Pessoa – PMJP'), 'municipio-joao-pessoa');
  assert.equal(e('PREFEITURA MUNICIPAL DE JOAO PESSOA'), 'municipio-joao-pessoa');
  assert.equal(e('INSTITUTO NACIONAL DO SEGURO SOCIAL - INSS'), 'inss');
  assert.equal(e('UNIÃO FEDERAL'), 'uniao');
  assert.equal(e('ESTADO DE PERNAMBUCO'), 'estado-pernambuco');
  assert.equal(e('Assembleia Legislativa da Paraíba'), 'alpb');
  const pb = enteDoPoloPassivo('PARAIBA PREVIDENCIA - PBPREV');
  assert.deepEqual([pb.ente, pb.detalhe], ['estado-paraiba', 'PBPREV']);
  const outro = enteDoPoloPassivo('MUNICIPIO DE BAYEUX', 'TJPB');
  assert.deepEqual([outro.ente, outro.detalhe], ['municipio-outro-pb', 'BAYEUX']);
  assert.equal(e('MUNICIPIO DE BAYEUX', 'TJPE'), null, 'município fora da PB não é presumido');
});

test('ente: dois réus diferentes, vazio ou desconhecido → a definir com motivo', () => {
  assert.deepEqual(enteDoPoloPassivo('ESTADO DA PARAIBA e MUNICIPIO DE JOAO PESSOA'), { ente: null, detalhe: null, motivo: 'mais de um ente no polo passivo' });
  assert.equal(enteDoPoloPassivo('').motivo, 'polo passivo vazio');
  assert.equal(enteDoPoloPassivo('BANCO DO BRASIL S/A').motivo, 'ente não reconhecido');
});

const TESES = [
  { slug: 'fgts-nulidade', label: 'FGTS por nulidade de contrato temporário' },
  { slug: 'fgts-pernambuco', label: 'FGTS — Pernambuco', tese_mae: 'fgts-nulidade' },
  { slug: 'ferias-45-dias', label: '13º e férias sobre 45 dias' },
  { slug: 'piso-salarial-magisterio-pb', label: 'Piso salarial — magistério x PB' },
  { slug: 'adicional-noturno', label: 'Adicional noturno 25%' },
  { slug: 'insalubridade', label: 'Insalubridade' },
  { slug: 'insalubridade-profissional-saude', label: 'Insalubridade — profissional de saúde', tese_mae: 'insalubridade' },
  { slug: 'outros', label: 'Outros' },
];
test('sugestão de tese pelo nome do produto', () => {
  assert.equal(sugerirTese('FGTS', TESES), 'fgts-nulidade');
  assert.equal(sugerirTese('FGTS Pernambuco (CTD)', TESES), 'fgts-pernambuco');
  assert.equal(sugerirTese('Férias 45 dias', TESES), 'ferias-45-dias');
  assert.equal(sugerirTese('Piso do magistério', TESES), 'piso-salarial-magisterio-pb');
  assert.equal(sugerirTese('Insalubridade', TESES), 'insalubridade');
  assert.equal(sugerirTese('Adicional noturno', TESES), 'adicional-noturno');
  assert.equal(sugerirTese('Revisão de aposentadoria', TESES), null);
  assert.equal(sugerirTese('', TESES), null);
});

test('cobertura: pendências, decisão lida e filtros', async () => {
  const linhas = [
    { id: 'P1', numero: '0000001-00.2025.8.15.2001', tribunal: 'TJPB', polo_passivo: 'ESTADO DA PARAIBA', data_distribuicao: '2025-03-01', produto: 'FGTS', tese: 'fgts-nulidade', tem_drive: true,
      publicacao_id: 10, tipo_documento: 'Sentença', texto: 'Ante o exposto, JULGO PROCEDENTE. João Pessoa, 3 de novembro de 2026.', data_disponibilizacao: '2026-11-05', pub_tribunal: 'TJPB', orgao: 'Juízo' },
    { id: 'P2', numero: '0000002-00.2025.8.15.2001', tribunal: 'TJPB', polo_passivo: 'BANCO X', data_distribuicao: null, produto: 'Outro produto', tese: null, tem_drive: false },
  ];
  const banco = { query: async () => linhas };
  const r = await listarCobertura({}, banco);
  assert.equal(r.total, 2); assert.equal(r.com_decisao, 1); assert.equal(r.prontos, 1); assert.equal(r.sem_tese, 1);
  assert.deepEqual(r.processos[0].decisao, { publicacao_id: '10', tipo: 'Sentença', data: '2026-11-03', resultado: 'procedente' });
  assert.deepEqual(r.processos[1].pendencias, ['produto sem tese ligada', 'ente não reconhecido', 'sem data de distribuição']);
  assert.equal((await listarCobertura({ comDecisao: true }, banco)).filtrados, 1);
  assert.equal((await listarCobertura({ tese: 'fgts-nulidade' }, banco)).processos[0].processo_id, 'P1');
  assert.ok(!('cliente_nome' in r.processos[0]), 'sem nome de cliente');
});
