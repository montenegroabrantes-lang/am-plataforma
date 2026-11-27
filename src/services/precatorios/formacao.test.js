import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarFaixa, PASSOS_PRECATORIO, PASSOS_ALVARA, BLOCO_INTIMACAO_ALVARA, ehAssinaturaDePrecatorio, ehAlvaraPago,
  numeroPrecatorioValido, registrarAssinados, criarGravacaoNumeros, mesmoCredor, PASSOS_RPV, itensDeRpv, BLOCO_MISTO_SEM_PAGAMENTO } from './formacao.js';
import { validarVarredura } from '../despachos.js';
import { aplicarPrecatorioSemNumero } from '../../db/migracoes/precatorioSemNumero.js';
import { pendencias } from './regras.js';

const O1 = '0869846-54.2024.8.15.2001', O2 = '0880445-18.2025.8.15.2001', T1 = '0812345-67.2026.8.15.0000';
const item = (n, bloco, folha, extra = {}) => ({ processo_id: n, numero: n, bloco, folha, ...extra });

test('faixa do precatório: cada bloco cai no seu passo, na ordem do caminho', () => {
  const f = montarFaixa(PASSOS_PRECATORIO, [
    item('a', 'Fazer minuta de precatório', 'diligencia'), item('b', 'Formulário juntado: falta a minuta do precatório', 'outros'),
    item('c', 'Juntar concordância', 'diligencia'), item('d', 'Certificar o envio ao SAPRE', 'cartorio', { dias_parado: 3 }),
    item('e', 'Certificar o envio ao SAPRE', 'outros', { dias_parado: 40 }), item('f', 'Assinar precatório no SAPRE', 'assinaturas'),
    item('g', 'Expedir alvará', 'gabinete'), item('d', 'Certificar o envio ao SAPRE', 'cartorio'),
  ]);
  assert.deepEqual(f.map(p => [p.chave, p.quem, p.total]), [['formulario', 'Escritório', 1], ['falta_minuta', 'Cartório', 1],
    ['concordancia', 'Escritório', 1], ['determinar', 'Juiz', 0], ['certidao_sapre', 'Cartório', 2], ['assinar', 'Juiz', 1]]);
  assert.deepEqual(f[4].itens.map(i => i.numero), ['e', 'd']); // mais parado primeiro, sem repetir o processo
});

test('faixa do alvará: o mesmo bloco muda de passo conforme a folha; intimação pessoal tem passo próprio', () => {
  const f = montarFaixa(PASSOS_ALVARA, [
    item('a', 'Expedir alvará', 'gabinete', { concluso: '19/11 Conclusos para decisão' }), item('b', 'Expedir alvará', 'cartorio'),
    item('c', 'Pedir conclusão para expedir alvará', 'cartorio'), item('d', BLOCO_INTIMACAO_ALVARA, 'diligencia'),
    item('e', 'Assinar alvará no BRBJus', 'assinaturas'), item('x', 'Assinar precatório no SAPRE', 'assinaturas'),
  ]);
  // nome antigo no gabinete = juiz determinar; "Expedir alvará" no cartório = passo novo (cartório expede)
  assert.deepEqual(f.map(p => [p.chave, p.nome, p.quem, p.total]), [['pedir_conclusao', 'Pedir conclusão', 'Cartório', 1], ['determinar', 'Determinar alvará', 'Juiz', 1],
    ['intimacao_pessoal', 'Intimação pessoal exigida', 'Escritório', 1], ['expedir', 'Expedir alvará', 'Cartório', 1], ['assinar', 'Assinar no BRBJus', 'Juiz', 1]]);
  assert.equal(f[1].itens[0].concluso, '19/11 Conclusos para decisão');
  const novos = montarFaixa(PASSOS_ALVARA, [item('n1', 'Determinar alvará', 'gabinete'), item('n2', 'Pedir conclusão para determinar alvará', 'cartorio')]);
  assert.deepEqual(novos.map(p => p.total), [1, 1, 0, 0, 0]);
});

