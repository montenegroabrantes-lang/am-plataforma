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
  assert.deepEqual(r.processos[1].pendencias, ['produto sem tese ligada', 'ente não reconhecido'], 'data não bloqueia (vem do DataJud)');
  assert.equal((await listarCobertura({ comDecisao: true }, banco)).filtrados, 1);
  assert.equal((await listarCobertura({ tese: 'fgts-nulidade' }, banco)).processos[0].processo_id, 'P1');
  assert.ok(!('cliente_nome' in r.processos[0]), 'sem nome de cliente');
});

test('cadastro retroativo em simulação: data do AM ou do DataJud, pendentes à parte, nada gravado', async () => {
  const { cadastrarRetroativas } = await import('./coberturaAcervo.js');
  const linhas = [
    { id: 'P1', numero: '0000001-00.2025.8.15.2001', tribunal: 'TJPB', polo_passivo: 'ESTADO DA PARAIBA', data_distribuicao: null, produto: 'FGTS', tese: 'fgts-nulidade', tem_drive: true },
    { id: 'P2', numero: '0000002-00.2025.8.15.2001', tribunal: 'TJPB', polo_passivo: 'MUNICIPIO DE JOAO PESSOA', data_distribuicao: '2024-02-01', produto: 'FGTS', tese: 'fgts-nulidade', tem_drive: false },
    { id: 'P3', numero: '0000003-00.2025.8.15.2001', tribunal: 'TJPB', polo_passivo: 'BANCO X', data_distribuicao: null, produto: 'FGTS', tese: 'fgts-nulidade', tem_drive: false },
  ];
  const banco = { query: async () => linhas, transaction: () => { throw new Error('não devia gravar'); } };
  const pedidos = [];
  const buscarDatas = async porTribunal => { pedidos.push([...porTribunal]); return { datas: new Map([['00000010020258152001', '2025-01-10']]), falhas: 0 }; };
  const r = await cadastrarRetroativas({ banco, buscarDatas });
  assert.deepEqual(pedidos, [[['TJPB', ['00000010020258152001']]]], 'só os sem data vão ao DataJud');
  assert.equal(r.criaria, 2); assert.equal(r.precisa_de_voce, 1); assert.equal(r.datas_do_datajud, 1); assert.equal(r.datas_do_am, 1);
  assert.deepEqual(r.itens.map(i => [i.processo_numero, i.data_protocolo, i.fonte_data]), [['0000001-00.2025.8.15.2001', '2025-01-10', 'DataJud'], ['0000002-00.2025.8.15.2001', '2024-02-01', 'AM']]);
  assert.deepEqual(r.precisa_de_voce_itens[0].pendencias, ['ente não reconhecido']);
  const lim = await cadastrarRetroativas({ banco, buscarDatas, limite: 1 });
  assert.equal(lim.selecionados, 1);
});

test('cadastro retroativo: datas informadas no pedido dispensam o DataJud; buscar_datajud=false não consulta', async () => {
  const { cadastrarRetroativas, datasInformadas } = await import('./coberturaAcervo.js');
  const linhas = [
    { id: 'P1', numero: '0000001-00.2025.8.15.2001', tribunal: 'TJPB', polo_passivo: 'ESTADO DA PARAIBA', data_distribuicao: null, produto: 'FGTS', tese: 'fgts-nulidade', tem_drive: true },
    { id: 'P2', numero: '0000002-00.2025.8.15.2001', tribunal: 'TJPB', polo_passivo: 'ESTADO DA PARAIBA', data_distribuicao: null, produto: 'FGTS', tese: 'fgts-nulidade', tem_drive: true },
  ];
  const banco = { query: async () => linhas, transaction: () => { throw new Error('não devia gravar'); } };
  const pedidos = [];
  const buscarDatas = async porTribunal => { pedidos.push([...porTribunal]); return { datas: new Map(), falhas: 1 }; };
  const r = await cadastrarRetroativas({ banco, buscarDatas, datas: { '0000001-00.2025.8.15.2001': '2025-03-04' } });
  assert.deepEqual(pedidos, [[['TJPB', ['00000020020258152001']]]], 'só o que não veio no pedido vai ao DataJud');
  assert.equal(r.datas_informadas, 1); assert.equal(r.sem_data, 1); assert.equal(r.datajud_consultado, true);
  assert.deepEqual(r.itens.map(i => [i.data_protocolo, i.fonte_data]), [['2025-03-04', 'DataJud'], [null, null]]);
  pedidos.length = 0;
  const sem = await cadastrarRetroativas({ banco, buscarDatas, buscarDataJud: false });
  assert.equal(pedidos.length, 0); assert.equal(sem.sem_data, 2); assert.equal(sem.datajud_consultado, false);
  assert.deepEqual([...datasInformadas({ '0000001-00.2025.8.15.2001': '2025-02-30', '123': '2025-01-01', '00000010020258152001': '2025-01-31', x: null })],
    [['00000010020258152001', '2025-01-31']], 'data impossível e número curto ficam fora');
});

test('DataJud no cadastro: uma tentativa curta por lote e teto total', async () => {
  const dj = await import('./tribunal/datajud.js');
  const { datasNoDataJud, DATAJUD_CADASTRO } = await import('./coberturaAcervo.js');
  const postOriginal = dj.transporte.post; const esperarOriginal = dj.transporte.esperar;
  const chamadas = [];
  dj.transporte.post = async (indice, body, opcoes) => { chamadas.push(opcoes); return { status: 429, data: null }; };
  dj.transporte.esperar = async () => { throw new Error('não devia esperar'); };
  try {
    let t = 0; const agora = () => (t += 20_000);
    const numeros = Array.from({ length: 120 }, (_, i) => String(i).padStart(20, '0'));
    const r = await datasNoDataJud(new Map([['TJPB', numeros]]), { agora });
    assert.equal(r.datas.size, 0);
    assert.ok(chamadas.length >= 1 && chamadas.length < 3, `parou no teto total (${chamadas.length} chamadas)`);
    assert.ok(chamadas.every(o => o?.timeoutMs === DATAJUD_CADASTRO.timeoutMs));
    assert.equal(r.falhas, dj.dividirEmLotes(numeros).length, 'todos os lotes contam como falha');
  } finally { dj.transporte.post = postOriginal; dj.transporte.esperar = esperarOriginal; }
});

test('município de outro estado no TJPB não vira município da Paraíba', async () => {
  const { MUNICIPIOS_PB } = await import('./municipiosPB.js');
  assert.equal(MUNICIPIOS_PB.length, 223);
  for (const [texto, motivo] of [['MUNICIPIO DE RECIFE', 'município fora da Paraíba'], ['Município de Fortaleza - CE', 'município fora da Paraíba']]) {
    assert.deepEqual(enteDoPoloPassivo(texto, 'TJPB'), { ente: null, detalhe: null, motivo });
  }
  assert.deepEqual(enteDoPoloPassivo('Município de Santa Rita', 'TJPB'), { ente: 'municipio-outro-pb', detalhe: 'SANTA RITA', motivo: null });
  assert.equal(enteDoPoloPassivo('MUNICÍPIO DE SÃO JOSÉ DE PIRANHAS X FULANO', 'TJPB').detalhe, 'SAO JOSE DE PIRANHAS');
  assert.equal(enteDoPoloPassivo('MUNICIPIO DE CAMPINA GRANDE - PREFEITURA', 'TJPB').detalhe, 'CAMPINA GRANDE');
  assert.equal(enteDoPoloPassivo('Município de Mãe d\'Água', 'TJPB').detalhe, 'MAE D AGUA');
});
