import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

// JN-09 / JL-08 — conclusão do cadastro com a data "AAAA-MM" que a Camila entrega no rascunho.
// Antes: o texto ia direto para a coluna DATE, o Postgres recusava (22007) e a rota devolvia 500
// com a mensagem crua do banco, sem deixar rastro. Agora: 400 claro, banco intocado, tentativa auditada.

const { db } = await import('../db/index.js');
// Guarda: nada aqui pode tocar o banco real.
for (const metodo of ['query', 'queryOne']) {
  db[metodo] = async () => { throw new Error('banco real proibido nos testes'); };
}

const { onboardingsRouter } = await import('./onboardings.js');

const ONB = '33333333-3333-4333-8333-333333333333';
const USUARIO = { id: '44444444-4444-4444-8444-444444444444', perfil: 'master' };
const CPF_DE_TESTE = '52998224725';

// Reproduz o que o Postgres faz com uma coluna DATE: só aceita dia de calendário completo.
function comoPostgresDate(valor) {
  if (valor === null || valor === undefined) return;
  const texto = String(valor);
  const [ano, mes, dia] = texto.split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(texto) && d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
  if (!ok) {
    const erro = new Error(`invalid input syntax for type date: "${texto}"`);
    erro.code = '22007';
    throw erro;
  }
}

let conexoes;       // quantas vezes o pool foi acionado
let consultas;      // SQL recebido pelo cliente falso
let auditoria;      // INSERTs em logs_auditoria
let onboardingNoBanco;
let falharNaGravacao; // simula erro do banco depois da validação

function clienteFalso() {
  return {
    release() {},
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, ' ').trim();
      consultas.push({ sql: s, params });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(s)) return { rows: [] };
      if (s.startsWith('SELECT * FROM onboardings_contrato')) return { rows: [onboardingNoBanco] };
      if (s.startsWith('SELECT * FROM clientes WHERE cpf')) return { rows: [] };
      if (s.startsWith('INSERT INTO clientes')) {
        if (falharNaGravacao) throw falharNaGravacao;
        comoPostgresDate(params[6]); comoPostgresDate(params[7]);
        // drive_pasta_id e digisac_contact_id preenchidos: os disparos em segundo plano não saem do teste.
        return { rows: [{ id: 'cliente-1', nome: params[0], whatsapp: null, drive_pasta_id: 'pasta-teste', digisac_contact_id: 'contato-teste' }] };
      }
      if (s.startsWith('SELECT COUNT(*)')) return { rows: [{ total: 0 }] };
      if (s.startsWith('INSERT INTO cliente_vinculos')) { comoPostgresDate(params[4]); comoPostgresDate(params[5]); return { rows: [] }; }
      if (s.startsWith('SELECT op.*')) return { rows: [] };
      if (s.startsWith('UPDATE tarefas') || s.startsWith('UPDATE onboardings_contrato')) return { rows: [] };
      throw new Error(`consulta inesperada no teste: ${s.slice(0, 70)}`);
    },
  };
}

db.pool.connect = async () => { conexoes++; return clienteFalso(); };
db.execute = async (sql, params = []) => {
  if (sql.includes('logs_auditoria')) auditoria.push({ acao: params[1], entidadeId: params[3], depois: params[5] ? JSON.parse(params[5]) : null, usuarioId: params[0] });
  return { rows: [] };
};

const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = USUARIO; req._ip = '127.0.0.1'; next(); });
app.use('/api/onboardings', onboardingsRouter);
const servidor = app.listen(0);
const base = `http://127.0.0.1:${servidor.address().port}`;
after(() => servidor.close());

beforeEach(() => {
  conexoes = 0; consultas = []; auditoria = []; falharNaGravacao = null;
  // Cadastro parado típico: veio da calculadora (dados_origem), responsável é o usuário do teste.
  onboardingNoBanco = {
    id: ONB, status: 'cadastro_pendente', cliente_id: null, responsavel_cadastro_id: USUARIO.id,
    responsavel_protocolo_id: USUARIO.id, prazo_protocolo: '2026-10-05',
    dados_origem: { nome: 'calculadora', vinculo_inicio: 'calculadora', vinculo_fim: 'calculadora' },
  };
});

