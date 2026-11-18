import test from 'node:test';
import assert from 'node:assert/strict';
import {
  criarListagemProcessos,
  exigePermissao,
  montarConsultaProcessos,
  serializarProcesso,
} from './processosExternos.js';

function respostaFake() {
  return {
    statusCode: 200,
    body: null,
    status(codigo) { this.statusCode = codigo; return this; },
    json(corpo) { this.body = corpo; return this; },
  };
}

test('a rota exige cada permissão na chave', () => {
  const negada = respostaFake();
  let liberou = false;
  exigePermissao('processos')({ integracao: { permissoes: ['leitura'] } }, negada, () => { liberou = true; });
  assert.equal(negada.statusCode, 403);
  assert.equal(liberou, false);

  exigePermissao('leitura')({ integracao: { permissoes: ['leitura'] } }, respostaFake(), () => { liberou = true; });
  assert.equal(liberou, true);
});

test('a consulta nunca traz processo restrito nem dados pessoais do cliente', () => {
  const { sqlItens, sqlTotal } = montarConsultaProcessos();
  assert.match(sqlItens, /p\.visibilidade = 'normal'/);
  assert.match(sqlTotal, /p\.visibilidade = 'normal'/);
  assert.doesNotMatch(sqlItens, /clientes|cpf|polo_ativo|notas/i);
});

test('os parâmetros acompanham o filtro de status', () => {
  const semStatus = montarConsultaProcessos({ pagina: 2, limite: 50 });
  assert.deepEqual(semStatus.paramsItens.slice(1), [50, 50]);
  assert.match(semStatus.sqlItens, /!~\* \$1/);
  assert.match(semStatus.sqlItens, /LIMIT \$2 OFFSET \$3/);
  assert.deepEqual(semStatus.paramsTotal, []);

  const comStatus = montarConsultaProcessos({ status: 'ativo' });
  assert.equal(comStatus.paramsItens[0], 'ativo');
  assert.match(comStatus.sqlItens, /p\.status = \$1/);
  assert.match(comStatus.sqlItens, /!~\* \$2/);
  assert.match(comStatus.sqlItens, /LIMIT \$3 OFFSET \$4/);
  assert.deepEqual(comStatus.paramsTotal, ['ativo']);
});

test('status desconhecido é recusado e o limite tem teto', () => {
  assert.ok(montarConsultaProcessos({ status: "ativo' OR 1=1" }).erro);
  assert.equal(montarConsultaProcessos({ limite: 5000 }).limite, 200);
});

test('o histórico só entra quando pedido e tem limites próprios', () => {
  const semHistorico = montarConsultaProcessos();
  assert.doesNotMatch(semHistorico.sqlItens, /AS movimentacoes|hist\.itens/);

  const comHistorico = montarConsultaProcessos({ historico: '1', limite: 500 });
  assert.match(comHistorico.sqlItens, /COALESCE\(hist\.itens, '\[\]'::json\) AS movimentacoes/);
  assert.match(comHistorico.sqlItens, /LIMIT 60/);
  assert.match(comHistorico.sqlItens, /LEFT\(m\.texto, 200\)/);
  assert.equal(comHistorico.limite, 100);
  assert.doesNotMatch(comHistorico.sqlItens, /clientes|cpf|polo_ativo|notas/i);

  assert.doesNotMatch(montarConsultaProcessos({ historico: 'nao' }).sqlItens, /hist\.itens/);
});

test('serializa valores, acervo em branco e dias parado', () => {
  const agora = new Date('2026-11-18T12:00:00Z');
  const processo = serializarProcesso({
    numero: '0863439-66.2023.8.15.2001',
    acervo: '',
    valor_homologado: '7520.24',
    valor_rpv: null,
    ultima_movimentacao_relevante_em: '2026-10-27T12:00:00Z',
  }, agora);
  assert.equal(processo.acervo, null);
  assert.equal(processo.valor_homologado, 7520.24);
  assert.equal(processo.valor_rpv, null);
  assert.equal(processo.dias_parado, 22);
  assert.equal(serializarProcesso({ numero: 'x' }, agora).dias_parado, null);
});

test('a listagem responde paginada e não expõe erro interno', async () => {
  const agora = new Date('2026-11-18T12:00:00Z');
  const conexao = {
    query: async sql => (sql.includes('COUNT(*)') ? [{ total: '1' }] : [{ numero: 'n', acervo: 'B' }]),
  };
  const res = respostaFake();
  await criarListagemProcessos(conexao, () => agora)({ query: {} }, res);
  assert.equal(res.body.total, 1);
  assert.equal(res.body.processos[0].acervo, 'B');

  const invalida = respostaFake();
  await criarListagemProcessos(conexao)({ query: { status: 'outro' } }, invalida);
  assert.equal(invalida.statusCode, 400);

  const falha = respostaFake();
  const quebrada = { query: async () => { throw new Error('segredo do banco'); } };
  await criarListagemProcessos(quebrada)({ query: {} }, falha);
  assert.equal(falha.statusCode, 500);
  assert.doesNotMatch(JSON.stringify(falha.body), /segredo/);
});
