/**
 * Sync — DataJud (CNJ) como única fonte de movimentações.
 */
import { db }       from '../../db/index.js';
import { redis }    from '../../cache/redis.js';
import * as datajud from './datajud.js';
import { fecharExecucaoSync, mensagemErroSync, criarMetricasSync } from './syncExecucao.js';
import { adquirirLock, CHAVE_LOCK_SYNC } from './syncLock.js';
import { montarMensagemCritico } from '../mensagensAlerta.js';

// R-06 — andamento com mais de tantos dias nunca aciona IA nem WhatsApp CRÍTICO, e a 1ª captura de um processo
// (backfill) não aciona nenhum dos dois, seja qual for a idade: a primeira execução do sync corrigido traz
// meses de andamentos de uma vez.
const DIAS_MAX_DIAGNOSTICO_IA = 7;
// Se este tanto de lotes seguidos falhar (após as novas tentativas), o tribunal está fora: não insiste.
const MAX_LOTES_FALHOS_SEGUIDOS = 3;

// ─────────────────────────────────────────────
//  INFERÊNCIA DE SITUACAO_ATUAL PELO TIPO DE AÇÃO
//  Só aplica se o processo ainda não foi classificado manualmente
// ─────────────────────────────────────────────
const ACAO_SITUACAO = [
  { regex: /cumprimento.*fazenda|fazenda.*cumprimento/i,   situacao: 'cumprimento_sentenca' },
  { regex: /cumprimento.*sentença|execução.*sentença/i,    situacao: 'cumprimento_sentenca' },
  { regex: /precatório/i,                                  situacao: 'em_precatorio' },
  { regex: /rpv|requisição.*pequeno/i,                     situacao: 'aguardando_rpv' },
  { regex: /apelação|agravo.*instrumento|recurso/i,        situacao: 'em_recurso' },
  { regex: /embargos.*execução/i,                          situacao: 'cumprimento_sentenca' },
  { regex: /mandado.*segurança|ms\b/i,                     situacao: 'em_conhecimento' },
  { regex: /ação.*ordinária|procedimento.*comum/i,         situacao: 'em_conhecimento' },
];

function inferirSituacaoDoTipoAcao(acao) {
  if (!acao) return null;
  for (const { regex, situacao } of ACAO_SITUACAO) {
    if (regex.test(acao)) return situacao;
  }
  return null;
}

// ─────────────────────────────────────────────
//  PRIORIDADE DETERMINÍSTICA
// ─────────────────────────────────────────────
function calcularPrioridade(diag) {
  const prazoFinal  = diag.pendencia?.prazoFinal;
  const statusPrazo = diag.pendencia?.statusPrazo;
  const tipo        = diag.pendencia?.tipo;

  if (statusPrazo === 'VENCIDO') return 'CRITICO';

  if (prazoFinal) {
    const diffH = (new Date(prazoFinal).getTime() - Date.now()) / 3_600_000;
    if (diffH < 0)    return 'CRITICO';
    if (diffH <= 48)  return 'CRITICO';
    if (diffH <= 120) return 'ALTO';
  }

  const URGENTES = new Set(['PETICIONAR','CONFERIR_EXPEDIENTE','CUMPRIR_DETERMINACAO','PROVIDENCIAR_CITACAO']);
  if (URGENTES.has(tipo)) return diag.prioridade === 'CRITICO' ? 'CRITICO' : 'ALTO';

  return diag.prioridade || 'MEDIO';
}

