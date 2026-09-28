// Teste de deriva: o levantamento de re-protocolo copia regras da tela de Tarefas e do cron em
// vez de alterá-los (ver regras.js). Se alguém mudar a regra lá e não aqui (ou vice-versa), este
// teste falha e aponta o fragmento que divergiu.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as R from './regras.js';

const ler = caminho => readFileSync(new URL(caminho, import.meta.url), 'utf8');
// Ignora só formatação: espaços/quebras e espaços em volta de operadores e pontuação.
const normalizar = sql => sql.replace(/\s+/g, ' ').replace(/\s*(<>|<=|>=|=|,|\(|\)|::)\s*/g, '$1').trim();
const ocorrencias = (texto, trecho) => texto.split(trecho).length - 1;

const tarefas = normalizar(ler('../../routes/tarefas.js'));
const cron = normalizar(ler('../ciclosRecorrentes.js'));
const estadual = ler('../remuneracaoEstadual.js');

test('filas: Re-protocolo e Novos ciclos idênticas às de tarefas.js (GET, /resumo e /resumo-teses)', () => {
  assert.ok(ocorrencias(tarefas, normalizar(R.FILA_REPROTOCOLO)) >= 3, 'FILA_REPROTOCOLO');
  assert.ok(ocorrencias(tarefas, normalizar(R.FILA_CICLOS)) >= 3, 'FILA_CICLOS');
  assert.ok(ocorrencias(tarefas, normalizar(R.CICLO_NAO_ADIADO)) >= 3, 'CICLO_NAO_ADIADO');
  assert.ok(tarefas.includes(normalizar(R.TAREFA_ABERTA)), 'TAREFA_ABERTA');
  // O contador do cockpit (GET /resumo) combina exatamente assim:
  assert.ok(tarefas.includes(normalizar(`${R.TAREFA_ABERTA} AND ${R.FILA_REPROTOCOLO}`)), 'resumo.reprotocolo');
  assert.ok(tarefas.includes(normalizar(`${R.FILA_CICLOS} AND ${R.TAREFA_ABERTA} AND ${R.CICLO_NAO_ADIADO}`)), 'resumo.ciclos');
});

test('cliente, tese e polo passivo: mesmas expressões da listagem de tarefas', () => {
  for (const [nome, trecho] of Object.entries({
    CLIENTE_ID: R.CLIENTE_ID, CLIENTE_NOME: R.CLIENTE_NOME, CLIENTE_CPF: R.CLIENTE_CPF,
    PRODUTO_ID: R.PRODUTO_ID, PRODUTO_NOME: R.PRODUTO_NOME, POLO_PASSIVO: R.POLO_PASSIVO,
    VINCULOS_QTD_ATIVOS: R.VINCULOS_QTD_ATIVOS, VINCULOS_POLOS: R.VINCULOS_POLOS,
    VINCULOS_DO_CLIENTE: R.VINCULOS_DO_CLIENTE,
  })) {
    assert.ok(tarefas.includes(normalizar(trecho)), nome);
  }
  for (const join of R.JOINS_TAREFA.split('\n').map(l => l.trim()).filter(Boolean)) {
    assert.ok(tarefas.includes(normalizar(join)), join);
  }
  // Os degraus separados usados para informar a origem são as mesmas 4 expressões do COALESCE.
  const degraus = normalizar(R.POLO_DEGRAUS);
  for (const trecho of [
    `NULLIF(TRIM(p.polo_passivo), '')`,
    `CASE WHEN vinc.qtd_vinculos_ativos = 1 THEN vinc.polos_passivos_vinculo[1] END`,
    `NULLIF(TRIM(COALESCE(cl.polo_passivo,tc.polo_passivo,oc.polo_passivo,pc.polo_passivo)), '')`,
    `NULLIF(TRIM(COALESCE(pr.polos_passivos_padrao[1],opr.polos_passivos_padrao[1],ppr.polos_passivos_padrao[1])), '')`,
  ]) {
    assert.ok(degraus.includes(normalizar(trecho)) && normalizar(R.POLO_PASSIVO).includes(normalizar(trecho)), trecho);
  }
});

test('cron: último processo, processo cobrindo, intervalo e responsável iguais aos de ciclosRecorrentes.js', () => {
  assert.ok(cron.includes(normalizar('AND periodo_fim IS NOT NULL ORDER BY periodo_fim DESC LIMIT 1')), 'último processo');
  assert.ok(normalizar(R.ULTIMO_PROCESSO_FILTRO).includes('periodo_fim IS NOT NULL'));
  assert.ok(normalizar(R.ULTIMO_PROCESSO_ORDEM).startsWith(normalizar('ORDER BY px.periodo_fim DESC')));
  assert.ok(cron.includes(normalizar(`AND status NOT IN ('arquivado') AND (periodo_fim IS NULL OR periodo_fim >= $3)`)), 'processo cobrindo (cron)');
  assert.equal(normalizar(R.PROCESSO_COBRINDO), normalizar(`pz.status NOT IN ('arquivado') AND (pz.periodo_fim IS NULL OR pz.periodo_fim >= t.ciclo_inicio)`));
  assert.ok(cron.includes(normalizar('dataReferencia.setUTCMonth(dataReferencia.getUTCMonth() + prod.intervalo_meses - 1)')), 'intervalo');
  assert.ok(cron.includes(normalizar('prod.responsavel_reprotocolo_id || ultimoProcesso.master_responsavel_id || null')), 'responsável');
});

test('janela de 5 anos igual à da referência oficial de Estimativas (60 competências)', () => {
  assert.match(estadual, new RegExp(`const MESES_MAXIMOS = ${R.MESES_JANELA_QUINQUENAL};`));
});
