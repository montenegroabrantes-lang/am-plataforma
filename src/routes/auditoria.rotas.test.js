import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import 'express-async-errors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { authenticator } from 'otplib';
import { definirCarregador, carregadorEcoDoToken } from '../middleware/sessao.js';
definirCarregador(carregadorEcoDoToken); // S-03: nestes testes a conta vale o que o token diz (sem banco)

// S-13 — as ações que estavam sem rastro agora gravam auditoria com o autor: cliente (PATCH e vínculos),
// agenda, publicações, login que falhou, 2FA, troca de senha e configuração de IA. O banco é uma dublê,
// o Calendar/Drive/Digisac nunca são chamados e nenhuma rede é usada.

process.env.JWT_SECRET = 'segredo-de-teste';
process.env.JWT_REFRESH_SECRET = 'segredo-refresh-de-teste';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.SYNC_KEY = 'chave-de-sync-de-teste';

const { db } = await import('../db/index.js');
// Depois do import do banco (o dotenv já rodou): nunca deixar uma credencial real do ambiente chegar ao Calendar.
process.env.GOOGLE_REFRESH_TOKEN = 'configurar_no_railway';

const { clientesRouter } = await import('./clientes.js');
const { agendaRouter } = await import('./agenda.js');
const { publicacoesRouter, importarPublicacoesHandler } = await import('./publicacoes.js');
const { authRouter } = await import('./auth.js');
const { configAiRouter } = await import('./config.ai.js');
const { tratadorGlobalDeErros } = await import('../middleware/erros.js');

const MASTER = { id: '11111111-1111-4111-8111-111111111111', perfil: 'master', pode_marcar_restrito: true, nome: 'Master Teste', email: 'master@exemplo.invalid' };
const CLIENTE = '33333333-3333-4333-8333-333333333333';
const VINCULO = '55555555-5555-4555-8555-555555555555';
const AUDIENCIA = '66666666-6666-4666-8666-666666666666';
const PROCESSO = '77777777-7777-4777-8777-777777777777';
const CREDENCIAL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

let auditoria, execucoes, cliente, vinculo, audienciaAtual, publicacao, tarefaExistente, usuarioLogin, rowCountLida, servidor, base;
const consoleOriginal = { error: console.error, warn: console.warn, log: console.log };

const norm = sql => sql.replace(/\s+/g, ' ').trim();

