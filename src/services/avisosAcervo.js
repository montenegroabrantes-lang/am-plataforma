// Avisos do acervo por WhatsApp (24/11/2026). Spec "AM - Spec Avisos do Acervo.md" (Drive, BANCO DE DADOS).
//
// Decisões do usuário (24/11/2026): só WhatsApp; só o Master da tarefa recebe; dia útil das 08h às 20h
// (Brasília), e o que acontecer fora disso espera a próxima janela, em mensagem própria; um aviso por
// evento; cada Master pode desligar para si (usuarios.avisos_acervo, padrão ligado).
// Etapa 1: aviso da vigilância que mudou. Etapa 2: decisão detectada, agrupada por Master numa só mensagem
// (a rotina das 15h registra várias de uma vez). Etapa 3: tese que muda de situação (ex.: ativa → em risco).
//
// Privacidade (regra S-14 / A5-05, ver mensagensAlerta.js): nada de nome de cliente, CPF ou valor. A
// vigilância leva o tema (informação pública), a nova situação, as contagens e o link para o AM; a lista
// de processos afetados fica na tarefa.
//
// Funções de mensagem e de janela são puras; a fila e o despacho recebem banco, envio e relógio
// injetáveis, para teste sem Digisac e sem Redis.

import { db } from '../db/index.js';
import { enviarAlerta } from './digisac/index.js';
import { linkAM, cnjParaMensagem } from './mensagensAlerta.js';
import { ehDiaUtil, hojeEscritorio, FUSO_ESCRITORIO } from '../utils/feriadosNacionais.js';

export const JANELA = { inicio: 8, fim: 20 }; // horas de Brasília, [inicio, fim)
export const MAX_TENTATIVAS = 3;
const ESPERA_NOVA_TENTATIVA_MIN = 10;
const LIMITE_LOTE = 50;
export const MAX_LINHAS_DECISAO = 10;
// A decisão espera alguns minutos antes de sair, para as várias da mesma rotina chegarem juntas.
export const ESPERA_AGRUPAR_DECISOES_MIN = 5;

// Interruptor geral, sem deploy de código: ACERVO_AVISOS_WHATSAPP=false desliga a fila.
export const avisosLigados = (env = process.env) => String(env.ACERVO_AVISOS_WHATSAPP ?? '').trim().toLowerCase() !== 'false';

export function horaEscritorio(agora = new Date()) {
  const h = new Intl.DateTimeFormat('en-GB', { timeZone: FUSO_ESCRITORIO, hour: '2-digit', hourCycle: 'h23' }).format(agora);
  return Number(h);
}

export function dentroDaJanela(agora = new Date()) {
  const h = horaEscritorio(agora);
  return ehDiaUtil(hojeEscritorio(agora)) && h >= JANELA.inicio && h < JANELA.fim;
}

const umaLinha = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

export function montarAvisoVigilancia({ referencia, situacao, totalPecas = 0, totalProcessos = 0, teses = [], baseUrl = process.env.FRONTEND_URL }) {
  const link = linkAM('/tarefas', baseUrl);
  const alcance = totalPecas
    ? `Afeta ${plural(totalPecas, 'peça', 'peças')} em ${plural(totalProcessos, 'processo', 'processos')}${teses.length ? ` (teses: ${teses.slice(0, 5).join(', ')}${teses.length > 5 ? '…' : ''})` : ''}.`
    : 'Nenhuma peça do acervo ligada a essas teses.';
  return [
    '⚖️ *Acervo — vigilância mudou*',
    umaLinha(referencia, 200),
    `Nova situação: ${umaLinha(situacao, 300)}`,
    alcance,
    `Tarefa aberta para você no AM${link ? `: ${link}` : '.'}`,
  ].join('\n');
}

const dataBR = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : '—'; };
const SENTIDO = { favoravel: 'favorável ao cliente', desfavoravel: 'desfavorável ao cliente' };

