import test from 'node:test';
import assert from 'node:assert/strict';
import {
  enviarAlerta, mascararTelefone, normalizarNumeroWhatsapp, classificarFalhaEnvio, registrarEnvioWhatsapp,
} from './index.js';

// Nenhum teste aqui fala com o Digisac nem com o banco: `api` e `registrar` são dublês.
// Telefone usado é fictício.
const TEL = '83912345678';       // 11 dígitos, como fica em usuarios.whatsapp
const TEL_COMPLETO = '5583912345678';

function ambiente(fn) {
  const antes = process.env.DIGISAC_SERVICE_ID;
  process.env.DIGISAC_SERVICE_ID = 'servico-teste';
  const restaurar = () => {
    if (antes === undefined) delete process.env.DIGISAC_SERVICE_ID; else process.env.DIGISAC_SERVICE_ID = antes;
  };
  return Promise.resolve().then(fn).finally(restaurar);
}

// Captura tudo que o código manda pro console: o log NÃO pode conter o telefone inteiro.
async function capturandoLog(fn) {
  const linhas = [];
  const originais = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(originais)) console[k] = (...a) => linhas.push(a.map(String).join(' '));
  try { await fn(); } finally { Object.assign(console, originais); }
  return linhas.join('\n');
}

function apiFalsa({ resposta, erro } = {}) {
  const chamadas = [];
  return {
    chamadas,
    async post(url, corpo) {
      chamadas.push({ url, corpo });
      if (erro) throw erro;
      return resposta ?? { data: { id: 'msg-123' } };
    },
  };
}

function registradorFalso() {
  const registros = [];
  return { registros, async registrar(r) { registros.push(r); } };
}

test('mascararTelefone: nunca devolve o número inteiro', () => {
  assert.equal(mascararTelefone(TEL), '+55 83 9****-5678');
  assert.equal(mascararTelefone(TEL_COMPLETO), '+55 83 9****-5678');
  assert.equal(mascararTelefone('(83) 91234-5678'), '+55 83 9****-5678');
  assert.equal(mascararTelefone('558332145678'), '+55 83 ****-5678'); // fixo, 8 dígitos
  for (const m of [mascararTelefone(TEL), mascararTelefone(TEL_COMPLETO)]) {
    assert.ok(!m.includes('12345'), 'miolo do número não pode aparecer');
  }
});

test('mascararTelefone: entrada inválida ou curta vira "***" ou só os 4 últimos', () => {
  assert.equal(mascararTelefone(null), '***');
  assert.equal(mascararTelefone(undefined), '***');
  assert.equal(mascararTelefone('123'), '***');
  assert.equal(mascararTelefone('abc'), '***');
  assert.equal(mascararTelefone('123456789'), '****-6789'); // 9 dígitos: não é telefone BR completo
});

test('normalizarNumeroWhatsapp: aceita 10/11 dígitos (põe o 55) e 12/13 com 55', () => {
  assert.equal(normalizarNumeroWhatsapp(TEL), TEL_COMPLETO);
  assert.equal(normalizarNumeroWhatsapp('(83) 91234-5678'), TEL_COMPLETO);
  assert.equal(normalizarNumeroWhatsapp('+55 83 91234-5678'), TEL_COMPLETO);
  assert.equal(normalizarNumeroWhatsapp('8332145678'), '558332145678'); // fixo, 10 dígitos
  assert.equal(normalizarNumeroWhatsapp(TEL_COMPLETO), TEL_COMPLETO);
});

test('normalizarNumeroWhatsapp: DDD 55 com 11 dígitos recebe o código do país (o teste antigo "começa com 55" errava)', () => {
  assert.equal(normalizarNumeroWhatsapp('55991234567'), '5555991234567');
});

test('normalizarNumeroWhatsapp: rejeita o que não é telefone brasileiro', () => {
  for (const ruim of [null, undefined, '', 'abc', '123', '123456789', '083912345678', '558391234567890', '1234567890123456']) {
    assert.equal(normalizarNumeroWhatsapp(ruim), null, `deveria rejeitar ${JSON.stringify(ruim)}`);
  }
});

