import test from 'node:test';
import assert from 'node:assert/strict';
import { montarChecklist, ACAO } from './checklist.js';

const DOCS = {
  identidade: { qtd: 2, ultima: '2024-03-10' }, procuracao: { qtd: 3, ultima: '2024-05-01' }, inicial: { qtd: 1, ultima: '2024-05-02' },
  vinculo: { qtd: 1, ultima: '2024-04-01' }, contracheque: { qtd: 5, ultima: '2024-04-20' },
};
const acao = (c, tipo) => c.itens.find(i => i.tipo === tipo).acao;

test('pasta completa: identidade e procuração anteriores se reaproveitam; vínculo e contracheques são novos; inicial é fonte de dados', () => {
  const c = montarChecklist({ documentos: DOCS, ente: 'Estado da Paraíba', fonteOficial: 'PB' });
  assert.equal(acao(c, 'identidade'), ACAO.REAPROVEITAR);
  assert.equal(acao(c, 'procuracao'), ACAO.REAPROVEITAR);
  assert.equal(acao(c, 'inicial_anterior'), ACAO.FONTE_DE_DADOS);
  assert.equal(acao(c, 'vinculo'), ACAO.OBTER_NOVO);
  assert.equal(acao(c, 'contracheque'), ACAO.OBTER_NOVO);
  assert.deepEqual(c.reaproveita, ['identidade', 'procuracao']);
  assert.deepEqual(c.novos, ['vinculo', 'contracheque']);
  assert.match(c.itens.find(i => i.tipo === 'procuracao').obs, /Tema 1198/);
  assert.deepEqual(c.faltando, []);
  assert.match(c.itens.find(i => i.tipo === 'contracheque').obs, /portal oficial/);
});

test('residência: sem regra definida por juízo, nunca vira exigência inventada', () => {
  const sem = montarChecklist({ documentos: DOCS });
  assert.equal(acao(sem, 'residencia'), ACAO.REGRA_PENDENTE);
  const com = montarChecklist({ documentos: { ...DOCS, residencia: { qtd: 1, ultima: '2025-01-01' } } });
  assert.equal(acao(com, 'residencia'), ACAO.CONFERIR_VALIDADE);
  assert.deepEqual(com.pendencias_de_regra, ['residencia']);
});

test('identidade ou inicial ausentes ficam em "faltando"; pasta não localizada avisa', () => {
  const c = montarChecklist({ documentos: { vinculo: { qtd: 1, ultima: '2024-01-01' } } });
  assert.deepEqual(c.faltando, ['identidade', 'procuracao', 'inicial_anterior']);
  const nulo = montarChecklist({ documentos: null });
  assert.match(nulo.itens[0].obs, /não localizada/);
  assert.deepEqual(nulo.faltando, ['identidade', 'procuracao', 'inicial_anterior']);
});

test('município: contracheques com o cliente ou no portal do município', () => {
  const c = montarChecklist({ documentos: DOCS, ente: 'Município de João Pessoa', fonteOficial: null });
  assert.match(c.itens.find(i => i.tipo === 'contracheque').obs, /município/i);
});