// ─────────────────────────────────────────────
//  SALVAR RESULTADO NO BANCO
// ─────────────────────────────────────────────
async function salvarResultadoSync(processoId, processo, dados, movimentacoesBrutas, { atualizadoEm = null } = {}) {
  console.log(`[Sync] dados p/${processo.numero}: vara=${dados.vara} movs=${movimentacoesBrutas.length}`);

  // R-06: 'ok', sync_falhas = 0 e a marca datajud_atualizado_em só são gravados NO FIM (abaixo), depois
  // de tudo salvo. Antes o 'ok' vinha primeiro: um erro no meio deixava o processo "ok" e o contador zerado.
  // Sem marca gravada (NULL) esta é a 1ª captura do processo pelo sync novo: backfill, sem IA nem WhatsApp.
  const backfill = !processo.datajud_atualizado_em;

  if (dados.vara || dados.polo_ativo || dados.polo_passivo || dados.habilitados?.length || dados.data_ajuizamento) {
    const dataDistribuicao = parsearDataPtBR(dados.data_ajuizamento);
    const situacaoInferida = inferirSituacaoDoTipoAcao(dados.acao);
    await db.execute(
      `UPDATE processos
       SET vara               = COALESCE($1,  vara),
           juiz               = COALESCE($2,  juiz),
           polo_ativo         = COALESCE($3,  polo_ativo),
           polo_passivo       = COALESCE($4,  polo_passivo),
           acao               = COALESCE($5,  acao),
           habilitados_pje    = COALESCE($6,  habilitados_pje),
           data_distribuicao  = COALESCE($7,  data_distribuicao),
           classe_processual  = COALESCE($8,  classe_processual),
           valor_causa        = COALESCE($9,  valor_causa),
           comarca            = COALESCE($10, comarca),
           assunto_principal  = COALESCE($11, assunto_principal),
           situacao_atual     = CASE WHEN situacao_atual IS NULL AND $13::text IS NOT NULL THEN $13::text ELSE situacao_atual END,
           importado_pje      = true,
           atualizado_em      = NOW()
       WHERE id = $12`,
      [dados.vara, dados.juiz, dados.polo_ativo, dados.polo_passivo,
       dados.acao, dados.habilitados, dataDistribuicao,
       dados.classe_codigo, dados.valor_causa, dados.comarca_ibge ? String(dados.comarca_ibge) : null,
       dados.assunto_principal, processoId, situacaoInferida]
    );
    await resolverSeparacaoSocios(processo, dados.habilitados || []);
  }

  let novasMovs = 0;
  let semIA = 0;
  let errosInsercao = 0;
  const idsNovas = [];
  const limiteIA = Date.now() - DIAS_MAX_DIAGNOSTICO_IA * 24 * 60 * 60 * 1000;
  const CNJ_PURO = /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/;
  for (const mov of movimentacoesBrutas) {
    if (!mov.texto || mov.texto.length < 10) continue;
    if (CNJ_PURO.test(mov.texto.trim())) continue;
    if (/^[\d\s\-\/\.\:,;()]+$/.test(mov.texto)) continue;
    const data = parsearData(mov.data);
    if (!data) continue;
    try {
      const [inserida] = await db.query(
        `INSERT INTO movimentacoes (processo_id, data_movimentacao, tipo, texto)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (processo_id, data_movimentacao, texto) DO NOTHING
         RETURNING id`,
        [processoId, data, mov.tipo || null, mov.texto]
      );
      if (inserida?.id) {
        novasMovs++;
        // Só andamento recente de processo já capturado vai para a IA; o resto (backfill) só é gravado.
        if (!backfill && data.getTime() >= limiteIA) idsNovas.push(inserida.id); else semIA++;
      }
    } catch (err) {
      // Duplicata é inofensiva (e o ON CONFLICT acima já a absorve). Qualquer OUTRO erro não pode passar
      // batido: a marca de "capturado" não avança, senão o andamento perdido nunca mais seria buscado.
      if (err?.code !== '23505') errosInsercao++;
    }
  }
  if (semIA > 0) console.log(`[Sync] ${semIA} andamento(s) gravado(s) sem IA e sem alerta (${backfill ? 'primeira captura' : `mais de ${DIAS_MAX_DIAGNOSTICO_IA} dias`}).`);

  if (idsNovas.length > 0) {
    const { ai } = await import('../ai/index.js');
    for (const movId of idsNovas) {
      const mov = await db.queryOne(
        `SELECT m.*, p.numero, p.tribunal, pr.nome AS produto
         FROM movimentacoes m
         JOIN processos p ON p.id = m.processo_id
         LEFT JOIN produtos pr ON pr.id = p.produto_id
         WHERE m.id = $1`, [movId]
      );
      if (!mov) continue;
      const historico = await db.query(
        `SELECT texto FROM movimentacoes WHERE processo_id = $1 ORDER BY data_movimentacao DESC LIMIT 5`,
        [mov.processo_id]
      );
      try {
        const diag = await ai.diagnosticar({
          numero: mov.numero, tribunal: mov.tribunal, produto: mov.produto,
          data: mov.data_movimentacao, texto: mov.texto,
          historico: historico.map(h => h.texto).join('\n---\n'),
        });

        const prioridadeFinal = calcularPrioridade(diag);

        await db.execute(
          `UPDATE movimentacoes SET
             diagnostico_significado   = $1,
             diagnostico_proxima_acao  = $2,
             diagnostico_urgencia      = $3,
             diagnostico_prazo_dias    = NULL,
             pendencia_tipo            = $4,
             pendencia_resumo          = $5,
             pendencia_prazo_final     = $6,
             pendencia_status_prazo    = $7,
             pendencia_conferencia_pje = $8,
             diagnostico_em            = NOW()
           WHERE id = $9`,
          [
            diag.ultimaMovimentacao?.descricao,
            diag.pendencia?.resumo,
            prioridadeFinal,
            diag.pendencia?.tipo,
            diag.pendencia?.resumo,
            diag.pendencia?.prazoFinal   || null,
            diag.pendencia?.statusPrazo  || null,
            diag.pendencia?.precisaConferenciaPJe ?? false,
            movId,
          ]
        );
        console.log(`[IA] ${mov.numero} — ${diag.pendencia?.tipo} — ${prioridadeFinal}`);

        if (prioridadeFinal === 'CRITICO') {
          try {
            const { enviarAlerta } = await import('../digisac/index.js');
            const master = await db.queryOne(
              `SELECT whatsapp FROM usuarios WHERE id = $1`, [processo.master_responsavel_id]
            );
            if (master?.whatsapp) {
              // S-14 (30/09/2026): só CNJ, prazo e convite ao AM — antes ia o texto da movimentação
              // e o resumo da IA, texto livre com nome de parte. Formato em services/mensagensAlerta.js.
              await enviarAlerta(master.whatsapp,
                montarMensagemCritico({
                  numero: mov.numero,
                  prazoFinal: diag.pendencia?.prazoFinal,
                  statusPrazo: diag.pendencia?.statusPrazo,
                }),
                { tipo: 'critico', origem: 'sync_critico', usuarioId: processo.master_responsavel_id }
              );
            }
          } catch (alertErr) {
            console.warn('[Alerta] Falha ao enviar WhatsApp CRÍTICO:', alertErr.message);
          }
        }
      } catch (e) {
        console.warn(`[IA] Diagnóstico falhou para movimentação ${movId}:`, e.message);
      }
    }
  }

  if (errosInsercao > 0) throw new Error(`${errosInsercao} movimentação(ões) não gravada(s)`);

  // Sucesso de verdade: zera o contador de falhas, tira o 'erro_sync' e avança a marca do DataJud.
  await db.execute(
    `UPDATE processos
        SET sync_status = 'ok', sync_falhas = 0, atualizado_em = NOW(),
            datajud_atualizado_em = COALESCE($2, datajud_atualizado_em)
      WHERE id = $1`,
    [processoId, atualizadoEm]
  );

  return novasMovs;
}

