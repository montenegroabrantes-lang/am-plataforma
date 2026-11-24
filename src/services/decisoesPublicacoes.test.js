// Decisões lidas nas publicações: textos no formato das publicações do DJEN (sem nomes reais).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tipoDecisaoDaPublicacao, extrairDispositivo, classificarResultado, extrairDataDecisao, escolherPeca, dadosDaDecisao } from './decisoesPublicacoes.js';

const SENT = dispositivo => `PODER JUDICIÁRIO DO ESTADO DA PARAÍBA 2º Juizado Especial da Fazenda Pública PROCESSO Nº 0800000-00.2026.8.15.2001 SENTENÇA Vistos etc. Dispensado o relatório (art. 38 da Lei 9.099/95). A parte autora pretende o pagamento de férias de 45 dias. A contestação sustenta que o pedido é improcedente, porque a Lei 14.375/2021 assegura 30 dias. Em caso análogo, a Turma julgou procedente o pedido. É o breve relato. DECIDO. ${dispositivo} Sem custas e honorários (art. 55 da Lei 9.099/95). P.R.I. João Pessoa, 18 de novembro de 2026. Juiz(a) de Direito`;
const ACO = (ementa, dispositivo) => `PODER JUDICIÁRIO 1ª TURMA RECURSAL PERMANENTE DA CAPITAL RECURSO INOMINADO Nº 0800000-00.2026.8.15.2001 ACÓRDÃO EMENTA: ${ementa} ACORDAM os membros da Turma Recursal, à unanimidade, ${dispositivo}, nos termos do voto do relator. João Pessoa, 25 de novembro de 2026. Juiz Relator`;

test('tipo da publicação', () => {
  assert.equal(tipoDecisaoDaPublicacao({ tipo_documento: 'Sentença' }), 'sentenca');
  assert.equal(tipoDecisaoDaPublicacao({ tipo_documento: 'Acórdão' }), 'acordao');
  assert.equal(tipoDecisaoDaPublicacao({ tipo_documento: 'Decisão' }), 'decisao');
  assert.equal(tipoDecisaoDaPublicacao({ tipo_documento: 'Despacho' }), null);
  assert.equal(tipoDecisaoDaPublicacao({ tipo_documento: 'Intimação' }), null);
  assert.equal(tipoDecisaoDaPublicacao({ tipo_documento: null, texto: 'PROCESSO 123 S E N T E N Ç A Vistos' }), 'sentenca');
  assert.equal(tipoDecisaoDaPublicacao({ tipo_documento: null, texto: 'ATO ORDINATÓRIO intime-se' }), null);
});

test('sentença: o dispositivo decide, não o relatório nem a fundamentação', () => {
  const casos = [
    ['Ante o exposto, JULGO PROCEDENTE o pedido para condenar o réu ao pagamento das diferenças.', 'procedente'],
    ['Diante do exposto, julgo procedentes os pedidos formulados na inicial.', 'procedente'],
    ['Ante o exposto, JULGO PARCIALMENTE PROCEDENTE o pedido, para condenar o réu ao FGTS.', 'parcialmente-procedente'],
    ['Isto posto, julgo procedente em parte o pedido.', 'parcialmente-procedente'],
    ['Ante o exposto, JULGO IMPROCEDENTE o pedido e extingo o processo com resolução do mérito.', 'improcedente'],
    ['Pelo exposto, julgo improcedentes os pedidos.', 'improcedente'],
    ['Ante o exposto, HOMOLOGO, por sentença, o ACORDO celebrado entre as partes.', 'acordo'],
    ['Ante o exposto, HOMOLOGO o pedido de desistência e extingo o feito.', 'desistencia'],
    ['Ante o exposto, EXTINGO O PROCESSO SEM RESOLUÇÃO DO MÉRITO, nos termos do art. 485 do CPC.', 'extinto-sem-merito'],
  ];
  for (const [disp, esperado] of casos) {
    const d = extrairDispositivo(SENT(disp), 'sentenca');
    assert.equal(classificarResultado(d, 'sentenca'), esperado, disp);
  }
  // "improcedente" na contestação e "procedente" no precedente citado não contaminam o dispositivo
  assert.doesNotMatch(extrairDispositivo(SENT('Ante o exposto, JULGO PROCEDENTE o pedido.'), 'sentenca'), /CONTESTACAO/);
});

test('sentença ambígua ou sem dispositivo fica "a confirmar"', () => {
  assert.equal(classificarResultado(extrairDispositivo(SENT('Ante o exposto, JULGO PROCEDENTE o pedido de férias e JULGO IMPROCEDENTE o pedido de FGTS.'), 'sentenca'), 'sentenca'), null);
  assert.equal(extrairDispositivo('Vistos. Converto o julgamento em diligência.', 'sentenca'), null);
  assert.equal(classificarResultado(null, 'sentenca'), null);
});

