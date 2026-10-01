import test from 'node:test';
import assert from 'node:assert/strict';
import { enviarLembretesDiarios, enviarEscalonamentoVespera } from './alertasTarefas.js';

// Sem banco, sem Digisac, sem Redis: `banco` e `enviar` são dublês. Tudo fictício.
delete process.env.FRONTEND_URL;

const NOME_CLIENTE = 'Maria Aparecida Souza Lima';
const CPF = '123.456.789-09';
const CNJ = '0801234-56.2025.8.15.2001';
const TEL = '83912345678';

// Datas de referência (instantes UTC → dia em Brasília):
const QUINTA      = new Date('2026-10-01T11:30:00Z'); // qui 01/10, 08:30 BRT
const SEXTA       = new Date('2026-10-02T19:30:00Z'); // sex 02/10, 16:30 BRT
const SABADO      = new Date('2026-10-03T11:00:00Z'); // sáb 03/10, 08:00 BRT
const DOMINGO     = new Date('2026-10-04T11:00:00Z');
const FERIADO_SEG = new Date('2026-10-12T11:00:00Z'); // seg 12/10 — Nossa Senhora Aparecida
const QUINTA_ANTES_FERIADO = new Date('2026-11-19T19:30:00Z'); // qui 19/11; sexta 20/11 é feriado
// 22:00 de sexta em Brasília, mas já é SÁBADO em UTC — o servidor não pode se enganar
const SEXTA_22H_BRT = new Date('2026-10-03T01:00:00Z');
// 22:00 de domingo em Brasília, mas já é SEGUNDA em UTC
const DOMINGO_22H_BRT = new Date('2026-10-05T01:00:00Z');

function bancoFalso({ vespera = [], masters = [], contagens = {} } = {}) {
  const chamadas = [];
  return {
    chamadas,
    async query(sql, params = []) {
      chamadas.push({ sql, params });
      if (/FROM tarefas t\s+JOIN usuarios ua/.test(sql)) return vespera;
      if (/FROM usuarios\s+WHERE perfil = 'master'/.test(sql)) return masters;
      if (/GROUP BY t\.urgencia/.test(sql)) return contagens[params[0]] || [];
      throw new Error(`consulta não prevista no dublê: ${sql.slice(0, 60)}`);
    },
  };
}

function enviarFalso(resultado = { ok: true, messageId: 'm1', erro: null, antesEnvio: false }) {
  const envios = [];
  return {
    envios,
    async enviar(numero, texto, contexto) {
      envios.push({ numero, texto, contexto });
      return typeof resultado === 'function' ? resultado(numero) : resultado;
    },
  };
}

async function capturandoLog(fn) {
  const linhas = [];
  const originais = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(originais)) console[k] = (...a) => linhas.push(a.map(String).join(' '));
  try { await fn(); } finally { Object.assign(console, originais); }
  return linhas.join('\n');
}

// Linha como o banco devolveria (a query nova não traz `descricao`; o dublê a inclui para provar
// que, mesmo que voltasse, o texto não a usaria).
const tarefaVespera = (extra = {}) => ({
  id: 't1', tipo: 'protocolar', prazo_data: '2026-10-01', dias_restantes: 0, processo_numero: CNJ,
  descricao: `Protocolar — FGTS — ${NOME_CLIENTE} — CPF ${CPF} — R$ 48.250,00`,
  atribuido_id: 'u-ana-0000-0000', atribuido_nome: 'Ana Paula Ferreira', atribuido_whatsapp: TEL,
  master_id: 'u-m1', master_nome: 'Master Um', master_whatsapp: TEL,
  ...extra,
});

// ── Véspera ───────────────────────────────────────────────────────────────────

test('véspera: a mensagem enviada não leva nome do cliente nem CPF nem valor (S-14 / A5-05)', async () => {
  const banco = bancoFalso({ vespera: [tarefaVespera(), tarefaVespera({ tipo: 'prazo', dias_restantes: 1, prazo_data: '2026-10-02', processo_numero: null })] });
  const { envios, enviar } = enviarFalso();
  const r = await enviarEscalonamentoVespera({ banco, enviar, agora: QUINTA, baseUrl: 'https://am.exemplo.com.br' });

  assert.equal(r.enviados, 1);
  assert.equal(envios.length, 1, 'uma mensagem por responsável, com todas as tarefas dele');
  const { texto, numero, contexto } = envios[0];
  assert.equal(numero, TEL);
  assert.deepEqual(contexto, { tipo: 'vespera', origem: 'escalonamento_vespera', usuarioId: 'u-ana-0000-0000' });
  for (const proibido of ['Maria', 'Souza', 'Aparecida', 'Lima', CPF, '12345678909', 'R$', '48.250']) {
    assert.ok(!texto.includes(proibido), `vazou "${proibido}" na mensagem`);
  }
  assert.match(texto, /HOJE — Protocolar · 0801234-56\.2025\.8\.15\.2001/);
  assert.match(texto, /AMANHÃ — Prazo/);
  assert.match(texto, /Atenção, Ana!/);
  assert.match(texto, /https:\/\/am\.exemplo\.com\.br\/tarefas/);
});