async function consultarComFallback(processo) {
  let erroApi = null;
  try {
    const r = await datajud.consultarProcesso(processo.tribunal, processo.numero);
    if (r) return { resultado: r, fonte: 'datajud' };
  } catch (err) {
    console.warn(`[Sync] DataJud falhou ${processo.numero}: ${err.message}`);
    erroApi = err;
  }
  // API que falhou (429, 5xx, timeout) NÃO é "processo não encontrado": propaga a causa real, para o
  // sync individual falhar (e tentar de novo) em vez de dizer que o processo não existe.
  if (erroApi) throw erroApi;
  console.warn(`[Sync] DataJud sem resultado para ${processo.numero}`);
  return null;
}

// ─────────────────────────────────────────────
//  SINCRONIZAR PROCESSO INDIVIDUAL
//  Usado pelo botão "Sincronizar" por processo na UI.
// ─────────────────────────────────────────────
export async function sincronizarProcesso(processoId) {
  const processo = await db.queryOne(
    `SELECT p.*, c.nome AS cliente_nome
     FROM processos p
     LEFT JOIN clientes c ON c.id = p.cliente_id
     WHERE p.id = $1`,
    [processoId]
  );
  if (!processo) throw new Error(`Processo ${processoId} não encontrado.`);

  const resultado = await consultarComFallback(processo);
  if (!resultado) throw new Error(`Processo ${processo.numero} não encontrado no DataJud.`);

  const { resultado: r, fonte } = resultado;
  const novasMovs = await salvarResultadoSync(processoId, processo, r.dados, r.movimentacoes, { atualizadoEm: r.atualizadoEm });
  await db.execute(`UPDATE processos SET sync_fonte = $1 WHERE id = $2`, [fonte, processoId]).catch(() => {});
  console.log(`[Sync] ${processo.numero} via ${fonte}: ${novasMovs} novas movimentações.`);
  return { processoId, novasMovimentacoes: novasMovs, fonte };
}

