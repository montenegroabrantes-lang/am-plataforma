// Consulta processual automática pela Camila (11/11/2026, regras definidas pelo usuário).
//
// O AM entrega à Camila um texto pronto, montado SEM IA, a partir dos andamentos do processo:
// - o polo passivo é sempre "a Fazenda Pública" (nunca o nome do Município/Estado);
// - com vários processos, informa só o mais antigo ativo, salvo quando o cliente indica o número;
// - nunca informa valores;
// - sentença procedente (inclusive em parte) pode ser informada; improcedência, extinção,
//   resultado de recurso, pagamento (RPV, precatório, alvará) e arquivamento vão para a
//   equipe jurídica (encaminhar=true, sem texto ao cliente).
import { db } from '../db/index.js';
import { normalizarNomeCliente, variantesTelefoneCliente } from './clienteCamila.js';

const ORDEM = ['inicial', 'citacao', 'instrucao', 'concluso_sentenca', 'sentenca', 'recurso', 'transito', 'cumprimento'];
const rank = fase => ORDEM.indexOf(fase);

const sem = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Situação cadastrada à mão no AM → fase (para processos com poucos andamentos importados).
const FASE_POR_SITUACAO = {
  em_conhecimento: 'inicial', aguardando_contestacao: 'citacao', citacao: 'citacao',
  contestacao_apresentada: 'instrucao', impugnacao_contestacao: 'instrucao', impugnada_contestacao: 'instrucao', manifestacao_provas: 'instrucao',
  concluso_para_sentenca: 'concluso_sentenca', concluso_sentenca: 'concluso_sentenca',
  em_recurso: 'recurso', em_segundo_grau: 'recurso',
  cumprimento_sentenca: 'cumprimento', calculos_apresentados: 'cumprimento', impugnado_cumprimento: 'cumprimento',
  fazenda_intimada_impugnar: 'cumprimento', impugnacao_fazenda_apresentada: 'cumprimento', calculos_homologados: 'cumprimento',
};
const SITUACAO_PAGAMENTO = /rpv|precatorio|alvara|pagamento|bloqueio/;
const SITUACAO_SENTENCA_SEM_RESULTADO = new Set(['sentenca_proferida', 'sentenca_publicada']);

// Lê os andamentos do mais antigo ao mais novo e guarda a fase mais avançada já alcançada.
export function analisarAndamentos(movimentacoes = [], situacaoAtual = null) {
  const lista = [...movimentacoes].sort((a, b) => new Date(a.data_movimentacao) - new Date(b.data_movimentacao));
  let fase = null;
  let resultado = null;        // 'procedente' | 'procedente_em_parte' | 'desfavoravel'
  let recursoJulgado = false;
  let pagamento = false;
  let arquivado = false;
  let concluido = false;    // execução extinta (pagamento concluído)
  const subir = f => { if (rank(f) > rank(fase)) fase = f; };

  for (const m of lista) {
    const t = sem(m.texto);
    if (/desarquiv/.test(t)) { arquivado = false; continue; }
    if (/arquivad|arquivamento/.test(t)) { arquivado = true; continue; }
    if (/extin\w* (da|a) execucao|extin\w* do cumprimento|extinta a execucao/.test(t)) { pagamento = true; concluido = true; continue; }
    if (/precatorio|\brpv\b|requisicao de pequeno valor|alvara|homologacao de acordo/.test(t)) { pagamento = true; continue; }
    if (/cumprimento de sentenca|execucao|evoluida a classe .*cumprimento/.test(t)) { subir('cumprimento'); recursoJulgado = false; if (resultado === 'desfavoravel') resultado = null; continue; }
    if (/transit\w* em julgado/.test(t)) { subir('transito'); continue; }
    if (/(nao[- ]?)?provimento|provido|nao conhecimento de recurso|recurso prejudicado/.test(t)) { if (rank(fase) >= rank('sentenca')) { fase = 'recurso'; recursoJulgado = true; } continue; }
    if (/recurso inominado|apelacao|contrarraz|em grau de recurso|instancia superior|recurso especial|recurso extraordinario/.test(t)) { if (rank(fase) >= rank('sentenca')) subir('recurso'); continue; }
    if (/improced|perempcao|litispendencia|coisa julgada|extin\w* .*sem resolucao|indeferi\w* a (peticao )?inicial/.test(t)) { fase = rank(fase) > rank('sentenca') ? fase : 'sentenca'; resultado = 'desfavoravel'; recursoJulgado = false; continue; }
    if (/procedente em parte|procedencia em parte|procedencia parcial|parcialmente procedente/.test(t) && !/impugnacao/.test(t)) { subir('sentenca'); resultado = 'procedente_em_parte'; recursoJulgado = false; continue; }
    if (/julgado procedente|procedencia/.test(t) && !/impugnacao/.test(t)) { subir('sentenca'); resultado = 'procedente'; recursoJulgado = false; continue; }
    if (/conclus\w* (para|ao) (julgamento|sentenca)|conclusao .*julgamento|julgamento de merito/.test(t)) { if (rank(fase) < rank('sentenca')) subir('concluso_sentenca'); continue; }
    if (/contestacao|replica|memoriais|instrucao e julgamento|saneamento|provas/.test(t)) { subir('instrucao'); continue; }
    if (/citacao|citad/.test(t)) { subir('citacao'); continue; }
    if (/distribuid/.test(t)) { subir('inicial'); continue; }
  }

  const sit = sem(situacaoAtual);
  if (sit === 'arquivado' || sit === 'autos_baixados') arquivado = true;
  if (sit && SITUACAO_PAGAMENTO.test(sit)) pagamento = true;
  if (FASE_POR_SITUACAO[sit]) subir(FASE_POR_SITUACAO[sit]);
  if (SITUACAO_SENTENCA_SEM_RESULTADO.has(sit) && rank(fase) <= rank('sentenca')) fase = 'sentenca';

  return { fase, resultado, recursoJulgado, pagamento, arquivado, concluido };
}

