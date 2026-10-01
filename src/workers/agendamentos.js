// Horário dos jobs recorrentes que dependem do RELÓGIO DE BRASÍLIA (A5-03 / A4-08).
//
// Até 30/09/2026 nenhum `repeat` definia `tz` e o servidor roda em UTC, então cada horário
// "de parede" saía 3 h adiantado em relação ao comentário do código:
//
//   job                     antes (UTC → Brasília)                depois (Brasília)
//   backup-diario           0 2 * * *      → 23:00 todo dia       02:00 todo dia
//   lembretes-diarios       0 8 * * *      → 05:00 todo dia       08:00 segunda a sexta (+ sem feriado nacional)
//   ciclos-recorrentes      0 7 * * *      → 04:00 todo dia       07:00 todo dia
//   escalonamento-vespera   30 8,16 * * *  → 05:30 e 13:30 todo dia   08:30 e 16:30, segunda a sexta (+ sem feriado nacional)
//   verificar-token-google  0 8 * * * com tz → 08:00 todo dia (já estava certo; só passou pra cá)
//
// NÃO mudam, de propósito: o sync do tribunal (0 * * * *), o push do TJPB (*/5), o
// reprocessamento da Camila (*/15) e do Drive (*/30) — são "a cada N", sem hora do dia — e o
// SAC (0 */2 e 0 */4), que só troca a fase da hora e cujo watchdog mede intervalo, não relógio
// (A4-09 propõe desligá-lo). Dar `tz` a esses só criaria agendamento novo sem ganho.
//
// ARMADILHA DO BULLMQ: o identificador de um repeatable inclui padrão e `tz`. Trocar qualquer um
// CRIA um agendamento novo e DEIXA o antigo vivo no Redis — a mensagem sairia em dobro (05h e 08h)
// e o backup rodaria 2x por dia, gastando a rotação de 7 arquivos em 3,5 dias.
// `removerAgendamentosAntigos` apaga do Redis tudo que tenha o mesmo nome e outro padrão/fuso.

export const TZ_ESCRITORIO = 'America/Sao_Paulo';

// Chave = nome do job. O valor é exatamente o `repeat` passado ao `queue.add`.
export const AGENDA = {
  'backup-diario':          { pattern: '0 2 * * *',       tz: TZ_ESCRITORIO },
  'lembretes-diarios':      { pattern: '0 8 * * 1-5',     tz: TZ_ESCRITORIO },
  'ciclos-recorrentes':     { pattern: '0 7 * * *',       tz: TZ_ESCRITORIO },
  'escalonamento-vespera':  { pattern: '30 8,16 * * 1-5', tz: TZ_ESCRITORIO },
  'verificar-token-google': { pattern: '0 8 * * *',       tz: TZ_ESCRITORIO },
};

// Remove da fila os repeatables de `nomes` cujo padrão/fuso não seja o de AGENDA. Chamar DEPOIS
// do `queue.add` novo: assim nunca há um instante sem agendamento. Nunca lança (boot não pode
// cair por causa disso); devolve o que removeu, para log e teste.
export async function removerAgendamentosAntigos(fila, nomes) {
  const removidos = [];
  let repetiveis;
  try {
    repetiveis = await fila.getRepeatableJobs();
  } catch (err) {
    console.warn('[Workers] Não deu pra listar os agendamentos existentes — antigos não removidos:', err.message);
    return removidos;
  }
  for (const bruto of repetiveis) {
    const r = lerRepetivel(bruto);
    if (!nomes.includes(r.name)) continue;
    const desejado = AGENDA[r.name];
    if (!desejado) continue;
    if (r.pattern === desejado.pattern && (r.tz || null) === (desejado.tz || null)) continue;
    try {
      await fila.removeRepeatableByKey(r.key);
      removidos.push({ nome: r.name, pattern: r.pattern, tz: r.tz || 'UTC' });
      console.log(`[Workers] Agendamento antigo removido: ${r.name} "${r.pattern}" (${r.tz || 'UTC'}) — vale "${desejado.pattern}" (${desejado.tz}).`);
    } catch (err) {
      console.warn(`[Workers] Falha ao remover o agendamento antigo de ${r.name}:`, err.message);
    }
  }
  return removidos;
}

// O BullMQ devolve nome/padrão/fuso lidos do hash do repeatable; se o hash não existir (chave no
// formato antigo "nome:jobId:fim:tz:padrão", anterior ao 3.x), tudo isso vem vazio e só a chave
// carrega os dados. Nesse caso lê da própria chave, para o agendamento antigo não escapar da limpeza.
export function lerRepetivel(r) {
  if (r?.name) return r;
  const partes = String(r?.key ?? '').split(':');
  if (partes.length < 5) return r;
  return { ...r, name: partes[0], tz: r.tz || partes[3] || null, pattern: r.pattern || partes.slice(4).join(':') || null };
}

function proximaEmBrasilia(ms) {
  if (!Number.isFinite(ms)) return 'n/d';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ_ESCRITORIO, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(ms));
}

// Uma linha por repeatable, com a próxima execução já em horário de Brasília. Vai pro log do
// boot: se o horário de algo estiver errado, aparece ali no primeiro deploy (A5-03).
export async function descreverAgendamentos(fila) {
  try {
    const lista = await fila.getRepeatableJobs();
    return lista
      .map(r => `${fila.name}/${r.name} "${r.pattern ?? r.every}" (${r.tz || 'UTC'}) → próxima ${proximaEmBrasilia(Number(r.next))} (Brasília)`)
      .sort();
  } catch (err) {
    return [`${fila?.name ?? '?'}: não deu pra listar (${err.message})`];
  }
}