// ─────────────────────────────────────────────
//  SINCRONIZAR TODOS — pelos NOSSOS números, em lotes (R-06)
//  Pergunta ao DataJud por 100 números de cada vez (terms em numeroProcesso; ~800 processos = 9 requisições)
//  e, para cada processo reconhecido, compara a data de atualização recebida com a já gravada
//  (processos.datajud_atualizado_em): só o que mudou é regravado. Roda a cada hora via BullMQ.
//
//  Garantias:
//   - 429, 5xx e timeout são FALHA (nova tentativa com espera crescente dentro do datajud.js; esgotadas, o
//     lote inteiro conta como falha), nunca "nada mudou";
//   - não existe janela para avançar: a marca de cada processo só avança DEPOIS de os dados serem gravados,
//     então o que falhou volta sozinho na próxima execução;
//   - sucesso zera sync_falhas e tira o processo de 'erro_sync';
//   - um lock com dono e batimento impede duas execuções ao mesmo tempo (syncLock.js);
//   - primeira captura de um processo = backfill: grava os andamentos sem IA e sem WhatsApp CRÍTICO.
//  `batimentoLockMs` só existe para os testes encurtarem o batimento do lock.
// ─────────────────────────────────────────────
export async function sincronizarTodos({ batimentoLockMs } = {}) {
  const lock = await adquirirLock(redis, CHAVE_LOCK_SYNC, batimentoLockMs ? { batimentoMs: batimentoLockMs } : undefined);
  if (!lock) {
    console.log('[Sync] Ignorado: execução anterior ainda em andamento (lock ativo).');
    return { ignorado: true, motivo: 'lock ativo' };
  }

  // Fora do try: o catch precisa deles para fechar a execução. Antes `const execucaoId` vivia
  // dentro do try e o catch lançava ReferenceError, escondendo o erro real e deixando a linha aberta.
  let execucaoId = null;
  const resultados = [];
  const metricas = criarMetricasSync();

  try {
    console.log('[Sync] Iniciando sync DataJud — consulta pelos números dos nossos processos');

    // Nunca capturados e mais atrasados primeiro: se a API cair no meio, o que fica de fora é o mais recente.
    const processos = await db.query(
      `SELECT id, numero, tribunal, datajud_atualizado_em
         FROM processos
        WHERE status IN ('ativo', 'suspenso')
        ORDER BY datajud_atualizado_em ASC NULLS FIRST`
    );
    for (const p of processos) p.numeroPuro = p.numero.replace(/\D/g, ''); // 20 dígitos, como o DataJud guarda

    // Agrupa por tribunal: cada um é um índice diferente do DataJud
    const tribunais = [...new Set(processos.map(p => p.tribunal))];

    const execucao = await db.queryOne(
      `INSERT INTO sync_execucoes (total) VALUES ($1) RETURNING id`,
      [processos.length]
    ).catch(err => {
      console.warn('[Sync] Execução não registrada em sync_execucoes:', err.message);
      return null;
    });
    execucaoId = execucao?.id || null;

    for (const tribunal of tribunais) {
      const doTribunal = processos.filter(p => p.tribunal === tribunal);
      await sincronizarTribunal(tribunal, doTribunal, { lock, resultados, metricas });
    }

    const ok        = resultados.filter(r => r.ok).length;
    const fail      = resultados.filter(r => !r.ok).length;
    const novasMovs = resultados.reduce((acc, r) => acc + (r.novasMovimentacoes || 0), 0);
    const agora     = new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    console.log(`[Sync] ✅ Concluído em ${agora}`);
    console.log(`[Sync]    ${ok} processos sincronizados (${metricas.casados} reconhecidos pelo DataJud), ${fail} falhas`);
    console.log(`[Sync]    Movimentações novas: ${novasMovs}`);

    await fecharExecucaoSync(db, execucaoId, { viaDatajud: ok, falhas: fail, novasMovimentacoes: novasMovs, metricas: metricas.resumo() });

    return resultados;

  } catch (err) {
    // Garante que sync_execucoes sempre recebe concluido_em mesmo em erro fatal, com a causa real
    // (sem dado pessoal) em `erro`; o erro original segue para quem chamou.
    await fecharExecucaoSync(db, execucaoId, {
      viaDatajud:         resultados.filter(r => r.ok).length,
      falhas:             Math.max(resultados.filter(r => !r.ok).length, 1),
      novasMovimentacoes: resultados.reduce((acc, r) => acc + (r.novasMovimentacoes || 0), 0),
      erro:               mensagemErroSync(err),
      metricas:           metricas.resumo(),
    });
    throw err;
  } finally {
    await lock.liberar();
  }
}