test('classificarFalhaEnvio: erro ANTES do envio (seguro tentar de novo)', () => {
  assert.equal(classificarFalhaEnvio({ code: 'ECONNREFUSED' }).antesEnvio, true);
  assert.equal(classificarFalhaEnvio({ code: 'ENOTFOUND' }).antesEnvio, true);
  assert.equal(classificarFalhaEnvio({ response: { status: 400, data: { message: 'x' } } }).antesEnvio, true);
  assert.equal(classificarFalhaEnvio({ response: { status: 401 } }).antesEnvio, true);
  assert.equal(classificarFalhaEnvio({ response: { status: 429 } }).antesEnvio, true);
  // mesmo critério da Camila: sessão do WhatsApp desconectada é rejeição antes do envio, mesmo em 5xx
  assert.equal(classificarFalhaEnvio({ response: { status: 503, data: { message: 'Service disconnected' } } }).antesEnvio, true);
});

test('classificarFalhaEnvio: timeout, conexão derrubada e 5xx são INCERTOS (não repetir sozinho)', () => {
  assert.equal(classificarFalhaEnvio({ code: 'ECONNABORTED', message: 'timeout of 15000ms exceeded' }).antesEnvio, false);
  assert.equal(classificarFalhaEnvio({ code: 'ETIMEDOUT' }).antesEnvio, false);
  assert.equal(classificarFalhaEnvio({ code: 'ECONNRESET' }).antesEnvio, false);
  assert.equal(classificarFalhaEnvio({ response: { status: 500, data: 'erro interno' } }).antesEnvio, false);
  assert.equal(classificarFalhaEnvio({ response: { status: 408 } }).antesEnvio, false);
  assert.equal(classificarFalhaEnvio(new Error('qualquer coisa')).antesEnvio, false);
  assert.equal(classificarFalhaEnvio(undefined).antesEnvio, false);
});

test('enviarAlerta: payload usa `number` (não `contactPhone`), com origin bot e dontOpenTicket', async () => {
  await ambiente(async () => {
    const api = apiFalsa();
    const { registros, registrar } = registradorFalso();
    const r = await enviarAlerta(TEL, 'Texto do alerta', { api, registrar });

    assert.equal(api.chamadas.length, 1);
    assert.equal(api.chamadas[0].url, '/messages');
    assert.deepEqual(api.chamadas[0].corpo, {
      serviceId: 'servico-teste',
      number: TEL_COMPLETO,
      type: 'text',
      text: 'Texto do alerta',
      origin: 'bot',
      dontOpenTicket: true,
    });
    assert.equal('contactPhone' in api.chamadas[0].corpo, false);
    assert.deepEqual(r, { ok: true, messageId: 'msg-123', erro: null, antesEnvio: false });
    assert.equal(registros.length, 1);
    assert.equal(registros[0].status, 'enviado');
    assert.equal(registros[0].messageId, 'msg-123');
  });
});

test('enviarAlerta: registra tipo, origem e usuário, sem o texto nem o telefone inteiro', async () => {
  await ambiente(async () => {
    const { registros, registrar } = registradorFalso();
    await enviarAlerta(TEL, 'Conteúdo sigiloso da mensagem', {
      api: apiFalsa(), registrar, tipo: 'vespera', origem: 'escalonamento_vespera', usuarioId: 'uuid-do-usuario',
    });
    const reg = registros[0];
    assert.equal(reg.tipo, 'vespera');
    assert.equal(reg.origem, 'escalonamento_vespera');
    assert.equal(reg.usuarioId, 'uuid-do-usuario');
    assert.equal(reg.destino, '+55 83 9****-5678');
    const serializado = JSON.stringify(reg);
    assert.ok(!serializado.includes('sigiloso'), 'o texto da mensagem não pode ser registrado');
    assert.ok(!serializado.includes(TEL) && !serializado.includes(TEL_COMPLETO), 'telefone inteiro não pode ser registrado');
  });
});

