import { db } from '../db/index.js';

// S-27 (D6): o perfil júnior enxerga e altera bem menos que o Master. Tudo que decide
// "é Master ou não" passa por aqui, para a regra ficar num lugar só e falhar fechada:
// qualquer perfil que não seja exatamente 'master' é tratado como júnior.
//
// Matriz aplicada (recomendação do plano, decisão D6 ainda não respondida pelo usuário):
//   - CPF do cliente sempre mascarado (***.456.789-**), na resposta e na busca;
//   - sem anotações do cliente (leitura e escrita), sem o campo `ativo` do cliente;
//   - CSV de processos sem a coluna CPF;
//   - sem valor da causa, valor da RPV, status do processo e valor homologado;
//   - urgência e edição de processo só onde o júnior tem tarefa atribuída (IDOR de 11/07);
//   - sem conversas de lead do Digisac.

export const ehMaster = (req) => req.user?.perfil === 'master';

export const MSG_SO_RESPONSAVEL = 'Você só pode alterar processos em que tem tarefa atribuída.';
export const MSG_CAMPOS_DO_PROCESSO = 'Apenas Masters alteram o valor da causa, o valor da RPV e o status do processo.';
export const MSG_VALORES_DO_PROCESSO = 'Apenas Masters alteram o valor da estimativa e o valor passado ao cliente.';
export const MSG_VALOR_HOMOLOGADO = 'Apenas Masters alteram o valor homologado da RPV/precatório.';
export const MSG_CAMPOS_DO_CLIENTE = 'Apenas Masters alteram as anotações e a situação (ativo) do cliente.';

// ── CPF mascarado ────────────────────────────────────────────────────────────

// Mesma máscara que a tela de Tarefas já usa (cpfProtegido): primeiros 3 e últimos 2 dígitos
// escondidos. Devolve o próprio valor quando está vazio ou já mascarado (idempotente).
export function mascararCpf(valor) {
  if (valor === null || valor === undefined) return valor;
  const texto = String(valor);
  if (!texto.trim() || texto.includes('*')) return valor;
  const digitos = texto.replace(/\D/g, '');
  if (digitos.length !== 11) return '***';
  return `***.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-**`;
}

// Chaves de JSON que carregam o CPF de um cliente: `cpf`, `cliente_cpf`, `clienteCpf`...
const CHAVE_CPF = /(^|_)cpf$|Cpf$/;

const ehObjetoSimples = (v) => Object.prototype.toString.call(v) === '[object Object]';

export function mascararCpfNoCorpo(valor) {
  if (Array.isArray(valor)) return valor.map(mascararCpfNoCorpo);
  if (!ehObjetoSimples(valor)) return valor; // Date, Buffer, null, texto, número...
  const saida = {};
  for (const [chave, v] of Object.entries(valor)) {
    saida[chave] = CHAVE_CPF.test(chave) && (typeof v === 'string' || typeof v === 'number')
      ? mascararCpf(v)
      : mascararCpfNoCorpo(v);
  }
  return saida;
}

// `router.use(protegerDadosDoJunior)` no topo dos routers que devolvem CPF de cliente
// (clientes, processos, tarefas, triagem). Para o Master não faz nada. Para o júnior,
// embrulha res.json e mascara qualquer `cpf`/`cliente_cpf` da resposta: novas rotas desses
// routers já nascem protegidas. CSV e texto (res.send) são tratados na própria rota.
export function protegerDadosDoJunior(req, res, next) {
  if (ehMaster(req)) return next();
  const jsonOriginal = res.json.bind(res);
  res.json = (corpo) => jsonOriginal(mascararCpfNoCorpo(corpo));
  next();
}

// ── Busca por CPF ────────────────────────────────────────────────────────────

// Devolve o trecho `OR ...` da busca por CPF (e empilha o parâmetro). Master: igual ao que
// sempre foi (6 dígitos ou mais, em qualquer posição). Júnior: só o CPF inteiro (11 dígitos,
// igualdade). Sem isso, a busca parcial viraria um oráculo para reconstruir o CPF que a
// máscara esconde, tentando trechos de 6 dígitos.
export function condicaoBuscaCpf(req, soDigitos, params, coluna = 'c.cpf') {
  if (ehMaster(req)) {
    if (soDigitos.length < 6) return '';
    params.push(`%${soDigitos}%`);
    return ` OR REGEXP_REPLACE(${coluna},'[^0-9]','','g') ILIKE $${params.length}`;
  }
  if (soDigitos.length !== 11) return '';
  params.push(soDigitos);
  return ` OR REGEXP_REPLACE(${coluna},'[^0-9]','','g') = $${params.length}`;
}

// ── Processos: só onde o júnior tem tarefa atribuída ─────────────────────────