function exigirLock(lock) {
  if (lock.perdido) throw new Error('Lock do sync perdido: outra execução assumiu.');
}

// Um tribunal: divide os processos em lotes e consulta lote a lote. O resultado de cada lote é gravado
// antes do próximo, então uma queda no meio não perde o que já foi capturado.
async function sincronizarTribunal(tribunal, processos, ctx) {
  const { lock, resultados, metricas } = ctx;

  // Número fora do padrão CNJ (20 dígitos) nunca casaria no DataJud: não vale gastar posição no lote.
  const validos = processos.filter(p => p.numeroPuro.length === 20);
  if (validos.length < processos.length) {
    console.warn(`[Sync DataJud] ${tribunal}: ${processos.length - validos.length} processo(s) com número fora do padrão CNJ — não consultado(s)`);
  }

  const lotes = datajud.dividirEmLotes(validos);
  console.log(`[Sync DataJud] ${tribunal}: ${validos.length} processo(s) em ${lotes.length} lote(s)`);
  let lotesFalhosSeguidos = 0;

  for (let i = 0; i < lotes.length; i++) {
    exigirLock(lock);

    if (lotesFalhosSeguidos >= MAX_LOTES_FALHOS_SEGUIDOS) {
      // O tribunal não respondeu em vários lotes seguidos (cada um já esgotou as novas tentativas): insistir só
      // prolongaria a execução. Os que sobram contam como falha e voltam na próxima execução.
      for (const p of lotes.slice(i).flat()) {
        await registrarFalha(p, resultados, `${tribunal}: DataJud indisponível — não consultado nesta execução`);
      }
      console.warn(`[Sync DataJud] ${tribunal}: ${lotesFalhosSeguidos} lotes seguidos sem resposta — restante fica para a próxima execução`);
      break;
    }

    const lote = lotes[i];
    let resposta;
    try {
      resposta = await datajud.consultarPorNumeros(tribunal, lote.map(p => p.numeroPuro));
    } catch (err) {
      // A API não respondeu bem para este lote: isso é falha real, não "nada mudou". A marca dos processos
      // do lote não avança, então a próxima execução os consulta de novo.
      lotesFalhosSeguidos++;
      metricas.registrarStatus(err.status);
      console.warn(`[Sync DataJud] ${tribunal}: lote ${i + 1}/${lotes.length} falhou —`, err.message);
      for (const p of lote) await registrarFalha(p, resultados, `${tribunal}: ${err.message}`);
      continue;
    }

    lotesFalhosSeguidos = 0;
    metricas.registrarStatus(resposta.status);
    metricas.hits += resposta.hits;
    await processarLote(tribunal, lote, resposta, ctx);
  }
}