// Cada frase completa "O seu processo ...".
const FRASES = {
  inicial: 'está na fase inicial, antes da resposta da Fazenda Pública',
  citacao: 'aguarda a resposta da Fazenda Pública, que já foi chamada ao processo',
  instrucao: 'já tem a defesa da Fazenda Pública e segue para a análise do juiz',
  concluso_sentenca: 'está com o juiz para a sentença',
  transito: 'já tem decisão definitiva e segue para a fase de cobrança junto à Fazenda Pública',
  cumprimento: 'está na fase de cumprimento de sentença, em que se cobra da Fazenda Pública o que foi reconhecido',
};

const RESULTADO = { procedente: 'julgado procedente', procedente_em_parte: 'julgado procedente em parte' };

function fraseDaEtapa({ fase, resultado }) {
  if (fase === 'sentenca') {
    return RESULTADO[resultado] ? `já tem sentença, com o pedido ${RESULTADO[resultado]}` : null;
  }
  if (fase === 'recurso') {
    if (RESULTADO[resultado]) return `já tem sentença, com o pedido ${RESULTADO[resultado]}, e está na fase de recurso, aguardando o julgamento`;
    return resultado ? null : 'está na fase de recurso, aguardando o julgamento';
  }
  return FRASES[fase] || null;
}

const dataBR = d => new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Recife' });

// Devolve { numero, encaminhar, motivo, etapa, ultimoAndamentoEm }.
export function resumirProcesso(processo, movimentacoes = []) {
  const base = { numero: processo.numero, encaminhar: true, motivo: null, etapa: null, ultimoAndamentoEm: null };
  const datas = movimentacoes.map(m => new Date(m.data_movimentacao).getTime()).filter(Number.isFinite);
  if (datas.length) base.ultimoAndamentoEm = dataBR(Math.max(...datas));

  // TJPB chega pelo e-mail do PJe mesmo com o DataJud falhando; os demais tribunais só valem
  // quando a sincronização está em dia (sem isso o andamento pode estar desatualizado).
  const tribunalEmDia = processo.tribunal === 'TJPB' || processo.sync_status === 'ok';
  if (!datas.length) return { ...base, motivo: 'sem_andamentos' };
  if (!tribunalEmDia) return { ...base, motivo: 'andamentos_desatualizados' };

  const a = analisarAndamentos(movimentacoes, processo.situacao_atual);
  if (a.arquivado) return { ...base, motivo: 'arquivamento' };
  if (a.concluido) return { ...base, motivo: 'execucao_extinta' };
  if (a.pagamento) return { ...base, motivo: 'pagamento' };
  if (a.recursoJulgado) return { ...base, motivo: 'resultado_recurso' };
  if (a.resultado === 'desfavoravel') return { ...base, motivo: 'resultado_sentenca' };
  const etapa = fraseDaEtapa(a);
  if (!etapa) return { ...base, motivo: a.fase === 'sentenca' ? 'resultado_sentenca' : 'etapa_indefinida' };
  return { ...base, encaminhar: false, etapa, fase: a.fase };
}