test('reconhece a assinatura do juiz, o alvará pago e o número do TJPB', () => {
  assert.ok(ehAssinaturaDePrecatorio({ motivo: 'ofício requisitório de precatório juntado em 25/11 (juiz assinou)' }));
  assert.ok(ehAssinaturaDePrecatorio({ motivo: 'diligência concluída (ofício requisitório de precatório juntado em 26/11)' }));
  assert.ok(!ehAssinaturaDePrecatorio({ motivo: 'RPV expedida em 20/11' }));
  assert.ok(ehAlvaraPago({ motivo: 'alvará pago (comprovante BRBJus 20/11)' }));
  assert.ok(numeroPrecatorioValido(T1));
  assert.ok(!numeroPrecatorioValido(O1)); // número de 1º grau não é precatório
  assert.ok(!numeroPrecatorioValido(null));
});

test('a varredura aceita o número do precatório na saída e descarta o que não é do TJPB 2º grau', () => {
  const d = validarVarredura({ executada_em: '2026-11-27T18:00:00Z', itens: [], saidas: [
    { numero: O1, de: 'assinaturas', motivo: 'ofício requisitório de precatório juntado em 25/11', precatorio_numero: T1 },
    { numero: O2, de: 'assinaturas', motivo: 'ofício requisitório de precatório juntado em 26/11', precatorio_numero: O1 }] });
  assert.equal(d.saidas[0].precatorio_numero, T1);
  assert.equal(d.saidas[1].precatorio_numero, undefined);
});

function banco({ processos, fichas = [] }) {
  const chamadas = [], auditorias = [];
  const tx = {
    async query(sql, p) { chamadas.push({ sql: sql.replace(/\s+/g, ' ').trim(), p });
      if (sql.includes('FROM precatorios WHERE processo_origem_id IS NULL')) return fichas.filter(f => !f.processo_origem_id && !f.numero_origem && f.numero);
      return processos.filter(x => p[0].includes(x.numero)); },
    async queryOne(sql, p) {
      const s = sql.replace(/\s+/g, ' ').trim(); chamadas.push({ sql: s, p });
      if (s.startsWith('INSERT INTO precatorios')) { fichas.push({ id: `nova${fichas.length + 1}`, numero: p[0], processo_origem_id: p[4], numero_origem: p[5], etapa: p[6] }); return { id: fichas.at(-1).id }; }
      if (s.includes('AND numero IS NULL')) return fichas.find(f => (f.processo_origem_id === p[0] || f.numero_origem === p[1]) && !f.numero) || null;
      if (s.includes('WHERE processo_origem_id = $1')) return fichas.find(f => f.processo_origem_id === p[0] || f.numero_origem === p[1]) || null;
      if (s.includes('WHERE numero = $1')) return fichas.find(f => f.numero === p[0]) || null;
      return null;
    },
    async execute(sql, p) { chamadas.push({ sql: sql.replace(/\s+/g, ' ').trim(), p }); return { rowCount: 1 }; },
  };
  return { tx, chamadas, auditorias, fichas, auditar: async a => { auditorias.push(a); } };
}
const PROC = [{ id: 'p1', numero: O1, cliente_id: 'c1', cliente_nome: 'Fulana de Tal', polo_passivo: 'Município de João Pessoa' }, { id: 'p2', numero: O2, cliente_id: null, cliente_nome: null, polo_ativo: 'Beltrano', polo_passivo: null }];

test('juiz assinou: cria a ficha ligada à origem, sem número, na etapa Assinado, e audita', async () => {
  const b = banco({ processos: PROC });
  const r = await registrarAssinados(b.tx, [{ numero: O1, motivo: 'ofício requisitório de precatório juntado em 25/11' }, { numero: O2, motivo: 'RPV expedida' },
    { numero: '0000001-11.2020.8.15.2001', motivo: 'ofício requisitório de precatório juntado' }], { auditar: b.auditar });
  assert.deepEqual(r, { fichas_criadas: 1, numeros_preenchidos: 0, origens_vinculadas: 0 });
  const ins = b.chamadas.find(c => c.sql.startsWith('INSERT INTO precatorios'));
  assert.deepEqual(ins.p.slice(0, 7), [null, 'Fulana de Tal', 'Município de João Pessoa', 'c1', 'p1', O1, 'assinado']);
  assert.equal(b.auditorias[0].acao, 'criar_ficha_precatorio_assinado');
  assert.ok(b.chamadas.some(c => c.sql.startsWith('INSERT INTO precatorio_eventos') && c.p[1] === 'assinado'));
});