async function processarLote(tribunal, lote, resposta, { lock, resultados, metricas }) {
  let novosNoLote = 0;

  for (const proc of lote) {
    exigirLock(lock);
    const achado = resposta.encontrados.get(proc.numeroPuro);

    if (!achado) {
      if (resposta.falharam.has(proc.numeroPuro)) {
        // Resposta parcial do DataJud: este número não chegou, e não chegar não é "não existe".
        await registrarFalha(proc, resultados, `${tribunal}: resposta parcial do DataJud`);
      } else {
        await marcarNaoEncontrado(proc.id);
      }
      continue;
    }

    metricas.casados++;
    const anterior = proc.datajud_atualizado_em ? new Date(proc.datajud_atualizado_em).getTime() : null;
    // Sem marca gravada, ou sem data legível no DataJud: trata como mudou (regravar é idempotente).
    const mudou = anterior === null || !achado.atualizadoEm || achado.atualizadoEm.getTime() > anterior;

    try {
      let novasMovs = 0;
      if (mudou) {
        const processo = await db.queryOne(`SELECT * FROM processos WHERE id = $1`, [proc.id]);
        novasMovs = await salvarResultadoSync(proc.id, processo, achado.dados, achado.movimentacoes, { atualizadoEm: achado.atualizadoEm });
        await db.execute(`UPDATE processos SET sync_fonte = 'datajud' WHERE id = $1`, [proc.id]).catch(() => {});
      } else {
        // Nada novo no DataJud, mas a consulta deu certo: limpa contador de falhas e o 'erro_sync' de antes.
        await db.execute(
          `UPDATE processos SET sync_status = 'ok', sync_falhas = 0, sync_fonte = 'datajud'
            WHERE id = $1
              AND (sync_status IS DISTINCT FROM 'ok' OR COALESCE(sync_falhas, 0) <> 0 OR sync_fonte IS DISTINCT FROM 'datajud')`,
          [proc.id]
        );
      }
      resultados.push({ processoId: proc.id, numero: proc.numero, ok: true, novasMovimentacoes: novasMovs });
      novosNoLote += novasMovs;
      if (novasMovs > 0) console.log(`[Sync DataJud] ✦ ${proc.numero}: ${novasMovs} nova(s) movimentação(ões)`);
    } catch (err) {
      console.warn(`[Sync DataJud] Salvar falhou ${proc.numero}:`, err.message);
      await registrarFalha(proc, resultados, err.message);
    }
  }

  console.log(`[Sync DataJud] ${tribunal}: lote com ${lote.length} processo(s), ${novosNoLote} movimentação(ões) nova(s)`);
}

async function registrarFalha(proc, resultados, erro) {
  resultados.push({ processoId: proc.id, numero: proc.numero, ok: false, erro });
  await registrarFalhaSyncProcesso(proc.id);
}

// O DataJud respondeu e não tem o processo (novo demais — o DataJud atrasa até 72 h —, sigiloso ou de outro
// grau). Não é falha: zera o contador. E se ele nunca foi capturado, deixa de aparecer como 'erro_sync'
// (o erro era da API, não do processo) e volta a "aguardando primeira captura", que é o que ele é.
async function marcarNaoEncontrado(processoId) {
  try {
    await db.execute(
      `UPDATE processos SET sync_falhas = 0, sync_status = 'aguardando_primeira_captura'
        WHERE id = $1 AND sync_fonte IS NULL
          AND (sync_status IS DISTINCT FROM 'aguardando_primeira_captura' OR COALESCE(sync_falhas, 0) <> 0)`,
      [processoId]
    );
  } catch (err) {
    console.warn('[Sync] Não foi possível marcar processo não encontrado:', err.message);
  }
}

