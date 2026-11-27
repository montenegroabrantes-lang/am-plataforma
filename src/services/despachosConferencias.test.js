import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aplicarConferencias, aplicarResposta, conferenciaDoItem, criarListaConferenciasExterna, criarReaberturaConferencia,
  criarRespostaConferencia, detectarConferencia, referenciaCheia, validarConferencia,
} from './despachosConferencias.js';
import { validarVarredura } from './despachos.js';

const BASE = '2026-11-27T18:00:00Z';
const PROC = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RESP = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SAPRE = 'Certidão do cartório em 18/06 (conferir se é a do SAPRE)';

function respostaFake() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

test('o ano da referência é o mais recente em que a data não fica no futuro', () => {
  assert.equal(referenciaCheia('18/06', undefined, BASE), '18/06/2026');
  assert.equal(referenciaCheia('27/11', undefined, BASE), '27/11/2026');
  assert.equal(referenciaCheia('15/12', undefined, BASE), '15/12/2025');
  assert.equal(referenciaCheia('15/12', '2024', BASE), '15/12/2024');
});

test('reconhece os quatro pedidos de conferência pelo texto e ignora o resto', () => {
  assert.deepEqual(detectarConferencia(SAPRE, BASE), { tipo: 'certidao_sapre', referencia: '18/06/2026', pendente: true });
  assert.equal(detectarConferencia('Sentença publicada em 03/11: conferir antes de pedir a RPV', BASE).tipo, 'rpv_sentenca');
  const c = detectarConferencia('Prazo do Município decorrido em 20/10 após nossa petição de 01/09: conferir se é cumprimento e pedir conclusão', BASE);
  assert.deepEqual([c.tipo, c.referencia], ['cumprimento_conclusao', '01/09/2026']);
  const d = detectarConferencia('Juiz despachou em 25/11 · cartório expedir o alvará no BRBJus (conferir o despacho) · Novo em 26/11: Expedição de outros', BASE);
  assert.deepEqual([d.tipo, d.referencia], ['despacho_alvara', '25/11/2026']);
  assert.equal(detectarConferencia('RPV vencida – conferir depósito', BASE), null);
  assert.equal(detectarConferencia('Certidão de envio para assinatura em 16/10 (SAPRE/GEPRE, conferida)', BASE), null);
  assert.equal(detectarConferencia(null, BASE), null);
});

test('marca vinda da rotina: só tipo conhecido e data completa', () => {
  assert.deepEqual(validarConferencia({ tipo: 'rpv_sentenca', referencia: '03/11/2026' }), { tipo: 'rpv_sentenca', referencia: '03/11/2026', pendente: true });
  assert.equal(validarConferencia({ tipo: 'rpv_sentenca', referencia: '03/11/2026', pendente: false }).pendente, false);
  assert.equal(validarConferencia({ tipo: 'constructor', referencia: '03/11/2026' }), null);
  assert.equal(validarConferencia({ tipo: 'rpv_sentenca', referencia: '03/11' }), null);
  assert.equal(validarConferencia(null), null);
  const v = validarVarredura({ executada_em: BASE, itens: [{ numero: '0880640-03.2025.8.15.2001', folha: 'cartorio', local: '1º JEFP', bloco: 'Expedir RPV', conferencia: { tipo: 'rpv_sentenca', referencia: '03/11/2026' } }] });
  assert.equal(v.itens[0].conferencia.tipo, 'rpv_sentenca');
});