db.queryOne = async (sql, params) => {
  const s = norm(sql);
  let m;
  if ((m = s.match(/^SELECT (.+) FROM clientes WHERE id = \$1$/))) return Object.fromEntries(m[1].split(', ').map(c => [c, cliente[c] ?? null]));
  if (s.startsWith('SELECT COUNT(*) FROM cliente_vinculos')) return { count: '0' };
  if (s.startsWith('SELECT cargo, orgao, vinculo_inicio, vinculo_fim, polo_passivo, vinculo_ativo FROM cliente_vinculos')) return vinculo;
  if ((m = s.match(/^SELECT (.+) FROM audiencias WHERE id = \$1$/))) return Object.fromEntries(m[1].split(', ').map(c => [c, audienciaAtual[c] ?? null]));
  if (s.startsWith('SELECT google_event_id FROM audiencias')) return { google_event_id: null };
  // S-01 (G1): o setup do 2FA recusa conta que já tem 2FA ativo; aqui ainda não tem.
  if (s.startsWith('SELECT totp_ativo FROM usuarios WHERE id')) return { totp_ativo: false };
  // S-21 (G4): a audiência herda a visibilidade do processo; a rota lê o processo dela antes de editar.
  if (s.startsWith('SELECT processo_id FROM audiencias WHERE id')) return { processo_id: PROCESSO };
  // S-21 (G4): a regra única de visibilidade lê o dono e a visibilidade do processo.
  if (s.startsWith('SELECT master_responsavel_id, compartilhado, visibilidade FROM processos WHERE id')) return { master_responsavel_id: MASTER.id, compartilhado: false, visibilidade: 'normal' };
  if (s.startsWith('SELECT visibilidade FROM processos WHERE id')) return { visibilidade: 'normal' };
  if (s.startsWith('SELECT p.*, c.nome AS cliente_nome FROM processos p')) return { id: PROCESSO, numero: '0001234-56.2021.8.15.0001', tribunal: 'TJPB', vara: '1ª Vara', cliente_nome: 'Cliente Teste' };
  if (s.startsWith('SELECT p.*, pr.numero AS processo_numero')) return publicacao;
  if (s === 'SELECT * FROM tarefas WHERE publicacao_id = $1') return tarefaExistente;
  if (s.startsWith('INSERT INTO tarefas')) return { id: '88888888-8888-4888-8888-888888888888', descricao: 'Prazo da publicação', calendar_event_id: null };
  if (s.startsWith('UPDATE tarefas SET prazo_data')) return { id: tarefaExistente?.id, descricao: 'Prazo', calendar_event_id: null };
  if (s.startsWith('SELECT id, triagem_status FROM publicacoes')) return { id: '555', triagem_status: 'pendente' };
  if (s.startsWith('SELECT * FROM usuarios WHERE email = $1 AND ativo = true')) return usuarioLogin && params[0] === usuarioLogin.email ? usuarioLogin : null;
  if (s === 'SELECT * FROM usuarios WHERE id = $1') return usuarioLogin;
  if (s.startsWith('SELECT id, senha_temporaria FROM usuarios')) return { id: usuarioLogin.id, senha_temporaria: true };
  throw new Error(`queryOne inesperada no teste: ${s.slice(0, 90)}`);
};
db.query = async (sql, params) => {
  const s = norm(sql);
  if (s.startsWith('INSERT INTO cliente_vinculos')) return [{ id: VINCULO, ordem: 1 }];
  if (s.startsWith('INSERT INTO audiencias')) return [{ id: AUDIENCIA, processo_id: params[0] }];
  if (s.startsWith('UPDATE tarefas SET status')) return [];
  if (s.startsWith('SELECT p.id, p.texto')) return []; // reprocessar-prazos: nada a reprocessar
  if (s.startsWith('SELECT chave, valor FROM configuracoes')) return [{ chave: 'claude_modelo', valor: 'claude-sonnet-4-6' }, { chave: 'rota_diagnostico', valor: 'claude' }];
  if (s.startsWith('INSERT INTO configuracoes')) return [];
  if (s.startsWith('SELECT id, REGEXP_REPLACE')) return [];
  if (s.startsWith('INSERT INTO publicacoes')) return [{ inserted: true }];
  if (s.startsWith('INSERT INTO credenciais_tribunal')) return [{ id: CREDENCIAL, tribunal: params[1] }];
  throw new Error(`query inesperada no teste: ${s.slice(0, 90)}`);
};
db.execute = async (sql, params) => {
  const s = norm(sql);
  if (/INSERT INTO logs_auditoria/.test(s)) {
    auditoria.push({ usuarioId: params[0], acao: params[1], entidade: params[2], entidadeId: params[3], antes: params[4] && JSON.parse(params[4]), depois: params[5] && JSON.parse(params[5]), ip: params[6] });
    return { rowCount: 1 };
  }
  execucoes.push({ s, params });
  if (s.startsWith('UPDATE publicacoes SET lido = true')) return { rowCount: rowCountLida, rows: [] };
  if (s.startsWith('DELETE FROM cliente_vinculos')) return vinculo ? { rowCount: 1, rows: [vinculo] } : { rowCount: 0, rows: [] };
  return { rowCount: 1, rows: [] };
};