// Uma linha por decisão: número CNJ (só se for CNJ de verdade), tipo da peça, sentença ou acórdão e data,
// e o resultado — "a confirmar", ou favorável/desfavorável ao cliente com o resultado técnico.
export function montarLinhaDecisao({ numero, tipoPeca, tipoDecisao, data, resultado = null, sentido = null }) {
  const cnj = cnjParaMensagem(numero) || 'processo sem número CNJ';
  const peca = String(tipoPeca ?? '').replace(/-/g, ' ').trim() || 'peça';
  const qual = /ac[óo]rd/i.test(String(tipoDecisao ?? '')) ? 'Acórdão' : 'Sentença';
  const res = !resultado ? 'resultado a confirmar' : `${SENTIDO[sentido] ?? 'resultado'}: ${String(resultado).replace(/-/g, ' ')}`;
  return `• ${cnj} (${peca}) — ${qual} de ${dataBR(data)} — ${res}`;
}

export function montarAvisoDecisoes(linhas, { baseUrl = process.env.FRONTEND_URL } = {}) {
  const link = linkAM('/tarefas', baseUrl);
  const mostrar = linhas.slice(0, MAX_LINHAS_DECISAO);
  const resto = linhas.length - mostrar.length;
  return [
    `📄 *Acervo — ${linhas.length === 1 ? 'decisão' : `${linhas.length} decisões`} no PJe*`,
    ...mostrar,
    ...(resto > 0 ? [`e mais ${resto} no AM`] : []),
    `Conferir nas tarefas do AM${link ? `: ${link}` : '.'}`,
  ].join('\n');
}

const SITUACAO_TESE = { ativa: 'ativa', em_risco: 'em risco', suspensa: 'suspensa', superada: 'superada' };

// Tese que muda de situação: nome e slug, de → para, motivo e o alcance no acervo (com as variantes).
export function montarAvisoTese({ label, slug, de, para, motivo = null, totalPecas = 0, totalProcessos = 0, baseUrl = process.env.FRONTEND_URL }) {
  const link = linkAM('/acervo/painel', baseUrl);
  return [
    '🧭 *Acervo — tese mudou de situação*',
    `${umaLinha(label, 150)} (${umaLinha(slug, 80)})`,
    `Agora: ${SITUACAO_TESE[para] ?? umaLinha(para, 30)} (antes: ${SITUACAO_TESE[de] ?? umaLinha(de, 30)})`,
    ...(motivo ? [`Motivo: ${umaLinha(motivo, 300)}`] : []),
    totalPecas ? `Peças da tese e das variantes: ${plural(totalPecas, 'peça', 'peças')} em ${plural(totalProcessos, 'processo', 'processos')}.` : 'Nenhuma peça do acervo nessa tese.',
    `Ver o impacto no AM${link ? `: ${link}` : '.'}`,
  ].join('\n');
}

// Põe um aviso na fila. Devolve { id } ou null (desligado, usuário saiu dos avisos ou evento já avisado).
// `conexao` pode ser o db ou a transação de quem chama.
export async function enfileirarAviso(conexao, { tipo, chaveEvento, usuarioId, tarefaId = null, texto, enviarApos = null }, { env = process.env } = {}) {
  if (!avisosLigados(env)) return null;
  const u = await conexao.queryOne('SELECT avisos_acervo FROM usuarios WHERE id=$1', [usuarioId]);
  if (!u || u.avisos_acervo === false) return null;
  return conexao.queryOne(
    `INSERT INTO avisos_acervo (tipo, chave_evento, usuario_id, tarefa_id, texto, enviar_apos) VALUES ($1,$2,$3,$4,$5,COALESCE($6::timestamptz, NOW()))
     ON CONFLICT (chave_evento) DO NOTHING RETURNING id, status`,
    [tipo, chaveEvento, usuarioId, tarefaId, texto, enviarApos],
  );
}

