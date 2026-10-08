import test from 'node:test';
import assert from 'node:assert/strict';
import {
  criarPastaDoCliente, moverParaOutorgantesSeConcluido, detectarProtocolosNoDrive, relatorioConciliacao, vincularPasta,
} from './conciliacao.js';

const ENV = { GOOGLE_DRIVE_PASTA_PENDENTES: 'PEND', GOOGLE_DRIVE_PASTA_OUTORGANTES: 'OUT26' };

function driveFalso({ subpastas = {}, arquivos = {}, dados = {} } = {}) {
  const chamadas = [];
  return {
    chamadas,
    async criarPasta(nome, pai) { chamadas.push(['criarPasta', nome, pai]); return { id: 'nova', url: 'u-nova' }; },
    async criarPastaCliente(cpf, nome) { chamadas.push(['criarPastaCliente', cpf, nome]); return { id: 'leg', url: 'u-leg' }; },
    async criarSubpasta(pai, nome) { chamadas.push(['criarSubpasta', pai, nome]); return { id: 's' }; },
    async listarSubpastas(pai) { return subpastas[pai] || []; },
    async listarArquivos(pai) { return arquivos[pai] || []; },
    async baixarArquivo(id) { return Buffer.from(id); },
    async dadosDaPasta(id) { if (!dados[id]) throw new Error('404'); return dados[id]; },
    async moverPasta(id, de, para) { chamadas.push(['mover', id, de, para]); },
  };
}

test('criarPastaDoCliente: com Pendentes configurada cria "NOME x ENTE" sem subpastas; sem ela, formato antigo', async () => {
  const d1 = driveFalso();
  await criarPastaDoCliente({ id: 'c', nome: 'Franklin Herik', cpf: '1', polo_passivo: 'Estado da Paraíba' }, { drive: d1, env: ENV });
  assert.deepEqual(d1.chamadas, [['criarPasta', 'FRANKLIN HERIK x PB', 'PEND']]);
  const d2 = driveFalso();
  await criarPastaDoCliente({ id: 'c', nome: 'Franklin', cpf: '1' }, { drive: d2, env: {} });
  assert.equal(d2.chamadas[0][0], 'criarPastaCliente');
  assert.equal(d2.chamadas.filter(c => c[0] === 'criarSubpasta').length, 5);
});

function dbFalso({ aberta = null, cliente = { id: 'c', drive_pasta_id: 'P1' }, tarefas = [], clientes = [], processos = [] } = {}) {
  const updates = [];
  return {
    updates,
    async queryOne(sql) {
      if (sql.includes('SELECT 1 FROM tarefas')) return aberta;
      if (sql.includes('FROM clientes')) return cliente;
      return null;
    },
    async query(sql, params) {
      if (sql.includes("t.tipo = 'protocolar'")) return tarefas;
      if (sql.includes('FROM processos')) return processos.map(numero => ({ numero }));
      if (sql.includes('UPDATE tarefas')) { updates.push(params); return [{ id: params[0] }]; }
      if (sql.includes('FROM clientes')) return clientes;
      return [];
    },
    async execute(sql, params) { updates.push(['execute', ...params]); },
  };
}

test('moverParaOutorgantesSeConcluido: move só sem protocolo aberto e com a pasta em Pendentes', async () => {
  const drive = driveFalso({ dados: { P1: { id: 'P1', nome: 'FULANO x PB', pais: ['PEND'] } } });
  const auditar = async () => {};
  let r = await moverParaOutorgantesSeConcluido('c', { db: dbFalso({ aberta: { '?column?': 1 } }), drive, auditar, env: ENV });
  assert.equal(r.motivo, 'ainda_ha_protocolo_aberto');
  r = await moverParaOutorgantesSeConcluido('c', { db: dbFalso(), drive, auditar, env: ENV });
  assert.equal(r.movida, true);
  assert.deepEqual(drive.chamadas.at(-1), ['mover', 'P1', 'PEND', 'OUT26']);
  const fora = driveFalso({ dados: { P1: { id: 'P1', nome: 'X', pais: ['RAIZ'] } } });
  r = await moverParaOutorgantesSeConcluido('c', { db: dbFalso(), drive: fora, auditar, env: ENV });
  assert.equal(r.motivo, 'pasta_fora_de_pendentes');
  r = await moverParaOutorgantesSeConcluido('c', { db: dbFalso(), drive, auditar, env: {} });
  assert.equal(r.motivo, 'pastas_nao_configuradas');
});

const TAREFA = (over = {}) => ({ tarefa_id: 't1', cliente_id: 'c1', cliente_nome: 'Ismania Ferreira De Oliveira Vitorino', drive_pasta_id: null, produto_nome: 'FGTS', ...over });