const primeiroNome = nome => {
  const p = String(nome || '').trim().split(/\s+/)[0] || '';
  return p ? p[0].toUpperCase() + p.slice(1).toLowerCase() : '';
};

// O número do processo nunca vai no texto (11/11/2026): se o cliente pedir, a Camila passa
// à equipe jurídica. Com mais de um processo em andamento, diz que é o mais antigo.
export function montarTextoCliente({ nome, resumo, outrosProcessos = 0 }) {
  const n = primeiroNome(nome);
  const abertura = n ? `${n}, sou Camila, assistente da Abrantes & Montenegro.` : 'Sou Camila, assistente da Abrantes & Montenegro.';
  const sujeito = outrosProcessos > 0 ? 'O seu processo mais antigo em andamento' : 'O seu processo';
  return [
    abertura,
    `${sujeito} ${resumo.etapa}.`,
    `O último andamento registrado é de ${resumo.ultimoAndamentoEm}. Qualquer novidade, avisamos por aqui.`,
  ].join(' ');
}

const digitos = v => String(v || '').replace(/\D/g, '');

// Escolhe o processo: o indicado pelo cliente (pelo começo do número) ou o ativo mais antigo.
export function escolherProcesso(processos, numeroInformado) {
  const ativos = processos.filter(p => p.status === 'ativo');
  // O ano do número CNJ (NNNNNNN-DD.AAAA) é o ano do ajuizamento; criado_em é só a data de
  // importação no AM e não serve para dizer qual é o mais antigo.
  const ano = p => Number((String(p.numero).match(/^\d{7}-?\d{2}\.?(\d{4})/) || [])[1]) || 9999;
  const data = p => new Date(p.data_distribuicao || `${ano(p)}-12-31`).getTime();
  const ordenados = [...ativos].sort((a, b) => ano(a) - ano(b) || data(a) - data(b) || String(a.numero).localeCompare(String(b.numero)));
  const dica = digitos(numeroInformado);
  if (dica.length >= 7) {
    const achado = ordenados.find(p => digitos(p.numero).startsWith(dica) || (dica.length >= 13 && digitos(p.numero).includes(dica)));
    return { processo: achado || null, indicado: true, totalAtivos: ordenados.length, ordenados };
  }
  return { processo: ordenados[0] || null, indicado: false, totalAtivos: ordenados.length, ordenados };
}

async function processosDoCliente(clienteId, banco) {
  return banco.query(
    `SELECT id, numero, tribunal, status, situacao_atual, sync_status, data_distribuicao, criado_em
       FROM processos WHERE cliente_id = $1`, [clienteId]);
}

async function andamentos(processoId, banco) {
  return banco.query(
    `SELECT data_movimentacao, texto FROM movimentacoes WHERE processo_id = $1
      ORDER BY data_movimentacao DESC LIMIT 400`, [processoId]);
}

export async function localizarClientePorContato({ contactId, telefone }, banco = db) {
  if (contactId) {
    const porContato = await banco.query(
      `SELECT id, nome FROM clientes WHERE ativo IS NOT FALSE AND digisac_contact_id = $1`, [String(contactId)]);
    if (porContato.length === 1) return porContato[0];
    if (porContato.length > 1) return null;
  }
  const telefones = new Set(variantesTelefoneCliente(telefone));
  if (!telefones.size) return null;
  const clientes = await banco.query(`SELECT id, nome, whatsapp FROM clientes WHERE ativo IS NOT FALSE AND whatsapp IS NOT NULL`);
  const achados = clientes.filter(c => variantesTelefoneCliente(c.whatsapp).some(n => telefones.has(n)));
  return achados.length === 1 ? achados[0] : null;
}

// Processos já encerrados na prática (arquivados ou com a execução extinta) não contam como
// "ativos" para a escolha do mais antigo, mesmo que ainda estejam ativos no cadastro.
const ENCERRADO_NA_PRATICA = new Set(['arquivamento', 'execucao_extinta']);