before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = MASTER; req._ip = '203.0.113.9'; next(); });
  app.use('/api/clientes', clientesRouter);
  app.use('/api/agenda', agendaRouter);
  app.post('/api/publicacoes/importar', importarPublicacoesHandler);
  app.use('/api/publicacoes', publicacoesRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/config/ai', configAiRouter);
  app.use(tratadorGlobalDeErros);
  servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(async () => {
  Object.assign(console, consoleOriginal);
  await new Promise(r => servidor.close(r));
});

beforeEach(() => {
  auditoria = []; execucoes = []; rowCountLida = 1;
  cliente = { nome: 'Maria da Silva', whatsapp: '83999991234', email: 'maria@exemplo.invalid', cargo: 'Professor', ativo: true };
  vinculo = { cargo: 'Professor', orgao: 'Prefeitura A', vinculo_inicio: '2015-01-01', vinculo_fim: null, polo_passivo: 'Município A', vinculo_ativo: true };
  audienciaAtual = { processo_id: PROCESSO, resultado: null, data_hora: new Date('2026-10-15T17:00:00.000Z'), tipo: 'instrução', vara: '1ª Vara' };
  publicacao = { id: '555', processo_id: PROCESSO, numero_processo: '00012345620218150001', data_disponibilizacao: '2026-10-05', processo_numero: '0001234-56.2021.8.15.0001', processo_tribunal: 'TJPB', processo_vara: '1ª Vara', master_responsavel_id: MASTER.id };
  tarefaExistente = null;
  usuarioLogin = null;
  console.error = () => {}; console.warn = () => {}; console.log = () => {};
});

const chamar = async (metodo, caminho, corpo, cabecalhos = {}) => {
  const r = await fetch(`${base}${caminho}`, { method: metodo, headers: { 'content-type': 'application/json', ...cabecalhos }, body: corpo !== undefined ? JSON.stringify(corpo) : undefined });
  return { status: r.status, corpo: await r.json().catch(() => null) };
};
const texto = o => JSON.stringify(o);

// ── clientes ──

test('PATCH de cliente: só o que mudou; WhatsApp e e-mail parciais; anotações só marcadas; autor e IP', async () => {
  const r = await chamar('PATCH', `/api/clientes/${CLIENTE}`, { nome: 'Maria da Silva Souza', whatsapp: '83988885678', email: 'maria@exemplo.invalid', cargo: 'Professor', anotacoes: 'senha do portal: 123456' });
  assert.equal(r.status, 200);
  assert.equal(auditoria.length, 1);
  const [linha] = auditoria;
  assert.equal(linha.usuarioId, MASTER.id);
  assert.equal(linha.acao, 'editar');
  assert.equal(linha.entidade, 'cliente');
  assert.equal(linha.entidadeId, CLIENTE);
  assert.equal(linha.ip, '203.0.113.9');
  assert.deepEqual(linha.antes, { nome: 'Maria da Silva', whatsapp: '***1234' });
  assert.deepEqual(linha.depois, { nome: 'Maria da Silva Souza', whatsapp: '***5678', anotacoes: '[alteradas]' });
  assert.equal(texto(linha).includes('123456'), false, 'a anotação (pode ter senha) não vai para o log');
  assert.equal(texto(linha).includes('83999991234'), false);
  assert.equal(texto(linha).includes('maria@exemplo'), false);
  assert.ok(execucoes.some(e => e.s.startsWith('UPDATE clientes SET')), 'o UPDATE continua acontecendo');
});

test('PATCH de cliente: desativar registra ativo true → false; sem mudança real não grava', async () => {
  await chamar('PATCH', `/api/clientes/${CLIENTE}`, { ativo: false });
  assert.deepEqual([auditoria[0].antes, auditoria[0].depois], [{ ativo: true }, { ativo: false }]);
  auditoria = [];
  await chamar('PATCH', `/api/clientes/${CLIENTE}`, { nome: 'Maria da Silva' });
  assert.equal(auditoria.length, 0);
});

test('vínculos do cliente: criar, editar (só o que mudou) e excluir são auditados com o autor', async () => {
  assert.equal((await chamar('POST', `/api/clientes/${CLIENTE}/vinculos`, { cargo: 'Enfermeira', orgao: 'Hospital B', vinculo_inicio: '2020-02-01' })).status, 201);
  assert.equal((await chamar('PATCH', `/api/clientes/${CLIENTE}/vinculos/${VINCULO}`, { cargo: 'Professor', orgao: 'Prefeitura B', vinculo_inicio: '2015-01-01', polo_passivo: 'Município A', vinculo_ativo: true })).status, 200);
  assert.equal((await chamar('DELETE', `/api/clientes/${CLIENTE}/vinculos/${VINCULO}`)).status, 200);
  assert.deepEqual(auditoria.map(a => a.acao), ['criar_vinculo', 'editar_vinculo', 'excluir_vinculo']);
  assert.ok(auditoria.every(a => a.usuarioId === MASTER.id && a.entidade === 'cliente' && a.entidadeId === CLIENTE));
  assert.equal(auditoria[0].depois.vinculo_id, VINCULO);
  assert.deepEqual(auditoria[1].antes, { vinculo_id: VINCULO, orgao: 'Prefeitura A' });
  assert.deepEqual(auditoria[1].depois, { vinculo_id: VINCULO, orgao: 'Prefeitura B' });
  assert.equal(auditoria[2].antes.orgao, 'Prefeitura A', 'o que foi excluído fica no log');
});

test('vínculo inexistente: 404 e nada gravado', async () => {
  vinculo = null;
  assert.equal((await chamar('DELETE', `/api/clientes/${CLIENTE}/vinculos/${VINCULO}`)).status, 404);
  assert.equal(auditoria.length, 0);
});

// ── agenda ──

test('agenda: cadastrar e editar audiência gravam auditoria; editar registra só o que mudou (data por instante)', async () => {
  const c = await chamar('POST', '/api/agenda', { processo_id: PROCESSO, data_hora: '2026-10-15T14:00:00-03:00', tipo: 'instrução', vara: '1ª Vara' });
  assert.equal(c.status, 201);
  const e = await chamar('PATCH', `/api/agenda/${AUDIENCIA}`, { data_hora: '2026-10-15T14:00:00-03:00', tipo: 'conciliação', resultado: 'realizada' });
  assert.equal(e.status, 200);
  assert.deepEqual(auditoria.map(a => [a.acao, a.entidade]), [['criar', 'audiencia'], ['editar', 'audiencia']]);
  assert.equal(auditoria[0].entidadeId, AUDIENCIA);
  assert.deepEqual(auditoria[1].antes, { resultado: null, tipo: 'instrução' });
  assert.deepEqual(auditoria[1].depois, { resultado: 'realizada', tipo: 'conciliação' });
  assert.equal('data_hora' in auditoria[1].depois, false, 'a mesma data em outro fuso não é mudança');
});

// ── publicações ──

test('confirmar prazo: grava quem confirmou, o prazo anterior e o novo; o id numérico da publicação vai em entidade_ref', async () => {
  tarefaExistente = { id: '99999999-9999-4999-8999-999999999999', prazo_data: '2026-10-12', atribuido_a: MASTER.id, status: 'pendente' };
  const r = await chamar('PATCH', '/api/publicacoes/555/prazo', { prazo_data: '2026-10-20' });
  assert.equal(r.status, 200);
  assert.equal(auditoria.length, 1);
  const [linha] = auditoria;
  assert.equal(linha.acao, 'confirmar_prazo');
  assert.equal(linha.entidade, 'publicacao');
  assert.equal(linha.entidadeId, null);
  assert.equal(linha.depois.entidade_ref, '555');
  assert.equal(linha.usuarioId, MASTER.id);
  assert.deepEqual(linha.antes, { prazo_data: '2026-10-12', atribuido_a: MASTER.id, status: 'pendente' });
  assert.equal(linha.depois.prazo_data, '2026-10-20');
});

test('triagem, marcar como lida e marcar todas como lidas: cada uma deixa uma linha', async () => {
  assert.equal((await chamar('PATCH', '/api/publicacoes/555/triagem', { status: 'sem_prazo' })).status, 200);
  assert.equal((await chamar('PATCH', '/api/publicacoes/555/lida', {})).status, 200);
  rowCountLida = 7;
  assert.equal((await chamar('PATCH', '/api/publicacoes/marcar-todas-lidas', { data: '2026-10-05' })).status, 200);
  assert.deepEqual(auditoria.map(a => a.acao), ['triar_publicacao', 'marcar_publicacao_lida', 'marcar_publicacoes_lidas']);
  assert.deepEqual([auditoria[0].antes, auditoria[0].depois], [{ triagem_status: 'pendente' }, { triagem_status: 'sem_prazo', entidade_ref: '555' }]);
  assert.equal(auditoria[1].depois.entidade_ref, '555');
  assert.deepEqual(auditoria[2].depois, { quantidade: 7, data: '2026-10-05' });
  assert.ok(auditoria.every(a => a.usuarioId === MASTER.id));
});

test('marcar como lida uma publicação que não existe não deixa rastro falso', async () => {
  rowCountLida = 0;
  assert.equal((await chamar('PATCH', '/api/publicacoes/555/lida', {})).status, 200);
  assert.equal(auditoria.length, 0);
});

test('reprocessar prazos e importar pelo navegador: contagens no log, sem o conteúdo das publicações', async () => {
  assert.equal((await chamar('POST', '/api/publicacoes/reprocessar-prazos', {})).status, 200);
  const item = { id: 9001, numero_processo: '', ativo: true, data_disponibilizacao: '2026-10-01', texto: null };
  assert.equal((await chamar('POST', '/api/publicacoes/importar-browser', { items: [item] })).status, 200);
  assert.deepEqual(auditoria.map(a => a.acao), ['reprocessar_prazos_publicacoes', 'importar_publicacoes_navegador']);
  assert.deepEqual(auditoria[0].depois, { criadas: 0, ignoradas: 0, total: 0 });
  assert.equal(auditoria[1].depois.recebidas, 1);
  assert.equal(auditoria[1].depois.inseridas, 1);
});

test('importação automática (SYNC_KEY): registrada como ação do sistema, sem usuário', async () => {
  const item = { id: 9002, numero_processo: '', ativo: true, data_disponibilizacao: '2026-10-01', texto: null };
  const r = await chamar('POST', '/api/publicacoes/importar', { items: [item] }, { 'x-sync-key': process.env.SYNC_KEY });
  assert.equal(r.status, 200);
  assert.equal(auditoria.length, 1);
  assert.equal(auditoria[0].acao, 'importar_publicacoes_sync');
  assert.equal(auditoria[0].usuarioId, null);
  assert.equal(auditoria[0].depois.recebidas, 1);
  // chave errada: 401 e nenhuma linha
  auditoria = [];
  assert.equal((await chamar('POST', '/api/publicacoes/importar', { items: [item] }, { 'x-sync-key': 'errada' })).status, 401);
  assert.equal(auditoria.length, 0);
});

// ── login, 2FA, senha ──

test('login com e-mail inexistente: login_falhou com a origem e o e-mail tentado (minúsculo, sem espaços)', async () => {
  const r = await chamar('POST', '/api/auth/login', { email: '  Alguem@Exemplo.INVALID ', senha: 'qualquer' });
  assert.equal(r.status, 401);
  assert.equal(auditoria.length, 1);
  assert.equal(auditoria[0].acao, 'login_falhou');
  assert.equal(auditoria[0].usuarioId, null);
  assert.deepEqual(auditoria[0].depois, { origem: 'senha', email_tentado: 'alguem@exemplo.invalid' });
  assert.equal(texto(auditoria[0]).includes('qualquer'), false, 'a senha digitada nunca vai para o log');
});

test('login que falha com algo que não é e-mail no campo (ex.: senha digitada no lugar): o texto não vai para o log', async () => {
  const r = await chamar('POST', '/api/auth/login', { email: 'MinhaSenha#Secreta2026', senha: 'x' });
  assert.equal(r.status, 401);
  assert.equal(auditoria[0].acao, 'login_falhou');
  assert.equal(auditoria[0].depois.email_tentado, '[fora do formato de e-mail]');
  assert.equal(texto(auditoria[0]).toLowerCase().includes('secreta'), false);
});

test('login com senha errada de conta existente: a linha aponta para a conta; com 2FA errado, o motivo', async () => {
  usuarioLogin = { id: MASTER.id, nome: 'Master Teste', email: 'master@exemplo.invalid', perfil: 'master', senha_hash: await bcrypt.hash('SenhaCerta#2026', 4), senha_temporaria: false, totp_ativo: false };
  assert.equal((await chamar('POST', '/api/auth/login', { email: 'master@exemplo.invalid', senha: 'errada' })).status, 401);
  assert.equal(auditoria[0].usuarioId, MASTER.id);
  assert.equal(auditoria[0].depois.email_tentado, 'master@exemplo.invalid');

  auditoria = [];
  usuarioLogin = { ...usuarioLogin, totp_ativo: true, totp_secret: authenticator.generateSecret() };
  const r = await chamar('POST', '/api/auth/login', { email: 'master@exemplo.invalid', senha: 'SenhaCerta#2026', totp: '000000' });
  assert.equal(r.status, 401);
  assert.equal(auditoria[0].acao, 'login_falhou');
  assert.deepEqual(auditoria[0].depois, { origem: 'senha', motivo: '2fa_invalido' });
});

test('login que dá certo continua gravando "login" (e o cookie de sessão sai)', async () => {
  usuarioLogin = { id: MASTER.id, nome: 'Master Teste', email: 'master@exemplo.invalid', perfil: 'master', senha_hash: await bcrypt.hash('SenhaCerta#2026', 4), senha_temporaria: false, totp_ativo: false };
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'master@exemplo.invalid', senha: 'SenhaCerta#2026' }) });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie') || '', /am_token=/);
  assert.equal(auditoria[0].acao, 'login');
});