test('acórdão: dispositivo depois do ACORDAM', () => {
  const casos = [
    ['RECURSO INOMINADO. FÉRIAS DE 45 DIAS. RECURSO DESPROVIDO.', 'conhecer do recurso e negar-lhe provimento', 'desprovido'],
    ['RECURSO INOMINADO. FGTS. RECURSO PROVIDO.', 'conhecer do recurso e dar-lhe provimento', 'provido'],
    ['RECURSO INOMINADO. RECURSO PARCIALMENTE PROVIDO.', 'dar parcial provimento ao recurso', 'parcialmente-provido'],
    ['RECURSO INOMINADO. INTEMPESTIVIDADE.', 'não conhecer do recurso', 'nao-conhecido'],
  ];
  for (const [ementa, disp, esperado] of casos) {
    const d = extrairDispositivo(ACO(ementa, disp), 'acordao');
    assert.match(d, /^ACORDAM/);
    assert.equal(classificarResultado(d, 'acordao'), esperado, disp);
  }
});

test('decisão monocrática: sempre "a confirmar"', () => {
  assert.equal(classificarResultado('ANTE O EXPOSTO, NEGO PROVIMENTO AO RECURSO', 'decisao'), null);
});

test('data da decisão: última data por extenso, plausível; senão null', () => {
  assert.equal(extrairDataDecisao(SENT('Ante o exposto, JULGO PROCEDENTE.'), '2026-11-20'), '2026-11-18');
  assert.equal(extrairDataDecisao('Publicado em 1º de dezembro de 2026', '2026-11-20'), null, 'depois da disponibilização');
  assert.equal(extrairDataDecisao('Lei de 10 de março de 2021', '2026-11-20'), null, 'mais de um ano antes');
  assert.equal(extrairDataDecisao('sem data', '2026-11-20'), null);
  assert.equal(extrairDataDecisao('João Pessoa, 3 de março de 2026', '2026-03-05'), '2026-03-03', 'mês com cedilha');
});

test('escolha da peça', () => {
  const pecas = [
    { id: 'ini', tipo_peca: 'inicial', resultado: 'pendente', data_protocolo: '2026-03-01' },
    { id: 'mem', tipo_peca: 'memorial', resultado: 'pendente', data_protocolo: '2026-09-01' },
    { id: 'ri', tipo_peca: 'recurso-inominado', resultado: 'pendente', data_protocolo: '2026-10-20' },
    { id: 'velha', tipo_peca: 'impugnacao-contestacao', resultado: 'procedente', data_protocolo: '2026-10-01' },
    { id: 'futura', tipo_peca: 'memorial', resultado: 'pendente', data_protocolo: '2026-12-01' },
    { id: 'dec', tipo_peca: 'contrarrazoes', resultado: 'pendente', decisao_id: 'x', data_protocolo: '2026-11-01' },
  ];
  assert.equal(escolherPeca(pecas, { tipo: 'sentenca', data: '2026-11-18' }).id, 'mem', '1º grau mais recente, pendente, protocolada antes');
  assert.equal(escolherPeca(pecas, { tipo: 'acordao', data: '2026-11-25' }).id, 'ri', 'recursal sem decisão registrada');
  assert.equal(escolherPeca(pecas, { tipo: 'acordao', data: '2026-10-01' }), null, 'recurso protocolado depois');
  assert.equal(escolherPeca(pecas, { tipo: 'decisao', data: '2026-11-25' }).id, 'ri');
  assert.equal(escolherPeca([pecas[0]], { tipo: 'decisao', data: '2026-11-25' }).id, 'ini', 'monocrática sem recursal cai no 1º grau');
  assert.equal(escolherPeca([], { tipo: 'sentenca', data: '2026-11-18' }), null);
});

test('dados para o registro: tipo, data do texto, resultado e evidência curta', () => {
  const d = dadosDaDecisao({ tipo_documento: 'Sentença', texto: SENT('Ante o exposto, JULGO PROCEDENTE o pedido.'), data_disponibilizacao: '2026-11-20', tribunal: 'TJPB', orgao: '2º Juizado Especial da Fazenda Pública' });
  assert.equal(d.tipo_decisao, 'Sentença'); assert.equal(d.data, '2026-11-18'); assert.equal(d.resultado, 'procedente');
  assert.match(d.evidencia, /^20\/11\/2026 — TJPB 2º Juizado/); assert.ok(d.evidencia.length <= 1000);
  const semData = dadosDaDecisao({ tipo_documento: 'Acórdão', texto: 'ACÓRDÃO ACORDAM em negar provimento', data_disponibilizacao: '2026-11-21' });
  assert.equal(semData.data, '2026-11-21', 'reserva: data de disponibilização'); assert.equal(semData.resultado, 'desprovido');
  assert.equal(dadosDaDecisao({ tipo_documento: 'Despacho', texto: 'Intime-se.' }), null);
});