test('enviarAlerta: tipo padrão é alerta_tecnico', async () => {
  await ambiente(async () => {
    const { registros, registrar } = registradorFalso();
    await enviarAlerta(TEL, 'x', { api: apiFalsa(), registrar });
    assert.equal(registros[0].tipo, 'alerta_tecnico');
  });
});

test('enviarAlerta: o log não imprime o telefone inteiro (sucesso, falha e número inválido)', async () => {
  await ambiente(async () => {
    const { registrar } = registradorFalso();
    const saida = await capturandoLog(async () => {
      await enviarAlerta(TEL, 'x', { api: apiFalsa(), registrar });
      await enviarAlerta(TEL, 'x', {
        api: apiFalsa({ erro: Object.assign(new Error('falhou'), { response: { status: 400, data: { message: `número ${TEL_COMPLETO} inválido` } } }) }),
        registrar,
      });
      await enviarAlerta('83912345', 'x', { api: apiFalsa(), registrar });
    });
    assert.ok(saida.length > 0, 'esperava alguma linha de log');
    assert.ok(!saida.includes(TEL), 'log contém o telefone inteiro');
    assert.ok(!saida.includes(TEL_COMPLETO), 'log contém o telefone completo com 55');
    assert.ok(!saida.includes('83912345'), 'log contém o número inválido inteiro');
    assert.ok(saida.includes('5678'), 'o log deveria identificar o destino pelos 4 últimos dígitos');
  });
});

test('enviarAlerta: 4xx do Digisac → ok:false, antesEnvio:true, status "falhou", erro sem telefone', async () => {
  await ambiente(async () => {
    const erro = Object.assign(new Error('Request failed with status code 400'), {
      response: { status: 400, data: { message: `contato ${TEL_COMPLETO} não encontrado` } },
    });
    const { registros, registrar } = registradorFalso();
    const r = await enviarAlerta(TEL, 'x', { api: apiFalsa({ erro }), registrar });

    assert.equal(r.ok, false);
    assert.equal(r.messageId, null);
    assert.equal(r.antesEnvio, true);
    assert.match(r.erro, /HTTP 400/);
    assert.ok(!r.erro.includes(TEL_COMPLETO), 'erro devolvido não pode trazer o telefone');
    assert.equal(registros[0].status, 'falhou');
    assert.ok(!String(registros[0].erro).includes(TEL_COMPLETO), 'erro registrado não pode trazer o telefone');
  });
});

test('enviarAlerta: timeout → ok:false, antesEnvio:false, status "incerto"', async () => {
  await ambiente(async () => {
    const erro = Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED' });
    const { registros, registrar } = registradorFalso();
    const r = await enviarAlerta(TEL, 'x', { api: apiFalsa({ erro }), registrar });
    assert.equal(r.ok, false);
    assert.equal(r.antesEnvio, false);
    assert.equal(registros[0].status, 'incerto');
  });
});

test('enviarAlerta: número inválido não chama o Digisac e registra "sem_numero"', async () => {
  await ambiente(async () => {
    for (const ruim of [null, '', '123', 'abc', '83912345']) {
      const api = apiFalsa();
      const { registros, registrar } = registradorFalso();
      const r = await enviarAlerta(ruim, 'x', { api, registrar });
      assert.equal(api.chamadas.length, 0, `não deveria enviar para ${JSON.stringify(ruim)}`);
      assert.equal(r.ok, false);
      assert.equal(r.antesEnvio, true);
      assert.equal(registros[0].status, 'sem_numero');
    }
  });
});

