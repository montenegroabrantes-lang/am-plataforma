import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  rotuloTipoTarefa, cnjParaMensagem, linkAM, formatarDataBR, rotuloQuando,
  montarLinhaVespera, montarMensagemVespera, montarMensagemCritico,
} from './mensagensAlerta.js';

// Sem endereço público configurado por padrão: o que decide o link é o `baseUrl` passado em cada teste.
delete process.env.FRONTEND_URL;

// Dados fictícios. O nome, o CPF e o valor abaixo são o que NÃO pode chegar ao WhatsApp.
const NOME_CLIENTE = 'Maria Aparecida Souza Lima';
const CPF = '123.456.789-09';
const VALOR = 'R$ 48.250,00';
const CNJ = '0801234-56.2025.8.15.2001';

// Linha como o banco a devolve; `descricao` está aqui de propósito: mesmo que alguém volte a
// selecioná-la, o formatador não pode usá-la.
const linhaDoBanco = (extra = {}) => ({
  tipo: 'protocolar',
  descricao: `Protocolar — FGTS — ${NOME_CLIENTE} — CPF ${CPF} — ${VALOR}`,
  prazo_data: '2026-10-01',
  dias_restantes: 0,
  processo_numero: CNJ,
  ...extra,
});

function semDadoPessoal(texto) {
  assert.ok(!texto.includes('Maria'), 'primeiro nome do cliente');
  assert.ok(!texto.includes('Souza'), 'sobrenome do cliente');
  assert.ok(!texto.includes('Aparecida'), 'nome do meio do cliente');
  assert.ok(!texto.includes(CPF), 'CPF formatado');
  assert.ok(!texto.includes('12345678909'), 'CPF só dígitos');
  assert.ok(!/\d{3}\.\d{3}\.\d{3}-\d{2}/.test(texto), 'qualquer CPF');
  assert.ok(!texto.includes('R$'), 'valor em reais');
  assert.ok(!texto.includes('48.250'), 'valor');
  assert.ok(!/\bFGTS\b/.test(texto), 'a descrição crua (com a tese) não é lida');
}

test('rotuloTipoTarefa: lista fechada; tipo desconhecido vira "Tarefa", nunca o texto cru', () => {
  assert.equal(rotuloTipoTarefa('prazo'), 'Prazo');
  assert.equal(rotuloTipoTarefa('protocolar'), 'Protocolar');
  assert.equal(rotuloTipoTarefa('prazo_pagamento'), 'Prazo de pagamento');
  assert.equal(rotuloTipoTarefa('qualquer_coisa'), 'Tarefa');
  assert.equal(rotuloTipoTarefa(NOME_CLIENTE), 'Tarefa');
  assert.equal(rotuloTipoTarefa(null), 'Tarefa');
});

test('cnjParaMensagem: só número CNJ de verdade; texto livre de processos.numero não vai pro WhatsApp', () => {
  assert.equal(cnjParaMensagem(CNJ), CNJ);
  assert.equal(cnjParaMensagem('08012345620258152001'), CNJ);
  assert.equal(cnjParaMensagem(` ${CNJ} `), CNJ);
  for (const ruim of [null, undefined, '', NOME_CLIENTE, `${CNJ} ${NOME_CLIENTE}`, CPF, '123', `${CNJ}\n${CPF}`]) {
    assert.equal(cnjParaMensagem(ruim), null, `deveria recusar ${JSON.stringify(ruim)}`);
  }
});