test('com o número do ofício a ficha já nasce autuada; sem cliente usa o polo ativo e "A conferir"', async () => {
  const b = banco({ processos: PROC });
  await registrarAssinados(b.tx, [{ numero: O2, motivo: 'ofício requisitório de precatório juntado em 26/11', precatorio_numero: T1 }], { auditar: b.auditar });
  const ins = b.chamadas.find(c => c.sql.startsWith('INSERT INTO precatorios'));
  assert.deepEqual(ins.p.slice(0, 7), [T1, 'Beltrano', 'A conferir', null, 'p2', O2, 'autuado']);
});

test('não duplica: a segunda varredura não cria outra ficha, e só completa o número que faltava', async () => {
  const b = banco({ processos: PROC, fichas: [{ id: 'f1', numero: null, processo_origem_id: 'p1', numero_origem: O1 }] });
  const s = [{ numero: O1, motivo: 'ofício requisitório de precatório juntado em 25/11' }];
  assert.deepEqual(await registrarAssinados(b.tx, s, { auditar: b.auditar }), { fichas_criadas: 0, numeros_preenchidos: 0, origens_vinculadas: 0 });
  assert.deepEqual(await registrarAssinados(b.tx, [{ ...s[0], precatorio_numero: T1 }], { auditar: b.auditar }), { fichas_criadas: 0, numeros_preenchidos: 1, origens_vinculadas: 0 });
  const up = b.chamadas.find(c => c.sql.startsWith('UPDATE precatorios SET numero'));
  assert.deepEqual(up.p, ['f1', T1]);
  assert.ok(!b.chamadas.some(c => c.sql.startsWith('INSERT INTO precatorios (')));
});

test('número do tribunal que já tem ficha manual: só liga a origem, não cria outra', async () => {
  const b = banco({ processos: PROC, fichas: [{ id: 'manual', numero: T1, processo_origem_id: null, numero_origem: null }] });
  const r = await registrarAssinados(b.tx, [{ numero: O1, motivo: 'ofício requisitório de precatório juntado', precatorio_numero: T1 }], { auditar: b.auditar });
  assert.deepEqual(r, { fichas_criadas: 0, numeros_preenchidos: 0, origens_vinculadas: 1 });
  const up = b.chamadas.find(c => c.sql.startsWith('UPDATE precatorios SET processo_origem_id'));
  assert.deepEqual(up.p, ['manual', 'p1', O1, 'c1']);
});

test('rota dos números: recusa número torto e grava o válido', async () => {
  const b = banco({ processos: PROC, fichas: [{ id: 'f1', numero: null, processo_origem_id: 'p1', numero_origem: O1 }] });
  const rota = criarGravacaoNumeros({ transaction: fn => fn(b.tx) }, { auditar: b.auditar });
  const resp = () => ({ codigo: 200, corpo: null, status(c) { this.codigo = c; return this; }, json(c) { this.corpo = c; return this; } });
  let r = resp(); await rota({ body: {} }, r); assert.equal(r.codigo, 400);
  r = resp(); await rota({ body: { numeros: [{ numero_origem: O1, numero: O2 }] } }, r); assert.equal(r.codigo, 400);
  r = resp(); await rota({ body: { numeros: [{ numero_origem: O1, numero: T1 }] } }, r);
  assert.deepEqual(r.corpo, { ok: true, fichas_criadas: 0, numeros_preenchidos: 1, origens_vinculadas: 0 });
});

test('migração só solta a obrigatoriedade do número; ficha sem número cobra o número', async () => {
  const sqls = [];
  await aplicarPrecatorioSemNumero({ execute: async s => { sqls.push(s); } });
  assert.deepEqual(sqls, ['ALTER TABLE precatorios ALTER COLUMN numero DROP NOT NULL']);
  const p = { numero: null, etapa: 'assinado', habilitacao_ramon: 'habilitado', habilitacao_luciano: 'habilitado', processo_origem_id: 'x' };
  assert.deepEqual(pendencias(p, 2026).map(i => i.tipo), ['sem_numero']);
});