test('confirmar mantém a linha e tira o aviso; descartar leva ao destino do caso', () => {
  const sapre = { folha: 'assinaturas', local: '2º JEFP/A', bloco: 'Assinar precatório no SAPRE', observacao: SAPRE, concluso: null };
  assert.deepEqual(aplicarResposta(sapre, 'certidao_sapre', 'confirmado'),
    { folha: 'assinaturas', local: '2º JEFP/A', bloco: 'Assinar precatório no SAPRE', observacao: 'Certidão de envio para assinatura em 18/06 (SAPRE/GEPRE, conferida)' });
  assert.deepEqual(aplicarResposta(sapre, 'certidao_sapre', 'descartado'),
    { folha: 'cartorio', local: '2º JEFP/A', bloco: 'Certificar o envio ao SAPRE', observacao: 'Certidão de 18/06 conferida: não é a do SAPRE · falta a certidão de envio ao SAPRE' });
  // Vara comum: a certidão é do Núcleo 4.0 (folha Outros órgãos).
  const vara = aplicarResposta({ ...sapre, local: '3ª Vara da Fazenda' }, 'certidao_sapre', 'descartado');
  assert.deepEqual([vara.folha, vara.local], ['outros', 'Núcleo 4.0']);
  // Concluso: a vez é do juiz.
  const conc = aplicarResposta({ ...sapre, concluso: '18/06 Conclusos para despacho' }, 'certidao_sapre', 'descartado');
  assert.deepEqual([conc.folha, conc.bloco], ['gabinete', 'Determinar precatório/RPV']);
  assert.match(conc.observacao, /^Concluso: 18\/06 Conclusos para despacho · Certidão de 18\/06 conferida: não é a do SAPRE$/);

  const rpv = { folha: 'cartorio', local: '1º JEFP', bloco: 'Expedir RPV', observacao: 'Sentença publicada em 03/11: conferir antes de pedir a RPV · Novo em 26/11: Juntada de petição' };
  assert.equal(aplicarResposta(rpv, 'rpv_sentenca', 'confirmado').observacao, 'Sentença publicada em 03/11 (conferida: pedir a RPV) · Novo em 26/11: Juntada de petição');
  const rpvNao = aplicarResposta(rpv, 'rpv_sentenca', 'descartado');
  assert.deepEqual([rpvNao.folha, rpvNao.local, rpvNao.bloco], ['diligencia', '1º JEFP', 'Analisar: conferência descartada']);

  const cump = { folha: 'cartorio', local: '4º JEFP', bloco: 'Conferir antes de despachar', observacao: 'Prazo do Município decorrido em 20/10 após nossa petição de 01/09: conferir se é cumprimento e pedir conclusão' };
  const cumpSim = aplicarResposta(cump, 'cumprimento_conclusao', 'confirmado');
  assert.deepEqual([cumpSim.folha, cumpSim.bloco], ['cartorio', 'Pedir conclusão para homologar o cumprimento']);
  assert.equal(cumpSim.observacao, 'Prazo do Município decorrido em 20/10 após nossa petição de 01/09 (conferida: é cumprimento)');
  assert.equal(aplicarResposta(cump, 'cumprimento_conclusao', 'descartado').folha, 'diligencia');

  const alv = { folha: 'cartorio', local: '1º JEFP', bloco: 'Expedir alvará', observacao: 'Juiz despachou em 25/11 · cartório expedir o alvará no BRBJus (conferir o despacho)' };
  assert.equal(aplicarResposta(alv, 'despacho_alvara', 'confirmado').observacao, 'Juiz despachou em 25/11 · cartório expedir o alvará no BRBJus (despacho conferido)');
  assert.equal(aplicarResposta(alv, 'despacho_alvara', 'descartado').bloco, 'Analisar: conferência descartada');
  // Depois de respondida, a linha não pede mais conferência.
  for (const r of ['confirmado', 'descartado']) for (const [it, tipo] of [[sapre, 'certidao_sapre'], [rpv, 'rpv_sentenca'], [cump, 'cumprimento_conclusao'], [alv, 'despacho_alvara']]) {
    assert.equal(detectarConferencia(aplicarResposta(it, tipo, r).observacao, BASE), null);
  }
});

test('varredura nova: resposta em vigor é reaplicada; documento de outra data reabre a pergunta', async () => {
  const tx = { async query() { return [{ id: RESP, processo_id: PROC, tipo: 'certidao_sapre', referencia: '18/06/2026', resposta: 'descartado' }]; } };
  const novo = () => ({ processo_id: PROC, folha: 'assinaturas', local: '1º JEFP', bloco: 'Assinar precatório no SAPRE', observacao: SAPRE, concluso: null });
  const [mesma] = await aplicarConferencias(tx, [novo()], BASE);
  assert.deepEqual([mesma.folha, mesma.bloco, mesma.conferencia_id, mesma.conferencia_ref], ['cartorio', 'Certificar o envio ao SAPRE', RESP, '18/06/2026']);

  const [outra] = await aplicarConferencias(tx, [{ ...novo(), observacao: 'Certidão do cartório em 20/11 (conferir se é a do SAPRE)' }], BASE);
  assert.deepEqual([outra.folha, outra.conferencia_tipo, outra.conferencia_ref, outra.conferencia_id], ['assinaturas', 'certidao_sapre', '20/11/2026', undefined]);

  // A rotina já aplicou a resposta: o AM só liga a linha à resposta, sem mexer no texto.
  const aplicado = { ...novo(), folha: 'cartorio', bloco: 'Certificar o envio ao SAPRE', observacao: 'texto da rotina', conferencia: { tipo: 'certidao_sapre', referencia: '18/06/2026', pendente: false } };
  const [ligado] = await aplicarConferencias(tx, [aplicado], BASE);
  assert.deepEqual([ligado.observacao, ligado.conferencia_id, 'conferencia' in ligado], ['texto da rotina', RESP, false]);

  // Resposta reaberta depois que a rotina a aplicou: a linha não ganha botões (não há pergunta no texto).
  const [orfao] = await aplicarConferencias({ async query() { return []; } }, [{ ...novo(), observacao: 'texto da rotina', conferencia: { tipo: 'certidao_sapre', referencia: '18/06/2026', pendente: false } }], BASE);
  assert.equal(orfao.conferencia_tipo, undefined);

  // Sem pedido algum, nem consulta o banco.
  let consultou = false;
  await aplicarConferencias({ async query() { consultou = true; return []; } }, [{ processo_id: PROC, observacao: 'Concluso em 01/11' }], BASE);
  assert.equal(consultou, false);
});

