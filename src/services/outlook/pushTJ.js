// Processa os e-mails de push do TJPB (pje@tjpb.jus.br) e os transforma em
// movimentação + prazo, reaproveitando o pipeline que já existe para publicações.
//
// Por que o número CNJ é extraído por regex e não por um parser do layout:
// o formato do corpo do e-mail pode mudar sem aviso, mas o número CNJ tem forma
// fixa por resolução do CNJ (NNNNNNN-DD.AAAA.J.TT.OOOO). Ancorar no que é estável
// evita que uma mudança de template do tribunal derrube a integração inteira.

import { db } from '../../db/index.js';
import { extrairPrazoPublicacao } from '../publicacoes/extrairPrazo.js';
import { criarEventoCalendar } from '../calendar/index.js';

// Aceita com máscara (0812345-67.2024.8.15.2001) ou 20 dígitos seguidos.
const CNJ_MASCARA = /\b(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})\b/g;
const CNJ_PURO    = /\b(\d{20})\b/g;

/** Extrai todos os números CNJ distintos do texto, normalizados para só dígitos. */
export function extrairNumerosCNJ(texto = '') {
  const achados = new Set();
  for (const m of texto.matchAll(CNJ_MASCARA)) achados.add(m[1].replace(/\D/g, ''));
  for (const m of texto.matchAll(CNJ_PURO))    achados.add(m[1]);
  return [...achados];
}

/**
 * Valida se o prazo extraído é plausível.
 *
 * A auditoria de 12/08/2026 encontrou uma tarefa com prazo em 09/12/2021 —
 * 1.692 dias vencida — porque o regex capturou uma data solta do corpo do texto.
 * Como toda data passada vira CRITICO no cálculo de urgência, esses falsos
 * positivos afogam os prazos reais no topo da lista. Melhor recusar e mandar
 * para conferência do que criar uma tarefa que mente.
 */
export function prazoPlausivel(dataEvento, dataReferencia) {
  if (!(dataEvento instanceof Date) || Number.isNaN(dataEvento.getTime())) return false;
  const ref = dataReferencia instanceof Date ? dataReferencia : new Date(dataReferencia);
  const dias = Math.round((dataEvento - ref) / 86_400_000);
  return dias >= 0 && dias <= 180;
}

/**
 * Processa uma mensagem já lida do Graph.
 * Não lança: qualquer falha é devolvida no resultado para o worker registrar.
 *
 * @returns {{status: string, numero?: string, processoId?: string, tarefaId?: string, motivo?: string}}
 */
export async function processarMensagem(msg) {
  const texto = (msg.body?.content || msg.bodyPreview || '').trim();
  const assunto = msg.subject || '';
  const recebidoEm = new Date(msg.receivedDateTime);

  // O número pode estar no assunto ou no corpo — procura nos dois.
  const numeros = extrairNumerosCNJ(`${assunto}\n${texto}`);

  if (numeros.length === 0) {
    return { status: 'sem_numero', motivo: 'Nenhum número CNJ encontrado no assunto nem no corpo.' };
  }

  // Um e-mail pode citar mais de um processo; o primeiro é o do push.
  const numeroPuro = numeros[0];

  const processo = await db.queryOne(
    `SELECT id, numero, tribunal, vara FROM processos
     WHERE REGEXP_REPLACE(numero, '[^0-9]', '', 'g') = $1
     LIMIT 1`,
    [numeroPuro]
  );

  if (!processo) {
    // Não descarta. A auditoria mostrou 61 publicações que sumiram exatamente
    // assim — sem processo cadastrado, sem tarefa, sem rastro de que chegaram.
    return { status: 'processo_desconhecido', numero: numeroPuro };
  }

  // Grava a movimentação. O índice único (processo_id, data_movimentacao, texto)
  // já protege contra o mesmo ato chegando também pelo DataJud.
  const textoMovimentacao = texto.slice(0, 4000) || assunto;
  const inserida = await db.query(
    `INSERT INTO movimentacoes (processo_id, data_movimentacao, texto, origem)
     VALUES ($1, $2, $3, 'push_tj')
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [processo.id, recebidoEm, textoMovimentacao]
  );

  if (inserida.length === 0) {
    return { status: 'duplicada', numero: processo.numero, processoId: processo.id };
  }

  await db.execute(
    `UPDATE processos SET atualizado_em = NOW() WHERE id = $1`,
    [processo.id]
  ).catch(() => {});

  // Tenta extrair prazo com o mesmo motor das publicações — ele já sabe dias
  // úteis, feriados nacionais, Páscoa, data por extenso e sessão virtual.
  let prazo = null;
  try {
    prazo = extrairPrazoPublicacao(textoMovimentacao, recebidoEm, processo);
  } catch (e) {
    console.warn('[Push TJ] extrairPrazo falhou:', e.message);
  }

  if (!prazo) {
    return { status: 'sem_prazo', numero: processo.numero, processoId: processo.id };
  }

  if (!prazoPlausivel(prazo.dataEvento, recebidoEm)) {
    return {
      status: 'prazo_implausivel',
      numero: processo.numero,
      processoId: processo.id,
      motivo: `Data extraída (${prazo.dataEvento?.toISOString?.().slice(0, 10)}) fora da janela de 0–180 dias do e-mail.`,
    };
  }

  const diasRestantes = Math.ceil((prazo.dataEvento - new Date()) / 86_400_000);
  const urgencia = diasRestantes <= 2 ? 'CRITICO'
                 : diasRestantes <= 5 ? 'ALTO'
                 : diasRestantes <= 10 ? 'MEDIO' : 'BAIXO';

  const eventId = await criarEventoCalendar({
    titulo:     prazo.titulo,
    dataHora:   prazo.dataEvento,
    tipo:       prazo.titulo,
    vara:       processo.vara,
    tribunal:   processo.tribunal,
    processoId: processo.id,
    descricao:  prazo.descricao,
  }).catch(() => null);

  // atribuido_a herda o master responsável pelo processo: prazo sem dono não
  // dispara alerta de véspera (o worker usa INNER JOIN em atribuido_a), que foi
  // como 90 prazos ficaram invisíveis até a auditoria.
  const [tarefa] = await db.query(
    `INSERT INTO tarefas
       (processo_id, tipo, descricao, urgencia, prazo_data, atribuido_a, validado_por, status, calendar_event_id)
     SELECT $1, 'prazo', $2, $3, $4::date, p.master_responsavel_id, p.master_responsavel_id, 'pendente', $5
     FROM processos p WHERE p.id = $1
     RETURNING id`,
    [processo.id, prazo.titulo, urgencia, prazo.dataEvento.toISOString().slice(0, 10), eventId || null]
  );

  return {
    status: 'prazo_criado',
    numero: processo.numero,
    processoId: processo.id,
    tarefaId: tarefa?.id,
    prazoData: prazo.dataEvento.toISOString().slice(0, 10),
    urgencia,
  };
}
