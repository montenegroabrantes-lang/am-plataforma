// Texto dos avisos que o AM manda por WhatsApp sobre tarefas e prazos (S-14 / A5-05).
//
// Regra de conteúdo (decisão D8 ainda não respondida pelo usuário — vale o padrão MAIS
// CONSERVADOR, 30/09/2026): a mensagem sai de CAMPOS ESTRUTURADOS — tipo da tarefa, quando
// vence, número do processo (CNJ) e link para o AM. Nunca de `tarefas.descricao`, que em 384
// das 390 tarefas de protocolo abertas traz o nome completo do cliente. Nada de nome do
// cliente (nem iniciais), CPF ou valor. O celular é o aparelho menos protegido do escritório e
// o Digisac guarda o histórico; o número do processo basta para achar o caso no AM.
//
// Funções puras, sem banco nem rede: o teste prova que nome e CPF não saem.

import { nomeDoDia } from '../utils/feriadosNacionais.js';

const ROTULO_TIPO = {
  prazo: 'Prazo',
  prazo_pagamento: 'Prazo de pagamento',
  protocolar: 'Protocolar',
  demanda: 'Demanda',
  assinatura: 'Assinatura',
  diligencia: 'Diligência',
  ciclo: 'Ciclo',
  cadastro_cliente: 'Cadastro de cliente',
  ciente: 'Ciente',
  ligar_cliente: 'Ligar para cliente',
  audiencia: 'Audiência',
  peticao: 'Petição',
};

// Lista fechada: um tipo que não conhece vira "Tarefa", nunca o texto cru do banco.
export function rotuloTipoTarefa(tipo) {
  return ROTULO_TIPO[String(tipo ?? '').trim()] || 'Tarefa';
}

const CNJ_FORMATADO = /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/;

// Só devolve o que é, de fato, um número CNJ (formatado ou 20 dígitos). `processos.numero`
// é texto livre no banco; se algum dia alguém digitar outra coisa ali, não vai pro WhatsApp.
export function cnjParaMensagem(numero) {
  const s = String(numero ?? '').trim();
  if (CNJ_FORMATADO.test(s)) return s;
  if (/^\d{20}$/.test(s)) return `${s.slice(0, 7)}-${s.slice(7, 9)}.${s.slice(9, 13)}.${s.slice(13, 14)}.${s.slice(14, 16)}.${s.slice(16)}`;
  return null;
}

// Link para o AM. Sem FRONTEND_URL (ou apontando para a máquina local) não se manda link:
// um endereço de localhost no celular de alguém não serve a ninguém. Nunca leva token, nem
// login automático, nem id de cliente — quem abre entra pelo login normal.
export function linkAM(caminho = '/tarefas', baseUrl = process.env.FRONTEND_URL) {
  const base = String(baseUrl ?? '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base) || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(base)) return null;
  return `${base}${caminho}`;
}

export function formatarDataBR(valor) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor ?? ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

// HOJE, AMANHÃ, ou o dia da semana e a data quando a "véspera" cai além de amanhã (sexta
// cobre o fim de semana e a segunda).
export function rotuloQuando({ diasRestantes, prazoData }) {
  const dias = Number(diasRestantes);
  if (dias === 0) return 'HOJE';
  if (dias === 1) return 'AMANHÃ';
  const iso = String(prazoData ?? '').slice(0, 10);
  const dataBR = formatarDataBR(iso);
  if (!dataBR) return 'EM BREVE';
  return `${nomeDoDia(iso).toUpperCase()} ${dataBR.slice(0, 5)}`;
}

// Uma linha por tarefa: "🔴 HOJE — Protocolar · 0801234-56.2025.8.15.2001".
// Só lê t.tipo, t.processo_numero, t.dias_restantes e t.prazo_data — `descricao` nem é lida.
export function montarLinhaVespera(t) {
  const cnj = cnjParaMensagem(t.processo_numero);
  return `🔴 ${rotuloQuando({ diasRestantes: t.dias_restantes, prazoData: t.prazo_data })} — ${rotuloTipoTarefa(t.tipo)}${cnj ? ` · ${cnj}` : ''}`;
}

const MAX_LINHAS_VESPERA = 15;

export function montarMensagemVespera({ nome, tarefas, baseUrl = process.env.FRONTEND_URL }) {
  const primeiroNome = String(nome ?? '').trim().split(/\s+/)[0];
  const ordenadas = [...tarefas].sort((a, b) => Number(a.dias_restantes) - Number(b.dias_restantes));
  const linhas = ordenadas.slice(0, MAX_LINHAS_VESPERA).map(montarLinhaVespera);
  const resto = ordenadas.length - linhas.length;
  if (resto > 0) linhas.push(`… e mais ${resto}. Veja todas na plataforma.`);
  const link = linkAM('/tarefas', baseUrl);
  return (
    `⏰ *Atenção${primeiroNome ? `, ${primeiroNome}` : ''}!*\n\n` +
    `Você tem ${tarefas.length} prazo${tarefas.length > 1 ? 's' : ''} vencendo:\n${linhas.join('\n')}\n\n` +
    `Acesse a plataforma para regularizar.${link ? `\n${link}` : ''}`
  );
}

// Alerta de movimentação crítica (diagnóstico da IA no sync). Antes mandava até 200 caracteres
// do texto da movimentação e o resumo escrito pela IA — texto livre, com nome de parte.
// Agora: só o número do processo, o prazo (data) e o convite para abrir o AM.
export function montarMensagemCritico({ numero, prazoFinal, statusPrazo, baseUrl = process.env.FRONTEND_URL }) {
  const cnj = cnjParaMensagem(numero);
  const prazo = formatarDataBR(prazoFinal);
  const link = linkAM('/processos', baseUrl);
  return (
    `⚠️ *Movimentação crítica*${cnj ? ` no processo ${cnj}` : ''}.` +
    (prazo ? `\nPrazo: ${prazo}${statusPrazo === 'VENCIDO' ? ' — VENCIDO' : ''}` : '') +
    `\n\nAbra o AM para ver.${link ? `\n${link}` : ''}`
  );
}