test('enviarAlerta: Digisac não configurado (sem cliente ou sem serviceId) → ok:false sem lançar', async () => {
  const antes = process.env.DIGISAC_SERVICE_ID;
  try {
    process.env.DIGISAC_SERVICE_ID = 'servico-teste';
    const a = registradorFalso();
    const semApi = await enviarAlerta(TEL, 'x', { api: null, registrar: a.registrar });
    assert.equal(semApi.ok, false);
    assert.equal(semApi.antesEnvio, true);
    assert.equal(a.registros[0].status, 'falhou');

    delete process.env.DIGISAC_SERVICE_ID;
    const api = apiFalsa();
    const b = registradorFalso();
    const semServico = await enviarAlerta(TEL, 'x', { api, registrar: b.registrar });
    assert.equal(semServico.ok, false);
    assert.equal(api.chamadas.length, 0, 'sem serviceId não pode enviar');
  } finally {
    if (antes === undefined) delete process.env.DIGISAC_SERVICE_ID; else process.env.DIGISAC_SERVICE_ID = antes;
  }
});

test('enviarAlerta: nunca lança — nem se o registro falhar, nem se o envio explodir', async () => {
  await ambiente(async () => {
    const registrarQuebrado = async () => { throw new Error('banco fora do ar'); };
    const r1 = await enviarAlerta(TEL, 'x', { api: apiFalsa(), registrar: registrarQuebrado });
    assert.equal(r1.ok, true, 'o envio aconteceu; só o registro falhou');

    const apiQuebrada = { post() { throw new TypeError('bug qualquer'); } };
    const r2 = await enviarAlerta(TEL, 'x', { api: apiQuebrada, registrar: registrarQuebrado });
    assert.equal(r2.ok, false);
    assert.equal(r2.messageId, null);
  });
});

test('enviarAlerta: resposta 2xx sem id ainda é ok, com messageId nulo', async () => {
  await ambiente(async () => {
    const r = await enviarAlerta(TEL, 'x', { api: apiFalsa({ resposta: { data: {} } }), registrar: async () => {} });
    assert.equal(r.ok, true);
    assert.equal(r.messageId, null);
  });
});

test('registrarEnvioWhatsapp: grava destino mascarado, chave única e enviado_em só para "enviado"', async () => {
  const chamadas = [];
  const banco = { async execute(sql, params) { chamadas.push({ sql, params }); } };
  await registrarEnvioWhatsapp({ tipo: 'alerta_tecnico', origem: 'backup', usuarioId: 'u1', destino: '+55 83 9****-5678', status: 'enviado', messageId: 'm1' }, banco);
  await registrarEnvioWhatsapp({ tipo: 'alerta_tecnico', origem: 'backup', usuarioId: null, destino: '+55 83 9****-5678', status: 'falhou', erro: 'HTTP 400' }, banco);

  assert.equal(chamadas.length, 2);
  assert.match(chamadas[0].sql, /INSERT INTO notificacoes_whatsapp/);
  const [p1, p2] = chamadas.map(c => c.params);
  // [tipo, origem, usuario_id, destino_mascarado, chave, status, message_id, erro, enviado_em]
  assert.equal(p1[3], '+55 83 9****-5678');
  assert.ok(p1[4].startsWith('alerta_tecnico:'));
  assert.notEqual(p1[4], p2[4], 'cada envio precisa de uma chave própria');
  assert.ok(p1[8] instanceof Date, 'enviado_em preenchido quando enviado');
  assert.equal(p2[8], null, 'enviado_em nulo quando falhou');
  assert.equal(p2[2], null);
  assert.ok(!chamadas[0].sql.toLowerCase().includes('texto'), 'a tabela não guarda o texto da mensagem');
});

test('registrarEnvioWhatsapp: falha do banco não lança', async () => {
  const banco = { async execute() { throw new Error('relation "notificacoes_whatsapp" does not exist'); } };
  const saida = await capturandoLog(async () => {
    await assert.doesNotReject(registrarEnvioWhatsapp({ tipo: 'alerta_tecnico', destino: '***', status: 'enviado' }, banco));
  });
  assert.match(saida, /notificacoes_whatsapp/);
});