test('linkAM: só com endereço público; nada de localhost, token ou id de cliente', () => {
  assert.equal(linkAM('/tarefas', 'https://am.exemplo.com.br'), 'https://am.exemplo.com.br/tarefas');
  assert.equal(linkAM('/tarefas', 'https://am.exemplo.com.br/'), 'https://am.exemplo.com.br/tarefas');
  assert.equal(linkAM('/processos', 'https://am.exemplo.com.br//'), 'https://am.exemplo.com.br/processos');
  for (const ruim of [undefined, null, '', 'localhost:3000', 'http://localhost:3000', 'http://127.0.0.1:3000', 'https://localhost', 'ftp://x.com', 'javascript:alert(1)']) {
    assert.equal(linkAM('/tarefas', ruim), null, `deveria recusar ${JSON.stringify(ruim)}`);
  }
  assert.ok(!/[?#]|token|login/i.test(linkAM('/tarefas', 'https://am.exemplo.com.br')));
});

test('formatarDataBR: dia civil sem virar de dia com o fuso', () => {
  assert.equal(formatarDataBR('2026-10-05'), '05/10/2026');
  assert.equal(formatarDataBR('2026-10-05T00:00:00.000Z'), '05/10/2026');
  assert.equal(formatarDataBR('abc'), null);
  assert.equal(formatarDataBR(null), null);
});

test('rotuloQuando: HOJE, AMANHÃ, ou o dia e a data quando a véspera cobre o fim de semana', () => {
  assert.equal(rotuloQuando({ diasRestantes: 0, prazoData: '2026-10-02' }), 'HOJE');
  assert.equal(rotuloQuando({ diasRestantes: '1', prazoData: '2026-10-03' }), 'AMANHÃ');
  assert.equal(rotuloQuando({ diasRestantes: 3, prazoData: '2026-10-05' }), 'SEGUNDA-FEIRA 05/10');
  assert.equal(rotuloQuando({ diasRestantes: 2, prazoData: '2026-10-04' }), 'DOMINGO 04/10');
  assert.equal(rotuloQuando({ diasRestantes: 3, prazoData: null }), 'EM BREVE');
});

test('montarLinhaVespera: tipo, quando e CNJ — e NADA da descrição (nome, CPF, valor)', () => {
  const linha = montarLinhaVespera(linhaDoBanco());
  assert.equal(linha, `🔴 HOJE — Protocolar · ${CNJ}`);
  semDadoPessoal(linha);
});

test('montarLinhaVespera: sem processo, sem CNJ; número que não é CNJ é omitido', () => {
  assert.equal(montarLinhaVespera(linhaDoBanco({ processo_numero: null, tipo: 'prazo', dias_restantes: 1 })), '🔴 AMANHÃ — Prazo');
  const linha = montarLinhaVespera(linhaDoBanco({ processo_numero: NOME_CLIENTE }));
  assert.equal(linha, '🔴 HOJE — Protocolar');
  semDadoPessoal(linha);
});

test('montarMensagemVespera: nome e CPF do cliente não saem, mesmo com descrição cheia deles', () => {
  const msg = montarMensagemVespera({
    nome: 'Ana Paula Ferreira',
    tarefas: [
      linhaDoBanco(),
      linhaDoBanco({ tipo: 'prazo', dias_restantes: 1, prazo_data: '2026-10-02', processo_numero: '0809999-11.2025.8.15.2001' }),
    ],
    baseUrl: 'https://am.exemplo.com.br',
  });
  semDadoPessoal(msg);
  assert.match(msg, /Atenção, Ana!/);
  assert.match(msg, /Você tem 2 prazos vencendo:/);
  assert.match(msg, new RegExp(`HOJE — Protocolar · ${CNJ.replace(/\./g, '\\.')}`));
  assert.match(msg, /AMANHÃ — Prazo · 0809999-11\.2025\.8\.15\.2001/);
  assert.match(msg, /https:\/\/am\.exemplo\.com\.br\/tarefas$/);
  assert.ok(!msg.includes('Ferreira'), 'só o primeiro nome do destinatário');
});

test('montarMensagemVespera: singular, ordem por urgência e teto de 15 linhas', () => {
  const uma = montarMensagemVespera({ nome: 'Ana', tarefas: [linhaDoBanco()], baseUrl: undefined });
  assert.match(uma, /Você tem 1 prazo vencendo:/);
  assert.ok(!/http/.test(uma), 'sem link quando não há endereço público configurado');

  const mistas = montarMensagemVespera({
    nome: 'Ana',
    tarefas: [linhaDoBanco({ dias_restantes: 1, prazo_data: '2026-10-02' }), linhaDoBanco({ dias_restantes: 0 })],
  });
  assert.ok(mistas.indexOf('HOJE') < mistas.indexOf('AMANHÃ'), 'HOJE vem antes de AMANHÃ');

  const muitas = Array.from({ length: 40 }, () => linhaDoBanco());
  const longa = montarMensagemVespera({ nome: 'Ana', tarefas: muitas });
  assert.equal((longa.match(/🔴/g) || []).length, 15);
  assert.match(longa, /… e mais 25\./);
  assert.match(longa, /Você tem 40 prazos vencendo/);
  assert.ok(longa.length < 2000, 'cabe folgado no limite do WhatsApp');
});

test('montarMensagemCritico: só CNJ, prazo e convite — texto da movimentação e resumo da IA não saem', () => {
  const msg = montarMensagemCritico({
    numero: CNJ, prazoFinal: '2026-10-12', statusPrazo: 'VENCIDO', baseUrl: 'https://am.exemplo.com.br',
    // campos que o sync tem à mão e que NÃO podem ir (a função nem os recebe, mas o teste garante)
    descricao: `Intimação de ${NOME_CLIENTE}`, resumo: `Pagar ${VALOR} a ${NOME_CLIENTE}`, texto: `CPF ${CPF}`,
  });
  assert.equal(
    msg,
    `⚠️ *Movimentação crítica* no processo ${CNJ}.\nPrazo: 12/10/2026 — VENCIDO\n\nAbra o AM para ver.\nhttps://am.exemplo.com.br/processos`,
  );
  semDadoPessoal(msg);
});

test('montarMensagemCritico: sem prazo, sem link, número inválido', () => {
  assert.equal(
    montarMensagemCritico({ numero: CNJ, baseUrl: undefined }),
    `⚠️ *Movimentação crítica* no processo ${CNJ}.\n\nAbra o AM para ver.`,
  );
  const sem = montarMensagemCritico({ numero: NOME_CLIENTE, prazoFinal: '2026-10-12', statusPrazo: 'NO_PRAZO' });
  assert.ok(!sem.includes('Maria'));
  assert.ok(!sem.includes('VENCIDO'));
  assert.match(sem, /Prazo: 12\/10\/2026/);
});

// ── Ligações: o que o sync e os logs de ciclos/polos usam ────────────────────
// Proteção contra regressão na hora de integrar patches: se alguém refizer esses trechos
// sem levar a correção, o teste acusa.
const fonte = caminho => readFileSync(new URL(caminho, import.meta.url), 'utf8');

test('sync.js: o alerta CRÍTICO usa o formatador e não monta texto com a movimentação nem com o resumo da IA', () => {
  const sync = fonte('./tribunal/sync.js');
  assert.match(sync, /montarMensagemCritico\(/);
  assert.ok(!/mov\.texto\.slice\(0,\s*200\)/.test(sync), 'texto da movimentação voltou pro WhatsApp');
  assert.ok(!/Pendente: \$\{diag\.pendencia/.test(sync), 'resumo da IA voltou pro WhatsApp');
});

test('logs: ciclos e polos não imprimem nome de cliente nem nome de parte', () => {
  assert.ok(!/console\.log\([^\n]*cliente_nome/.test(fonte('./ciclosRecorrentes.js')), 'nome do cliente no log de ciclos');
  assert.ok(!/console\.log\([^\n]*polo_(ativo|passivo)/.test(fonte('./tribunal/sync.js')), 'nome de parte no log de polos');
});