// Despacha a fila. Fora da janela não envia nada (o que está pendente sai na próxima). Cada aviso é
// reservado ("enviando") antes do envio, para dois despachos simultâneos nunca mandarem o mesmo.
export async function despacharAvisos({ banco = db, enviar = enviarAlerta, agora = new Date(), tipos = null } = {}) {
  if (!dentroDaJanela(agora)) return { foraDaJanela: true, enviados: 0 };
  const filtroTipo = tipos?.length ? 'AND tipo = ANY($2::text[])' : '';
  const reservados = await banco.query(
    `UPDATE avisos_acervo SET status='enviando', tentativas = tentativas + 1
      WHERE id IN (SELECT id FROM avisos_acervo WHERE status='pendente' AND enviar_apos <= $1 ${filtroTipo}
                   ORDER BY criado_em LIMIT ${LIMITE_LOTE} FOR UPDATE SKIP LOCKED)
      RETURNING id, tipo, usuario_id, texto, tentativas`,
    tipos?.length ? [agora, tipos] : [agora],
  );
  const res = { foraDaJanela: false, enviados: 0, descartados: 0, reagendados: 0, falhas: 0, incertos: 0 };
  // Decisões do mesmo Master saem juntas numa mensagem; os demais avisos, um a um. Cada grupo recebe o
  // mesmo desfecho (todos enviados, todos reagendados...).
  const grupos = [];
  const decisoesPorUsuario = new Map();
  for (const a of reservados) {
    if (a.tipo === 'acervo_decisao') {
      if (!decisoesPorUsuario.has(a.usuario_id)) { const g = { tipo: a.tipo, usuario_id: a.usuario_id, itens: [] }; decisoesPorUsuario.set(a.usuario_id, g); grupos.push(g); }
      decisoesPorUsuario.get(a.usuario_id).itens.push(a);
    } else grupos.push({ tipo: a.tipo, usuario_id: a.usuario_id, itens: [a] });
  }
  for (const g of grupos) {
    const ids = g.itens.map(a => a.id);
    const n = ids.length;
    const u = await banco.queryOne('SELECT whatsapp, ativo, avisos_acervo FROM usuarios WHERE id=$1', [g.usuario_id]);
    const motivo = !u ? 'usuário não encontrado' : !u.ativo ? 'usuário inativo' : u.avisos_acervo === false ? 'usuário desligou os avisos do acervo' : !String(u.whatsapp ?? '').trim() ? 'usuário sem WhatsApp' : null;
    if (motivo) {
      await banco.execute(`UPDATE avisos_acervo SET status='descartado', ultimo_erro=$2 WHERE id = ANY($1::uuid[])`, [ids, motivo]);
      res.descartados += n; continue;
    }
    const texto = g.tipo === 'acervo_decisao' ? montarAvisoDecisoes(g.itens.map(a => a.texto)) : g.itens[0].texto;
    const r = await enviar(u.whatsapp, texto, { tipo: g.tipo, origem: 'avisos_acervo', usuarioId: g.usuario_id });
    const tentativas = Math.max(...g.itens.map(a => a.tentativas));
    if (r?.ok) {
      await banco.execute(`UPDATE avisos_acervo SET status='enviado', enviado_em=$2, ultimo_erro=NULL WHERE id = ANY($1::uuid[])`, [ids, agora]);
      res.enviados += n;
    } else if (r?.antesEnvio && tentativas < MAX_TENTATIVAS) {
      // Não saiu: seguro tentar de novo, mais tarde.
      await banco.execute(`UPDATE avisos_acervo SET status='pendente', enviar_apos=$2, ultimo_erro=$3 WHERE id = ANY($1::uuid[])`,
        [ids, new Date(agora.getTime() + ESPERA_NOVA_TENTATIVA_MIN * 60000), umaLinha(r?.erro, 300)]);
      res.reagendados += n;
    } else {
      // Esgotou as tentativas, ou pode ter saído (resultado incerto): não repete, para não mandar duas vezes.
      const status = r?.antesEnvio ? 'falhou' : 'incerto';
      await banco.execute(`UPDATE avisos_acervo SET status=$2, ultimo_erro=$3 WHERE id = ANY($1::uuid[])`, [ids, status, umaLinha(r?.erro, 300)]);
      if (status === 'falhou') res.falhas += n; else res.incertos += n;
    }
  }
  if (reservados.length) console.log(`[AvisosAcervo] ${JSON.stringify(res)}`);
  return res;
}

// Despacho imediato depois de um evento, sem segurar a resposta da rota. Desligável (testes, manutenção):
// ACERVO_AVISOS_DESPACHO_IMEDIATO=false deixa tudo para o agendamento de 10 em 10 minutos.
export function despacharEmSeguida(tipos, env = process.env) {
  if (String(env.ACERVO_AVISOS_DESPACHO_IMEDIATO ?? '').trim().toLowerCase() === 'false') return;
  setImmediate(() => { despacharAvisos({ tipos }).catch(err => console.warn('[AvisosAcervo] Despacho imediato falhou:', err.message)); });
}