test('véspera: a consulta nunca seleciona a descrição da tarefa, e "hoje" vai como parâmetro de Brasília', async () => {
  const banco = bancoFalso();
  await enviarEscalonamentoVespera({ banco, enviar: enviarFalso().enviar, agora: QUINTA });
  const { sql, params } = banco.chamadas[0];
  assert.ok(!/descricao/i.test(sql), 'a query não pode trazer descricao');
  assert.ok(!/CURRENT_DATE/i.test(sql), 'sem CURRENT_DATE (UTC): a data vem do relógio de Brasília');
  assert.ok(/ua\.ativo = true/.test(sql), 'só destinatário ativo');
  assert.deepEqual(params, ['2026-10-01', '2026-10-02']);
});

test('véspera: sexta cobre até a segunda; véspera de feriado cobre até o próximo dia útil', async () => {
  const b1 = bancoFalso();
  await enviarEscalonamentoVespera({ banco: b1, enviar: enviarFalso().enviar, agora: SEXTA });
  assert.deepEqual(b1.chamadas[0].params, ['2026-10-02', '2026-10-05']);

  const b2 = bancoFalso();
  await enviarEscalonamentoVespera({ banco: b2, enviar: enviarFalso().enviar, agora: QUINTA_ANTES_FERIADO });
  assert.deepEqual(b2.chamadas[0].params, ['2026-11-19', '2026-11-23']);
});

test('véspera: prazo de segunda avisado na sexta sai com o dia da semana, não "AMANHÃ"', async () => {
  const banco = bancoFalso({ vespera: [tarefaVespera({ dias_restantes: 3, prazo_data: '2026-10-05' })] });
  const { envios, enviar } = enviarFalso();
  await enviarEscalonamentoVespera({ banco, enviar, agora: SEXTA });
  assert.match(envios[0].texto, /SEGUNDA-FEIRA 05\/10 — Protocolar/);
  assert.ok(!/AMANHÃ/.test(envios[0].texto));
});

test('véspera: não dispara em sábado, domingo nem feriado nacional (nem consulta o banco)', async () => {
  for (const [nome, agora] of [['sábado', SABADO], ['domingo', DOMINGO], ['feriado 12/10', FERIADO_SEG], ['domingo 22h BRT (segunda em UTC)', DOMINGO_22H_BRT]]) {
    const banco = bancoFalso({ vespera: [tarefaVespera()] });
    const { envios, enviar } = enviarFalso();
    const r = await enviarEscalonamentoVespera({ banco, enviar, agora });
    assert.equal(r.ignorado, true, nome);
    assert.equal(envios.length, 0, `${nome}: nada enviado`);
    assert.equal(banco.chamadas.length, 0, `${nome}: nada consultado`);
  }
});

test('véspera: usa o dia de Brasília, não o de UTC (sexta 22h BRT já é sábado em UTC e ainda é dia útil)', async () => {
  const banco = bancoFalso();
  const r = await enviarEscalonamentoVespera({ banco, enviar: enviarFalso().enviar, agora: SEXTA_22H_BRT });
  assert.equal(r.ignorado, false);
  assert.deepEqual(banco.chamadas[0].params, ['2026-10-02', '2026-10-05']);
});

test('véspera: sem WhatsApp cadastrado não envia; envio que falha é contado e logado sem telefone nem nome', async () => {
  const banco = bancoFalso({ vespera: [tarefaVespera({ atribuido_whatsapp: '' }), tarefaVespera({ atribuido_id: 'u-bia-1111-2222', atribuido_nome: 'Beatriz Nunes Alves' })] });
  const { envios, enviar } = enviarFalso({ ok: false, messageId: null, erro: 'HTTP 400: sem conexão', antesEnvio: true });
  let r;
  const log = await capturandoLog(async () => { r = await enviarEscalonamentoVespera({ banco, enviar, agora: QUINTA }); });
  assert.equal(envios.length, 1, 'só quem tem número');
  assert.equal(r.enviados, 0, 'falha não conta como enviado');
  assert.match(log, /não entregue ao usuário u-bia-11/);
  assert.match(log, /enviado para 0 de 1/);
  for (const proibido of [TEL, '9123', 'Beatriz', 'Nunes', NOME_CLIENTE, CPF]) {
    assert.ok(!log.includes(proibido), `vazou "${proibido}" no log`);
  }
});