test('detectarProtocolosNoDrive: pasta em Outorgantes com tarefa aberta é marcada, com o CNJ do comprovante', async () => {
  const drive = driveFalso({
    subpastas: { OUT26: [{ id: 'PI', nome: 'ISMANIA FERREIRA DE OLIVEIRA VITORINO x PB', url: 'u-pi' }, { id: 'PV', nome: 'VERA LUCIA X PMJP' }] },
    arquivos: { PI: [{ id: 'comp', nome: 'Comprovante PROTOCOLO FGTS - ISMANIA.pdf' }, { id: 'proc', nome: 'PROCURACAO.pdf' }] },
  });
  const db = dbFalso({ tarefas: [TAREFA()] });
  const extrairTexto = async () => 'Processo nº 0812345-67.2026.8.15.2001 distribuído';
  const r = await detectarProtocolosNoDrive({ db, drive, extrairTexto, env: ENV });
  assert.equal(r.marcadas, 1);
  assert.deepEqual(db.updates[0], ['t1', 'PI', 'u-pi', JSON.stringify(['0812345-67.2026.8.15.2001'])]);
});

test('detectarProtocolosNoDrive: número já cadastrado não vira sugestão; tarefa já marcada com número não é relida', async () => {
  const drive = driveFalso({
    subpastas: { OUT26: [{ id: 'PI', nome: 'ISMANIA FERREIRA DE OLIVEIRA VITORINO x PB' }] },
    arquivos: { PI: [{ id: 'comp', nome: 'comprovante protocolo.pdf' }] },
  });
  const extrairTexto = async () => '0812345-67.2026.8.15.2001';
  const db = dbFalso({ tarefas: [TAREFA()], processos: ['0812345-67.2026.8.15.2001'] });
  await detectarProtocolosNoDrive({ db, drive, extrairTexto, env: ENV });
  assert.equal(db.updates[0][3], '[]');
  const db2 = dbFalso({ tarefas: [TAREFA({ drive_protocolo_detectado_em: new Date(), drive_protocolo_pasta_id: 'PI', drive_numeros_encontrados: ['0812345-67.2026.8.15.2001'] })] });
  const r = await detectarProtocolosNoDrive({ db: db2, drive, extrairTexto, env: ENV });
  assert.equal(r.marcadas, 0);
  assert.equal(db2.updates.length, 0);
});

test('relatorioConciliacao: vincular, sem cliente, protocolado fora e sem pasta', async () => {
  const drive = driveFalso({ subpastas: { PEND: [
    { id: 'PF', nome: 'FRANKLIN HERIK SOARES DE MATO LOURENCO x PB' },
    { id: 'PV', nome: 'VERA LUCIA VITORINO X PMJP' },
  ] } });
  const db = dbFalso({
    tarefas: [
      TAREFA({ tarefa_id: 'tf', cliente_id: 'cf', cliente_nome: 'FRANKLIN HERIK SOARES DE MATOS LOURENCO', drive_pasta_id: 'P-SISTEMA' }),
      TAREFA({ tarefa_id: 'ti', cliente_id: 'ci', drive_protocolo_detectado_em: new Date(), drive_protocolo_pasta_id: 'PI', drive_numeros_encontrados: [] }),
      TAREFA({ tarefa_id: 'tj', cliente_id: 'cj', cliente_nome: 'JOAO SEM PASTA' }),
    ],
    clientes: [
      { id: 'cf', nome: 'FRANKLIN HERIK SOARES DE MATOS LOURENCO', drive_pasta_id: 'P-SISTEMA' },
      { id: 'ci', nome: 'Ismania Ferreira De Oliveira Vitorino', drive_pasta_id: null },
      { id: 'cj', nome: 'JOAO SEM PASTA', drive_pasta_id: null },
    ],
  });
  const r = await relatorioConciliacao({ db, drive, env: ENV });
  assert.deepEqual(r.vincular.map(x => [x.pasta.id, x.cliente.id]), [['PF', 'cf']]);
  assert.deepEqual(r.sem_cliente.map(x => x.pasta.id), ['PV']);
  assert.deepEqual(r.protocolado_fora.map(x => x.tarefa_id), ['ti']);
  assert.deepEqual(r.sem_pasta.map(x => x.cliente.id), ['cj']);
});

test('vincularPasta: só aceita pasta em Pendentes/Outorgantes e grava no cliente', async () => {
  const drive = driveFalso({ dados: {
    PF: { id: 'PF', nome: 'FRANKLIN x PB', pais: ['PEND'], url: 'u-pf', apagada: false },
    PX: { id: 'PX', nome: 'outra', pais: ['RAIZ'], url: 'u-px', apagada: false },
  } });
  const db = dbFalso({ cliente: { drive_pasta_id: 'P-SISTEMA', drive_pasta_url: 'u' } });
  const auditorias = [];
  await vincularPasta('cf', 'PF', { db, drive, auditar: async a => auditorias.push(a), env: ENV });
  assert.deepEqual(db.updates[0], ['execute', 'PF', 'u-pf', 'cf']);
  assert.equal(auditorias[0].acao, 'vincular_pasta_drive');
  await assert.rejects(() => vincularPasta('cf', 'PX', { db, drive, auditar: async () => {}, env: ENV }), /Pendentes a protocolar ou em Outorgantes/);
});