// "Tem tarefa atribuída" = qualquer tarefa do processo em nome dele que não foi cancelada
// (concluída conta: quem registrou o protocolo continua responsável pelo processo).
export async function temTarefaNoProcesso(usuarioId, processoId, conexao = db) {
  if (!usuarioId || !processoId) return false;
  const linha = await conexao.queryOne(
    `SELECT 1 AS ok FROM tarefas
      WHERE processo_id = $1 AND atribuido_a = $2 AND status <> 'cancelada'
      LIMIT 1`,
    [processoId, usuarioId]
  );
  return !!linha;
}

// Dos ids da página, os que o júnior pode editar. Master: null (= todos).
export async function idsProcessosEditaveis(req, ids, conexao = db) {
  if (ehMaster(req)) return null;
  if (!ids.length || !req.user?.id) return new Set();
  const linhas = await conexao.query(
    `SELECT DISTINCT processo_id FROM tarefas
      WHERE atribuido_a = $1 AND status <> 'cancelada' AND processo_id = ANY($2)`,
    [req.user.id, ids]
  );
  return new Set(linhas.map(l => l.processo_id));
}

// Compara o valor enviado com o gravado. Número: 1000, "1000.0" e "1000.00" são o mesmo valor;
// vazio e null também. Qualquer coisa que não vire número (ex.: "1.234,50") conta como mudança.
function mesmoValor(campo, enviado, atual) {
  if (campo === 'status') return String(enviado ?? '') === String(atual ?? '');
  const numero = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
  const a = numero(enviado);
  const b = numero(atual);
  if (a === null || b === null) return a === b;
  return Number.isFinite(a) && Number.isFinite(b) && a === b;
}

// Aplica a regra "campo só do Master" ao corpo do PATCH: reenviar o valor que já está gravado
// não é alteração (o formulário antigo manda `status` sempre) e o campo sai do corpo; valor
// diferente barra com 403. Devolve a mensagem de erro ou null.
async function conferirCamposSoMaster(req, processoId, campos, mensagem, conexao) {
  const enviados = campos.filter(c => req.body?.[c] !== undefined);
  if (!enviados.length) return null;
  const atual = await conexao.queryOne(
    `SELECT ${campos.join(', ')} FROM processos WHERE id = $1`,
    [processoId]
  );
  for (const campo of enviados) {
    if (!mesmoValor(campo, req.body[campo], atual?.[campo])) return mensagem;
    delete req.body[campo];
  }
  return null;
}

// PATCH /api/processos/:id — júnior só em processo com tarefa dele, e sem mexer em
// valor da causa, valor da RPV e status. Devolve true quando o handler pode seguir;
// caso contrário já respondeu 403.
export async function liberarEdicaoDoJunior(req, res, processoId, conexao = db) {
  if (ehMaster(req)) return true;
  if (!(await temTarefaNoProcesso(req.user?.id, processoId, conexao))) {
    res.status(403).json({ ok: false, erro: MSG_SO_RESPONSAVEL });
    return false;
  }
  // Valor da estimativa e valor passado ao cliente: só o Master, sem comparar com o gravado.
  if (['valor_estimativa', 'valor_proposta'].some(c => req.body?.[c] !== undefined)) {
    res.status(403).json({ ok: false, erro: MSG_VALORES_DO_PROCESSO });
    return false;
  }
  const erro = await conferirCamposSoMaster(req, processoId, ['status', 'valor_causa', 'valor_rpv'], MSG_CAMPOS_DO_PROCESSO, conexao);
  if (erro) {
    res.status(403).json({ ok: false, erro });
    return false;
  }
  return true;
}

// PATCH /api/processos/:id/situacao — a classificação do dia a dia segue aberta ao júnior,
// mas não o valor homologado (alimenta o Financeiro) e a urgência só com tarefa dele.
export async function liberarClassificacaoDoJunior(req, res, processoId, conexao = db) {
  if (ehMaster(req)) return true;
  const erroValor = await conferirCamposSoMaster(req, processoId, ['valor_homologado'], MSG_VALOR_HOMOLOGADO, conexao);
  if (erroValor) {
    res.status(403).json({ ok: false, erro: erroValor });
    return false;
  }
  if (req.body?.urgente !== undefined) {
    const atual = await conexao.queryOne('SELECT urgente FROM processos WHERE id = $1', [processoId]);
    // Só um booleano idêntico ao gravado conta como "sem mudança": a rota grava o valor cru e o
    // Postgres lê 'false', 'f', '0', 'no' e 'off' como falso, então "false" (texto) passaria por
    // `!!` como verdadeiro e desmarcaria a urgência de um processo que não é do júnior.
    const mudou = typeof req.body.urgente !== 'boolean' || req.body.urgente !== !!atual?.urgente;
    if (mudou && !(await temTarefaNoProcesso(req.user?.id, processoId, conexao))) {
      res.status(403).json({ ok: false, erro: MSG_SO_RESPONSAVEL });
      return false;
    }
  }
  return true;
}