test('véspera: agrupa por responsável (2 pessoas, 2 mensagens)', async () => {
  const banco = bancoFalso({ vespera: [
    tarefaVespera(),
    tarefaVespera({ id: 't2' }),
    tarefaVespera({ id: 't3', atribuido_id: 'u-bia-1111-2222', atribuido_nome: 'Beatriz', atribuido_whatsapp: '83988887777' }),
  ] });
  const { envios, enviar } = enviarFalso();
  const r = await enviarEscalonamentoVespera({ banco, enviar, agora: QUINTA });
  assert.equal(envios.length, 2);
  assert.match(envios.find(e => e.numero === TEL).texto, /Você tem 2 prazos/);
  assert.equal(r.enviados, 2);
});

// ── Lembrete diário ───────────────────────────────────────────────────────────

const masterA = { id: 'm-a', nome: 'Luciano Exemplo', whatsapp: TEL };

test('lembrete diário: envia o resumo em dia útil e só a masters ativos com número', async () => {
  const banco = bancoFalso({
    masters: [masterA],
    contagens: { 'm-a': [{ urgencia: 'CRITICO', total: '2' }, { urgencia: 'ALTO', total: '1' }] },
  });
  const { envios, enviar } = enviarFalso();
  const r = await enviarLembretesDiarios({ banco, enviar, agora: QUINTA });
  assert.equal(r.enviados, 1);
  assert.equal(envios.length, 1);
  assert.deepEqual(envios[0].contexto, { tipo: 'lembrete_diario', origem: 'lembretes_diarios', usuarioId: 'm-a' });
  assert.match(envios[0].texto, /Bom dia, Luciano!/);
  assert.match(envios[0].texto, /2 Críticas/);
  assert.match(envios[0].texto, /1 Alta/);
  const sqlMasters = banco.chamadas[0].sql;
  assert.ok(/ativo = true/.test(sqlMasters) && /perfil = 'master'/.test(sqlMasters), 'só master ativo');
});

test('lembrete diário: NÃO dispara em sábado, domingo nem feriado nacional (nem consulta o banco)', async () => {
  for (const [nome, agora] of [['sábado', SABADO], ['domingo', DOMINGO], ['feriado 12/10', FERIADO_SEG], ['domingo 22h BRT (segunda em UTC)', DOMINGO_22H_BRT]]) {
    const banco = bancoFalso({ masters: [masterA], contagens: { 'm-a': [{ urgencia: 'CRITICO', total: '5' }] } });
    const { envios, enviar } = enviarFalso();
    const r = await enviarLembretesDiarios({ banco, enviar, agora });
    assert.equal(r.ignorado, true, nome);
    assert.equal(envios.length, 0, `${nome}: nada enviado`);
    assert.equal(banco.chamadas.length, 0, `${nome}: nada consultado`);
  }
});

test('lembrete diário: sexta 22h BRT (sábado em UTC) ainda é dia útil de Brasília', async () => {
  const banco = bancoFalso({ masters: [masterA], contagens: { 'm-a': [{ urgencia: 'MEDIO', total: '3' }] } });
  const { envios, enviar } = enviarFalso();
  const r = await enviarLembretesDiarios({ banco, enviar, agora: SEXTA_22H_BRT });
  assert.equal(r.ignorado, false);
  assert.equal(envios.length, 1);
});

test('lembrete diário: master sem pendência não recebe; falha de envio não conta como enviado', async () => {
  const banco = bancoFalso({ masters: [masterA, { id: 'm-b', nome: 'Outro Master', whatsapp: '83977776666' }], contagens: { 'm-a': [{ urgencia: 'ALTO', total: '1' }] } });
  const { envios, enviar } = enviarFalso({ ok: false, messageId: null, erro: 'x', antesEnvio: true });
  const r = await enviarLembretesDiarios({ banco, enviar, agora: QUINTA });
  assert.equal(envios.length, 1, 'm-b não tem pendência');
  assert.equal(r.enviados, 0);
  assert.equal(r.total, 2);
});