// ─────────────────────────────────────────────
//  PREENCHER POLOS VIA DATAJUD
//  Para tribunais que retornam partes (não TJPB).
//  TJPB: polos cadastrados manualmente no cliente.
// ─────────────────────────────────────────────
export async function preencherPolosDataJud(onProgress) {
  const processos = await db.query(
    `SELECT id, numero, tribunal
     FROM processos
     WHERE status IN ('ativo','suspenso')
       AND (polo_ativo IS NULL OR polo_ativo = '' OR polo_passivo IS NULL OR polo_passivo = '')
     ORDER BY tribunal, id`
  );

  console.log(`[PolosDataJud] ${processos.length} processo(s) sem polo`);
  if (processos.length === 0) return { total: 0, ok: 0, sem_dados: 0 };

  const porTribunal = new Map();
  for (const p of processos) {
    if (!porTribunal.has(p.tribunal)) porTribunal.set(p.tribunal, []);
    porTribunal.get(p.tribunal).push(p);
  }

  let ok = 0, sem_dados = 0;
  onProgress?.({ total: processos.length, ok, sem_dados });

  for (const [tribunal, procs] of porTribunal) {
    let map = new Map();
    try {
      map = await datajud.consultarLote(tribunal, procs.map(p => p.numero));
      console.log(`[PolosDataJud] ${tribunal}: ${map.size}/${procs.length} encontrados`);
    } catch (err) {
      console.warn(`[PolosDataJud] ${tribunal}: falha —`, err.message);
      sem_dados += procs.length;
      onProgress?.({ total: processos.length, ok, sem_dados });
      continue;
    }

    for (const proc of procs) {
      const r = map.get(proc.numero);
      if (!r || (!r.dados.polo_ativo && !r.dados.polo_passivo)) {
        sem_dados++;
        onProgress?.({ total: processos.length, ok, sem_dados });
        continue;
      }
      const { polo_ativo, polo_passivo, vara, acao, data_ajuizamento } = r.dados;
      const dataDistribuicao = data_ajuizamento ? new Date(data_ajuizamento + 'T12:00:00Z') : null;
      await db.execute(
        `UPDATE processos SET
           polo_ativo        = COALESCE($1, polo_ativo),
           polo_passivo      = COALESCE($2, polo_passivo),
           vara              = COALESCE($3, vara),
           acao              = COALESCE($4, acao),
           data_distribuicao = COALESCE($5, data_distribuicao),
           atualizado_em     = NOW()
         WHERE id = $6`,
        [polo_ativo || null, polo_passivo || null, vara || null, acao || null, dataDistribuicao, proc.id]
      ).catch(err => console.warn(`[PolosDataJud] update falhou ${proc.numero}:`, err.message));
      console.log(`[PolosDataJud] OK: ${proc.numero}`); // sem os nomes dos polos: são dado pessoal (S-14)
      ok++;
      onProgress?.({ total: processos.length, ok, sem_dados });
    }
  }

  console.log(`[PolosDataJud] Concluído: ${ok} OK, ${sem_dados} sem dados de ${processos.length}`);
  return { total: processos.length, ok, sem_dados };
}

// ─────────────────────────────────────────────
//  SEPARAÇÃO DE SÓCIOS
// ─────────────────────────────────────────────
async function resolverSeparacaoSocios(processo, habilitados) {
  if (!habilitados.length) return;
  const masters = await db.query(
    `SELECT u.id FROM usuarios u
     JOIN credenciais_tribunal ct ON ct.usuario_id = u.id AND ct.tribunal = $1
     WHERE u.perfil = 'master' AND ct.cpf = ANY($2)`,
    [processo.tribunal, habilitados]
  );
  if (masters.length === 1) {
    await db.execute(
      `UPDATE processos SET master_responsavel_id = $1, compartilhado = false WHERE id = $2`,
      [masters[0].id, processo.id]
    );
  } else if (masters.length >= 2) {
    await db.execute(`UPDATE processos SET compartilhado = true WHERE id = $1`, [processo.id]);
  }
}

async function registrarFalhaSyncProcesso(processoId) {
  try {
    await db.execute(
      `UPDATE processos
       SET sync_falhas = COALESCE(sync_falhas, 0) + 1,
           sync_status = CASE WHEN COALESCE(sync_falhas, 0) + 1 >= 3 THEN 'erro_sync' ELSE sync_status END
       WHERE id = $1`,
      [processoId]
    );
  } catch { /* ignora */ }
}

function parsearData(str) {
  if (!str) return null;
  const dmy = str.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (dmy) return new Date(`${dmy[3]}-${dmy[2]}-${dmy[1]}T12:00:00Z`);
  const iso = str.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(`${iso[1]}-${iso[2]}-${iso[3]}T12:00:00Z`);
  return null;
}

const MESES_PT = { jan:1,fev:2,mar:3,abr:4,mai:5,jun:6,jul:7,ago:8,set:9,out:10,nov:11,dez:12 };
function parsearDataPtBR(str) {
  if (!str) return null;
  const m = str.toLowerCase().match(/(\d{1,2})\s+(?:de\s+)?([a-z]{3})\.?\s+(?:de\s+)?(\d{4})/);
  if (m) {
    const mes = MESES_PT[m[2]];
    if (mes) return new Date(`${m[3]}-${String(mes).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}T12:00:00Z`);
  }
  return parsearData(str);
}