export async function consultaParaCliente(cliente, numeroInformado, banco = db) {
  const processos = await processosDoCliente(cliente.id, banco);
  const { processo, indicado, ordenados } = escolherProcesso(processos, numeroInformado);
  if (!processo) {
    return { encontrado: true, nome: cliente.nome, encaminhar: true,
      motivo: indicado ? 'numero_nao_localizado' : 'sem_processo_ativo', totalAtivos: ordenados.length };
  }
  const candidatos = indicado ? [processo] : ordenados;
  let escolhido = null;
  const emAndamento = [];
  for (const p of candidatos) {
    const resumo = resumirProcesso(p, await andamentos(p.id, banco));
    if (!escolhido) escolhido = resumo;
    if (!ENCERRADO_NA_PRATICA.has(resumo.motivo)) emAndamento.push(resumo);
  }
  const resumo = emAndamento[0] || escolhido;
  const totalAtivos = indicado ? ordenados.length : emAndamento.length;
  const resposta = { encontrado: true, nome: cliente.nome, totalAtivos, numero: resumo.numero,
    encaminhar: resumo.encaminhar, motivo: resumo.motivo };
  if (!resumo.encaminhar) {
    resposta.texto = montarTextoCliente({ nome: cliente.nome, resumo, outrosProcessos: indicado ? 0 : emAndamento.length - 1 });
  }
  return resposta;
}

export async function consultarProcessoParaCamila({ contactId, telefone, numero }, banco = db) {
  const cliente = await localizarClientePorContato({ contactId, telefone }, banco);
  if (!cliente) return { encontrado: false };
  return consultaParaCliente(cliente, numero, banco);
}

// Identificação pelo nome completo + CPF. Exige os dois: CPF exato e nome compatível com o
// cadastro (todas as palavras do nome informado no cadastro, ou o inverso). Quando confere,
// grava o contato do Digisac e o WhatsApp na ficha se esses campos estiverem vazios.
export function nomeConfere(informado, cadastrado) {
  const a = normalizarNomeCliente(informado).split(' ').filter(Boolean);
  const b = normalizarNomeCliente(cadastrado).split(' ').filter(Boolean);
  if (a.length < 2 || !b.length) return false;
  if (a[0] !== b[0]) return false;
  const contem = (x, y) => x.every(p => y.includes(p));
  return contem(a, b) || contem(b, a);
}

export async function identificarClienteParaCamila({ cpf, nome, contactId, telefone, numero }, banco = db) {
  const cpfLimpo = digitos(cpf);
  if (cpfLimpo.length !== 11) return { encontrado: false, motivo: 'cpf_invalido' };
  const cliente = await banco.queryOne(
    `SELECT id, nome, whatsapp, digisac_contact_id FROM clientes WHERE ativo IS NOT FALSE AND regexp_replace(cpf, '\\D', '', 'g') = $1`,
    [cpfLimpo]);
  if (!cliente || !nomeConfere(nome, cliente.nome)) return { encontrado: false, motivo: 'nao_confere' };

  const telefoneLimpo = digitos(telefone);
  const gravarContato = contactId && !cliente.digisac_contact_id;
  const gravarTelefone = telefoneLimpo.length >= 10 && !cliente.whatsapp;
  if (gravarContato || gravarTelefone) {
    await banco.query(
      `UPDATE clientes SET
          digisac_contact_id = CASE WHEN $2::text IS NOT NULL AND digisac_contact_id IS NULL THEN $2 ELSE digisac_contact_id END,
          whatsapp = CASE WHEN $3::text IS NOT NULL AND whatsapp IS NULL THEN $3 ELSE whatsapp END,
          atualizado_em = NOW()
        WHERE id = $1`,
      [cliente.id, gravarContato ? String(contactId) : null, gravarTelefone ? telefoneLimpo : null]);
    console.log('[CAMILA] cliente identificado por nome+CPF; vínculo gravado na ficha id=%s contato=%s telefone=%s',
      cliente.id.slice(0, 8), Boolean(gravarContato), Boolean(gravarTelefone));
  }
  return { ...(await consultaParaCliente(cliente, numero, banco)), vinculoGravado: Boolean(gravarContato || gravarTelefone) };
}
