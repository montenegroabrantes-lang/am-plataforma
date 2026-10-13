import test from 'node:test';
import assert from 'node:assert/strict';
import { classificar, teseDoNome, lerInicial, competencia, prepararProtocolo } from './protocolo.js';

const ENV = { GOOGLE_DRIVE_PASTA_PENDENTES: 'PENDENTES_AM_0001', SALARIO_MINIMO: '1500' };
const PASTA = 'PASTA_FULANO_001';

test('classificar e teseDoNome: tipos pelos nomes de arquivo do escritório', () => {
  assert.equal(classificar('INICIAL - FULANO - PISO MAGISTERIO X PB.pdf'), 'inicial');
  assert.equal(classificar('PLANILHA - FULANO - PISO MAGISTERIO X PB.pdf'), 'planilha');
  assert.equal(classificar('PROCURACAO - FULANO-Manifesto.pdf'), 'procuracao');
  assert.equal(classificar('CNH - CPF - Comprovante de residência.pdf'), 'identificacao');
  assert.equal(classificar('COMPROVANTE DE VÍNCULO.pdf'), 'vinculo');
  assert.equal(teseDoNome('INICIAL - FULANO - FGTS + FERIAS + 13 X PB.pdf'), 'FGTS + FERIAS + 13');
});

test('lerInicial: autor, ação, réu, valor da causa e gratuidade', () => {
  const r = lerInicial(`ABRANTES & MONTENEGRO ADVOGADOS AO JUÍZO COMPETENTE PARA OS FEITOS DA FAZENDA PÚBLICA
    FULANO DE TAL SILVA, brasileiro, solteiro, ... por seus advogados, vem propor AÇÃO DE COBRANÇA — FGTS
    em face da FAZENDA PÚBLICA DO ESTADO DA PARAÍBA, pessoa jurídica ... DA GRATUIDADE DA JUSTIÇA ...
    Dá-se à causa o valor de R$ 122.638,60 (cento e vinte e dois mil...).`);
  assert.deepEqual(r, { autor: 'FULANO DE TAL SILVA', acao: 'AÇÃO DE COBRANÇA — FGTS', reu: 'FAZENDA PÚBLICA DO ESTADO DA PARAÍBA', valor_causa: 122638.6, gratuidade: true });
});

test('competencia: Juizado até 60 salários mínimos, Vara acima, a confirmar sem salário mínimo', () => {
  assert.equal(competencia(8000, 1500).juizo, 'Juizado Especial da Fazenda Pública');
  assert.equal(competencia(90000, 1500).juizo, 'Juizado Especial da Fazenda Pública');
  assert.equal(competencia(90000.01, 1500).juizo, 'Vara da Fazenda Pública');
  assert.equal(competencia(8000, null).juizo, 'a confirmar');
  assert.equal(competencia(null, 1500).juizo, 'a confirmar');
});

function driveFalso(arquivos) {
  return { files: {
    async get({ fileId }) {
      if (fileId !== PASTA) throw new Error('404');
      return { data: { id: PASTA, name: 'FULANO x PB', mimeType: 'application/vnd.google-apps.folder', parents: ['PENDENTES_AM_0001'], trashed: false } };
    },
    async list() { return { data: { files: arquivos } }; },
  } };
}
const pdf = (id, name) => ({ id, name, mimeType: 'application/pdf' });
const textos = {
  fgts: 'PÚBLICA FULANO DE TAL, brasileiro, vem propor AÇÃO FGTS em face do ESTADO, x. gratuidade. Dá-se à causa o valor de R$ 8.000,00',
  piso: 'PÚBLICA FULANO DE TAL, brasileiro, vem propor AÇÃO PISO em face do ESTADO, x. gratuidade. Dá-se à causa o valor de R$ 122.638,60',
};

test('prepararProtocolo: um processo por inicial, planilha da mesma tese, competência e ordem dos anexos', async () => {
  const drive = driveFalso([
    pdf('fgts', 'INICIAL - FULANO - FGTS + FERIAS + 13 X PB.pdf'),
    pdf('piso', 'INICIAL - FULANO - PISO MAGISTERIO X PB.pdf'),
    pdf('pl', 'PLANILHA - FULANO - PISO MAGISTERIO X PB.pdf'),
    pdf('pr', 'PROCURACAO - FULANO.pdf'),
    pdf('id', 'CNH - CPF - Comprovante de residência.pdf'),
    pdf('vi', 'COMPROVANTE DE VINCULO.pdf'),
    { id: 'w', name: 'INICIAL - FULANO.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  ]);
  const r = await prepararProtocolo({ pastaId: PASTA }, { drive, env: ENV, lerTexto: async id => textos[id] });
  const [fgts, piso] = r.processos;
  assert.equal(fgts.juizo, 'Juizado Especial da Fazenda Pública');
  assert.equal(fgts.foro, 'João Pessoa');
  assert.equal(piso.juizo, 'Vara da Fazenda Pública');
  assert.equal(piso.classe, 'Procedimento Comum Cível');
  assert.deepEqual(fgts.anexos.map(a => a.tipo), ['inicial', 'procuracao', 'identificacao', 'vinculo']);
  assert.deepEqual(piso.anexos.map(a => a.tipo), ['inicial', 'planilha', 'procuracao', 'identificacao', 'vinculo']);
  assert.deepEqual([fgts.status, piso.status], ['pronto', 'pronto']);
  assert.match(r.avisos.join(' '), /não são PDF.*docx/);
});

test('prepararProtocolo: sem procuração o processo fica bloqueado com o motivo', async () => {
  const drive = driveFalso([pdf('fgts', 'INICIAL - FULANO - FGTS X PB.pdf'), pdf('id', 'CNH.pdf'), pdf('vi', 'CONTRACHEQUE.pdf')]);
  const r = await prepararProtocolo({ pastaId: PASTA }, { drive, env: ENV, lerTexto: async () => textos.fgts });
  assert.equal(r.processos[0].status, 'bloqueado');
  assert.deepEqual(r.processos[0].pendencias, ['falta a procuração']);
});
