import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processarPublicacoes } from './processarDecisoesPublicacoes.js';

// Banco falso: publicações, peças por processo e Master padrão.
function bancoFalso({ pubs, pecas, master = 'M-PADRAO' }) {
  const chamadas = [];
  return {
    chamadas,
    async query(sql, params) {
      chamadas.push(sql);
      if (/FROM publicacoes/.test(sql)) return pubs.filter(p => params[0].includes(String(p.id)) && !p.cancelada);
      if (/FROM acervo_pecas/.test(sql)) return pecas.filter(x => x.processo_id === params[0] || x.digitos === params[1]);
      return [];
    },
    async queryOne() { return master ? { id: master } : null; },
  };
}
const sentenca = (id, extra = {}) => ({ id, processo_id: 'P1', numero_processo_raw: '00003000020268152001', numero_processo: '0000300-00.2026.8.15.2001', data_disponibilizacao: '2026-11-20', tribunal: 'TJPB', orgao: 'Juízo', tipo_documento: 'Sentença', texto: 'Ante o exposto, JULGO PROCEDENTE o pedido. João Pessoa, 17 de novembro de 2026.', link: 'https://x/' + id, master_responsavel_id: null, ...extra });
const inicial = { id: 'A1', processo_id: 'P1', tipo_peca: 'inicial', resultado: 'pendente', decisao_id: null, arquivada_em: null, data_protocolo: '2026-03-01' };

test('simulação não registra e lista o que faria', async () => {
  const registrar = async () => { throw new Error('não devia registrar'); };
  const r = await processarPublicacoes([1], { simular: true, banco: bancoFalso({ pubs: [sentenca(1)], pecas: [inicial] }), registrar });
  assert.equal(r.decisoes, 1); assert.equal(r.registradas, 0);
  assert.deepEqual(r.itens.map(i => [i.publicacao_id, i.peca_id, i.situacao, i.resultado, i.data]), [['1', 'A1', 'registraria', 'procedente', '2026-11-17']]);
});

test('responsável: Master do processo, senão quem importou, senão o Master padrão', async () => {
  const usados = [];
  const registrar = async (req, pecaId, dados, opc) => { usados.push([req.user.id, pecaId, dados.resultado, opc.fonte, dados.documento_url]); return { status: 201, body: { tarefa: { id: 'T' } } }; };
  const pecas = [inicial, { ...inicial, id: 'A2', processo_id: 'P2' }, { ...inicial, id: 'A3', processo_id: 'P3' }];
  const pubs = [sentenca(1, { master_responsavel_id: 'M-PROC' }), sentenca(2, { processo_id: 'P2' }), sentenca(3, { processo_id: 'P3' })];
  await processarPublicacoes([1, 2], { usuarioImportacao: 'M-IMPORT', banco: bancoFalso({ pubs, pecas }), registrar });
  await processarPublicacoes([3], { banco: bancoFalso({ pubs, pecas }), registrar });
  assert.deepEqual(usados.map(u => u[0]), ['M-PROC', 'M-IMPORT', 'M-PADRAO']);
  assert.equal(usados[0][3], 'Diário'); assert.equal(usados[0][4], 'https://x/1');
});

test('despacho, cancelada e processo sem peça não registram; 409 e erro são contados', async () => {
  let n = 0;
  const registrar = async () => (++n === 1 ? { status: 409, body: {} } : { status: 500, body: {} });
  const pubs = [sentenca(1), sentenca(2, { tipo_documento: 'Despacho' }), sentenca(3, { cancelada: true }), sentenca(4, { processo_id: 'SEM', numero_processo_raw: '1' }), sentenca(5)];
  const r = await processarPublicacoes(['1', '2', '3', '4', '5'], { banco: bancoFalso({ pubs, pecas: [inicial] }), registrar });
  assert.equal(r.analisadas, 4); assert.equal(r.decisoes, 3); assert.equal(r.sem_peca, 1);
  assert.equal(r.ja_registradas, 1); assert.equal(r.erros, 1); assert.equal(r.registradas, 0);
});

test('sem Master nenhum: erro na publicação, sem derrubar as outras', async () => {
  const r = await processarPublicacoes([1], { banco: bancoFalso({ pubs: [sentenca(1)], pecas: [inicial], master: null }), registrar: async () => ({ status: 201, body: {} }) });
  assert.equal(r.erros, 1); assert.match(r.itens[0].situacao, /nenhum Master/);
});

test('lista vazia não consulta o banco', async () => {
  const banco = bancoFalso({ pubs: [], pecas: [] });
  const r = await processarPublicacoes([], { banco });
  assert.equal(r.analisadas, 0); assert.equal(banco.chamadas.length, 0);
});

test('simulação não escolhe duas vezes a mesma peça (duas sentenças no mesmo processo)', async () => {
  const r = await processarPublicacoes([1, 2], { simular: true, banco: bancoFalso({ pubs: [sentenca(1), sentenca(2)], pecas: [inicial] }) });
  assert.equal(r.itens.filter(i => i.situacao === 'registraria').length, 1);
  assert.equal(r.sem_peca, 1);
});

test('reprocessamento: busca as publicações da janela e simula por padrão', async () => {
  const { reprocessarPublicacoes } = await import('./processarDecisoesPublicacoes.js');
  const base = bancoFalso({ pubs: [sentenca(7)], pecas: [inicial] });
  const banco = { ...base, async query(sql, params) { if (/CURRENT_DATE/.test(sql)) { assert.equal(params[0], 30); return [{ id: '7' }]; } return base.query(sql, params); } };
  const r = await reprocessarPublicacoes({ dias: 30, banco, registrar: async () => { throw new Error('não devia gravar'); } });
  assert.equal(r.simular, true); assert.equal(r.dias, 30); assert.equal(r.publicacoes_no_periodo, 1);
  assert.equal(r.itens[0].situacao, 'registraria');
});