async function concluir(vinculos, extra = {}) {
  const r = await fetch(`${base}/api/onboardings/${ONB}/concluir-cadastro`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nome: 'Maria de Teste', cpf: CPF_DE_TESTE, whatsapp: '', email: '',
      lgpd_consentimento: true, dados_calculadora_confirmados: true, vinculos, ...extra,
    }),
  });
  return { status: r.status, corpo: await r.json() };
}

const insertsDeCliente = () => consultas.filter(c => c.sql.startsWith('INSERT INTO clientes'));

test('o banco de verdade recusa "AAAA-MM" numa coluna DATE (é isso que virava 500)', () => {
  assert.throws(() => comoPostgresDate('2021-03'), err => err.code === '22007' && /invalid input syntax for type date/.test(err.message));
  assert.doesNotThrow(() => comoPostgresDate('2021-03-15'));
});

test('rascunho da Camila (início e fim em AAAA-MM) → 400 claro em português, sem tocar o banco', async () => {
  const { status, corpo } = await concluir([{ cargo: 'Professor', orgao: 'Prefeitura', vinculo_inicio: '2021-03', vinculo_fim: '2024-05', polo_passivo: 'Município', vinculo_ativo: true }]);
  assert.equal(status, 400);
  assert.equal(corpo.ok, false);
  assert.match(corpo.erro, /início do vínculo 1, fim do vínculo 1/);
  assert.match(corpo.erro, /dia, mês e ano/);
  assert.doesNotMatch(corpo.erro, /invalid input|22007|postgres/i);
  assert.equal(conexoes, 0, 'validou antes de abrir conexão com o banco');
});

test('só o fim em AAAA-MM (vínculo atual que veio da calculadora) → 400 citando só o fim', async () => {
  const { status, corpo } = await concluir([{ cargo: 'Enfermeira', vinculo_inicio: '2019-08-01', vinculo_fim: '2026-09' }]);
  assert.equal(status, 400);
  assert.match(corpo.erro, /fim do vínculo 1/);
  assert.doesNotMatch(corpo.erro, /início/);
});

test('2º vínculo com data ruim também é recusado', async () => {
  const { status, corpo } = await concluir([
    { cargo: 'Professor', vinculo_inicio: '2015-02-10', vinculo_fim: '' },
    { cargo: 'Professor', vinculo_inicio: '2018-04', vinculo_fim: '' },
  ]);
  assert.equal(status, 400);
  assert.match(corpo.erro, /início do vínculo 2/);
  assert.equal(conexoes, 0);
});

test('data impossível (30/02) e texto solto → 400, nunca 500', async () => {
  for (const ruim of ['2021-02-30', 'março de 2021', '15/03/2021']) {
    const { status, corpo } = await concluir([{ cargo: 'Professor', vinculo_inicio: ruim }]);
    assert.equal(status, 400, `esperava 400 para ${ruim}`);
    assert.match(corpo.erro, /início do vínculo 1/);
  }
  assert.equal(conexoes, 0);
});

test('datas completas → 200, cliente criado e as datas chegam ao banco exatamente como digitadas', async () => {
  const { status, corpo } = await concluir([{ cargo: 'Professor', orgao: 'Prefeitura', vinculo_inicio: '2021-03-15', vinculo_fim: '2024-05-31', polo_passivo: 'Município', vinculo_ativo: true }]);
  assert.equal(status, 200);
  assert.equal(corpo.ok, true);
  assert.equal(corpo.criou_cliente, true);
  const [insert] = insertsDeCliente();
  assert.equal(insert.params[6], '2021-03-15');
  assert.equal(insert.params[7], '2024-05-31');
  const vinculo = consultas.find(c => c.sql.startsWith('INSERT INTO cliente_vinculos'));
  assert.equal(vinculo.params[4], '2021-03-15');
  assert.equal(vinculo.params[5], '2024-05-31');
  assert.ok(auditoria.some(a => a.acao === 'concluir_cadastro'));
  assert.ok(!auditoria.some(a => a.acao === 'concluir_cadastro_falhou'), 'sucesso não gera registro de falha');
});