test('tela: pedido pendente leva os rótulos dos botões; respondido leva quem e quando', () => {
  const pend = conferenciaDoItem({ observacao: SAPRE }, new Map(), BASE);
  assert.deepEqual(pend, { tipo: 'certidao_sapre', referencia: '18/06/2026', confirmar: 'É a certidão de envio ao SAPRE', descartar: 'Não é a do SAPRE', resposta: null });
  const resp = conferenciaDoItem({ conferencia_tipo: 'certidao_sapre', conferencia_ref: '18/06/2026', conferencia_id: RESP },
    new Map([[RESP, { id: RESP, resposta: 'confirmado', usuario_nome: 'Fulano', respondido_em: BASE }]]), BASE);
  assert.deepEqual(resp.resposta, { id: RESP, resposta: 'confirmado', por: 'Fulano', em: BASE });
  // Resposta que o usuário não pode ver (processo restrito) ou já reaberta: nada é mostrado.
  assert.equal(conferenciaDoItem({ conferencia_tipo: 'certidao_sapre', conferencia_ref: '18/06/2026', conferencia_id: RESP }, new Map(), BASE), null);
  assert.equal(conferenciaDoItem({ observacao: 'Concluso em 01/11' }, new Map(), BASE), null);
});

function bancoFake({ itens = [], jaRespondida = false, conferencia = null } = {}) {
  const chamadas = [];
  const tx = {
    async queryOne(sql, params) {
      chamadas.push({ sql, params });
      if (/FROM despachos_varreduras/.test(sql)) return { id: 'v1', executada_em: BASE };
      if (/SELECT id FROM despachos_conferencias/.test(sql)) return jaRespondida ? { id: RESP } : null;
      if (/INSERT INTO despachos_conferencias/.test(sql)) return { id: RESP, respondido_em: BASE };
      if (/FROM despachos_conferencias c JOIN processos/.test(sql)) return conferencia;
      return null;
    },
    async query(sql, params) { chamadas.push({ sql, params }); return itens; },
    async execute(sql, params) { chamadas.push({ sql, params }); return { rowCount: 1 }; },
  };
  return { chamadas, conexao: { transaction: fn => fn(tx) } };
}
const pedido = (extra = {}) => ({ body: { processo_id: PROC, tipo: 'certidao_sapre', referencia: '18/06/2026', resposta: 'descartado', ...extra }, user: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', nome: 'Fulano', pode_marcar_restrito: false }, _ip: '1.1.1.1' });
const linha = (extra = {}) => ({ id: 'i1', folha: 'assinaturas', local: '1º JEFP', bloco: 'Assinar precatório no SAPRE', observacao: SAPRE, concluso: null, conferencia_tipo: null, conferencia_ref: null, conferencia_id: null, ...extra });

test('responder: valida a entrada antes de abrir transação', async () => {
  for (const ruim of [{ processo_id: 'x' }, { tipo: 'outro' }, { referencia: '18/06' }, { resposta: 'talvez' }]) {
    let abriu = false;
    const res = respostaFake();
    await criarRespostaConferencia({ transaction: async () => { abriu = true; } })(pedido(ruim), res);
    assert.equal(res.statusCode, 400);
    assert.equal(abriu, false);
  }
});

test('responder: grava quem respondeu, muda a linha na hora e audita na mesma transação', async () => {
  const { chamadas, conexao } = bancoFake({ itens: [linha()] });
  const auditorias = [];
  const res = respostaFake();
  await criarRespostaConferencia(conexao, async (a, tx) => { auditorias.push([a, tx]); })(pedido(), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.resultado.bloco, 'Certificar o envio ao SAPRE');

  const busca = chamadas.find(c => /FROM despachos_itens d JOIN processos/.test(c.sql));
  assert.match(busca.sql, /p\.visibilidade = 'normal'/);
  const ins = chamadas.find(c => /INSERT INTO despachos_conferencias/.test(c.sql));
  assert.deepEqual(ins.params.slice(0, 6), [PROC, 'certidao_sapre', '18/06/2026', 'descartado', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Fulano']);
  assert.equal(JSON.parse(ins.params[6]).bloco, 'Assinar precatório no SAPRE');
  const upd = chamadas.find(c => /UPDATE despachos_itens SET/.test(c.sql));
  assert.deepEqual(upd.params, ['i1', 'cartorio', '1º JEFP', 'Certificar o envio ao SAPRE', 'Certidão de 18/06 conferida: não é a do SAPRE · falta a certidão de envio ao SAPRE', 'certidao_sapre', '18/06/2026', RESP]);
  assert.equal(auditorias.length, 1);
  assert.equal(auditorias[0][0].acao, 'responder_conferencia_despacho');
  assert.ok(auditorias[0][1], 'auditoria na mesma transação');
});

test('responder: pedido que saiu da folha, de outra data ou já respondido é recusado sem gravar', async () => {
  const casos = [
    [bancoFake({ itens: [] }), 404],
    [bancoFake({ itens: [linha({ observacao: 'Certidão do cartório em 20/11 (conferir se é a do SAPRE)' })] }), 404],
    [bancoFake({ itens: [linha({ conferencia_tipo: 'certidao_sapre', conferencia_ref: '18/06/2026', conferencia_id: RESP })] }), 404],
    [bancoFake({ itens: [linha()], jaRespondida: true }), 409],
  ];
  for (const [{ chamadas, conexao }, codigo] of casos) {
    const res = respostaFake();
    await criarRespostaConferencia(conexao, async () => {})(pedido(), res);
    assert.equal(res.statusCode, codigo);
    assert.equal(chamadas.some(c => /INSERT INTO despachos_conferencias|UPDATE despachos_itens/.test(c.sql)), false);
  }
});

test('reabrir: marca a resposta como desfeita, devolve a linha ao que era e audita', async () => {
  const anterior = { folha: 'assinaturas', local: '1º JEFP', bloco: 'Assinar precatório no SAPRE', observacao: SAPRE };
  const { chamadas, conexao } = bancoFake({ conferencia: { id: RESP, processo_id: PROC, tipo: 'certidao_sapre', referencia: '18/06/2026', resposta: 'descartado', estado_anterior: anterior } });
  const auditorias = [];
  const res = respostaFake();
  await criarReaberturaConferencia(conexao, async (a) => { auditorias.push(a); })({ params: { id: RESP }, user: { id: 'u', nome: 'Beltrana' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.itens_restaurados, 1);
  const desf = chamadas.find(c => /UPDATE despachos_conferencias SET desfeito_em/.test(c.sql));
  assert.deepEqual(desf.params, [RESP, 'u', 'Beltrana']);
  const upd = chamadas.find(c => /UPDATE despachos_itens SET/.test(c.sql));
  assert.match(upd.sql, /conferencia_id = NULL/);
  assert.deepEqual(upd.params, ['v1', RESP, 'assinaturas', '1º JEFP', 'Assinar precatório no SAPRE', SAPRE]);
  assert.equal(auditorias[0].acao, 'reabrir_conferencia_despacho');

  const nada = respostaFake();
  await criarReaberturaConferencia(bancoFake().conexao, async () => {})({ params: { id: RESP }, user: {} }, nada);
  assert.equal(nada.statusCode, 404);
  const ruim = respostaFake();
  await criarReaberturaConferencia(bancoFake().conexao)({ params: { id: 'x' }, user: {} }, ruim);
  assert.equal(ruim.statusCode, 400);
});

test('rotina: recebe só as respostas em vigor', async () => {
  let sql = '';
  const res = respostaFake();
  await criarListaConferenciasExterna({ async query(s) { sql = s; return [{ numero: '0880640-03.2025.8.15.2001', tipo: 'rpv_sentenca', referencia: '03/11/2026', resposta: 'confirmado' }]; } })({}, res);
  assert.match(sql, /desfeito_em IS NULL/);
  assert.equal(res.body.respostas.length, 1);
});