test('ficha antiga do mesmo credor, sem origem: liga a origem em vez de criar outra; com duas candidatas, cria', async () => {
  assert.ok(mesmoCredor('FULANA DE TAL', 'Fulana de Tal'));
  assert.ok(mesmoCredor('Adriana Cláudia P. S. e Silva', 'ADRIANA CLAUDIA POLARI SOUTO E SILVA'));
  assert.ok(!mesmoCredor('Fulana de Tal', 'Fulana Souza'));
  assert.ok(!mesmoCredor('', 'Fulana'));
  const antiga = { id: 'antiga', numero: T1, credor_nome: 'FULANA DE TAL', processo_origem_id: null, numero_origem: null };
  let b = banco({ processos: PROC, fichas: [antiga] });
  const s = [{ numero: O1, motivo: 'ofício requisitório de precatório juntado em 25/11' }];
  assert.deepEqual(await registrarAssinados(b.tx, s, { auditar: b.auditar }), { fichas_criadas: 0, numeros_preenchidos: 0, origens_vinculadas: 1 });
  assert.deepEqual(b.chamadas.find(c => c.sql.startsWith('UPDATE precatorios SET processo_origem_id')).p, ['antiga', 'p1', O1, 'c1']);
  assert.equal(b.auditorias[0].acao, 'vincular_origem_precatorio');
  b = banco({ processos: PROC, fichas: [{ ...antiga }, { ...antiga, id: 'outra', numero: '0800002-22.2026.8.15.0000' }] });
  assert.deepEqual(await registrarAssinados(b.tx, s, { auditar: b.auditar }), { fichas_criadas: 1, numeros_preenchidos: 0, origens_vinculadas: 0 });
});

test('dois precatórios da mesma origem (credor e honorários): com número, cada um ganha a sua ficha', async () => {
  const T2 = '0804124-28.2025.8.15.0000';
  const b = banco({ processos: PROC });
  const r = await registrarAssinados(b.tx, [{ numero: O1, motivo: 'lido no 2º grau', precatorio_numero: T1 }, { numero: O1, motivo: 'lido no 2º grau', precatorio_numero: T2 }].map(x => ({ ...x, motivo: 'ofício requisitório de precatório (' + x.motivo + ')' })), { auditar: b.auditar });
  assert.deepEqual(r, { fichas_criadas: 2, numeros_preenchidos: 0, origens_vinculadas: 0 });
  assert.deepEqual(b.fichas.map(f => [f.numero, f.etapa]), [[T1, 'autuado'], [T2, 'autuado']]);
});

test('faixa do RPV: expedir no cartório ou concluso, sem pagamento e depósito vencido; o misto que já é precatório fica de fora', () => {
  const itens = [item('a', 'Expedir RPV', 'cartorio'), item('b', 'Expedir RPV', 'gabinete'), item('c', 'Conferir depósito de RPV vencida', 'diligencia'),
    item('d', BLOCO_MISTO_SEM_PAGAMENTO, 'diligencia'), item('e', BLOCO_MISTO_SEM_PAGAMENTO, 'diligencia', { tem_precatorio: true }), item('f', 'Conferir RPV sem pagamento', 'diligencia'),
    item('g', 'Expedir alvará', 'gabinete')];
  const f = montarFaixa(PASSOS_RPV, itensDeRpv(itens));
  assert.deepEqual(f.map(p => [p.chave, p.nome, p.quem, p.total]), [['determinar', 'Determinar RPV', 'Juiz', 1], ['expedir', 'Expedir RPV', 'Cartório', 1], ['sem_pagamento', 'Expedida, sem pagamento', 'Fazenda', 2], ['vencida', 'Depósito vencido', 'Escritório', 1]]);
  assert.equal(montarFaixa(PASSOS_RPV, [item('z', 'Determinar RPV', 'gabinete')])[0].total, 1);
  assert.deepEqual(f[2].itens.map(i => i.numero).sort(), ['d', 'f']);
});