test('vínculo atual (fim em branco) e datas em branco continuam valendo → 200 com NULL', async () => {
  const { status } = await concluir([{ cargo: 'Professor', orgao: 'Prefeitura', vinculo_inicio: '2021-03-15', vinculo_fim: '', vinculo_ativo: true }]);
  assert.equal(status, 200);
  assert.equal(insertsDeCliente()[0].params[7], null);
  const semDatas = await concluir([{ cargo: 'Professor', vinculo_inicio: '', vinculo_fim: '' }]);
  assert.equal(semDatas.status, 200);
});

test('a tentativa que falhou é auditada com id do onboarding e motivo, sem dado pessoal', async () => {
  await concluir([{ cargo: 'Professor', orgao: 'Prefeitura', vinculo_inicio: '2021-03', vinculo_fim: '', polo_passivo: 'Município de Teste' }]);
  assert.equal(auditoria.length, 1);
  const [registro] = auditoria;
  assert.equal(registro.acao, 'concluir_cadastro_falhou');
  assert.equal(registro.entidadeId, ONB);
  assert.equal(registro.usuarioId, USUARIO.id);
  assert.equal(registro.depois.status, 400);
  assert.match(registro.depois.motivo, /início do vínculo 1/);
  assert.deepEqual(registro.depois.campos, [{ campo: 'vinculo_1_inicio', formato: 'AAAA-MM' }]);
  const texto = JSON.stringify(registro);
  for (const pessoal of ['Maria de Teste', CPF_DE_TESTE, 'Professor', 'Prefeitura', 'Município de Teste', '2021']) {
    assert.ok(!texto.includes(pessoal), `a auditoria não pode conter "${pessoal}"`);
  }
});

test('outras falhas de validação também ficam registradas (CPF inválido, LGPD sem marcar)', async () => {
  const cpfRuim = await concluir([], { cpf: '111.111.111-11' });
  assert.equal(cpfRuim.status, 400);
  const semLgpd = await concluir([], { lgpd_consentimento: false });
  assert.equal(semLgpd.status, 400);
  assert.deepEqual(auditoria.map(a => a.acao), ['concluir_cadastro_falhou', 'concluir_cadastro_falhou']);
  assert.deepEqual(auditoria.map(a => a.depois.motivo), ['CPF inválido.', 'É necessário registrar o consentimento LGPD.']);
  assert.ok(!JSON.stringify(auditoria).includes(CPF_DE_TESTE));
});

test('rede de segurança: se o banco ainda recusar a data (22007), a resposta é 400, não 500', async () => {
  const erroDoBanco = new Error('invalid input syntax for type date: "2021-03-15"');
  erroDoBanco.code = '22007';
  falharNaGravacao = erroDoBanco; // simula uma data que passasse pela validação e o banco recusasse
  const { status, corpo } = await concluir([{ cargo: 'Professor', vinculo_inicio: '2021-03-15' }]);
  assert.equal(status, 400);
  assert.match(corpo.erro, /datas do vínculo é inválida/);
  assert.doesNotMatch(corpo.erro, /invalid input/);
  assert.equal(auditoria[0].acao, 'concluir_cadastro_falhou');
  assert.equal(auditoria[0].depois.status, 400);
});

test('erro inesperado continua 500, mas a auditoria guarda só o código (a mensagem do banco pode repetir dado digitado)', async () => {
  const erroDoBanco = new Error('duplicate key value: Key (cpf)=(52998224725) already exists');
  erroDoBanco.code = '23505';
  falharNaGravacao = erroDoBanco;
  const mudo = console.error; const linhas = [];
  console.error = (...a) => linhas.push(a.join(' '));
  let resposta;
  try { resposta = await concluir([{ cargo: 'Professor', vinculo_inicio: '2021-03-15' }]); } finally { console.error = mudo; }
  assert.equal(resposta.status, 500);
  assert.equal(auditoria.length, 1);
  assert.deepEqual(auditoria[0].depois, { status: 500, motivo: 'erro_interno', codigo: '23505' });
  assert.ok(!JSON.stringify(auditoria).includes(CPF_DE_TESTE));
  assert.ok(linhas.some(l => l.includes('[Onboarding]') && l.includes(ONB) && l.includes('23505')));
  assert.ok(!linhas.join('\n').includes(CPF_DE_TESTE), 'o log do servidor também não leva o CPF');
});