test('2FA: configurar e ativar são auditados, sem o segredo nem os códigos de recuperação', async () => {
  const bearer = { authorization: `Bearer ${jwt.sign({ id: MASTER.id, perfil: 'master', email: 'master@exemplo.invalid' }, process.env.JWT_SECRET, { expiresIn: '1h' })}` };
  // S-01: a rota que grava o segredo do 2FA agora é POST (o GET ficou só como ponte para o frontend antigo).
  const setup = await chamar('POST', '/api/auth/2fa/setup', {}, bearer);
  assert.equal(setup.status, 200);
  const segredo = setup.corpo.secret;
  usuarioLogin = { id: MASTER.id, totp_secret: segredo };
  const ativar = await chamar('POST', '/api/auth/2fa/ativar', { totp: authenticator.generate(segredo) }, bearer);
  assert.equal(ativar.status, 200);
  assert.deepEqual(auditoria.map(a => a.acao), ['configurar_2fa', 'ativar_2fa']);
  assert.ok(auditoria.every(a => a.usuarioId === MASTER.id));
  const tudo = texto(auditoria);
  assert.equal(tudo.includes(segredo), false);
  for (const codigo of ativar.corpo.codigos_recuperacao) assert.equal(tudo.includes(codigo), false);
});

// (troca de senha no primeiro acesso: fluxo refeito no S-04 — token de primeiro acesso + senha provisória, ação 'primeiro_acesso_senha' —;
//  a auditoria sem a senha é provada em src/routes/auth.test.js)

// ── IA ──

test('configuração de IA: grava só o que mudou, com o autor', async () => {
  const r = await chamar('POST', '/api/config/ai', { roteamento: { diagnostico: 'claude', peticao: 'openai' }, modelos: { claude: 'claude-sonnet-4-6', openai: 'gpt-4o' } });
  assert.equal(r.status, 200);
  const linha = auditoria.find(a => a.acao === 'alterar_config_ia');
  assert.ok(linha);
  assert.equal(linha.usuarioId, MASTER.id);
  // rota_diagnostico=claude e claude_modelo=claude-sonnet-4-6 já estavam assim: só mudam peticao, classificacao e o modelo openai
  assert.deepEqual(Object.keys(linha.depois).sort(), ['openai_modelo_texto', 'rota_classificacao', 'rota_peticao']);
  assert.equal('rota_diagnostico' in linha.depois, false);
});

// (a rota /api/credenciais foi removida no S-10 — o PJe passa por sessão própria do advogado —, então não há mais auditoria dela)
