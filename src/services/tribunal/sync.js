import { db }              from '../../db/index.js';
import { redis }           from '../../cache/redis.js';
import { lerCredencialGrau, descriptografarCredencial } from '../../routes/credenciais.js';
import * as pje           from './pje.js';
import * as eproc         from './eproc.js';
import * as mni           from './mni.js';
import * as datajud       from './datajud.js';

const URL_TRIBUNAL = {
  TJPB: {
    '1': process.env.PJE_TJPB_1G_URL || 'https://pje.tjpb.jus.br/pje/login.seam',
    '2': process.env.PJE_TJPB_2G_URL || 'https://pje.tjpb.jus.br/pje2g/login.seam',
  },
  TJRN: {
    '1': process.env.PJE_TJRN_1G_URL || 'https://pje1g.tjrn.jus.br/pje/login.seam',
    '2': process.env.PJE_TJRN_2G_URL || 'https://pje2g.tjrn.jus.br/pje/login.seam',
  },
  TJPE: {
    '1': process.env.PJE_TJPE_1G_URL || 'https://pje.cloud.tjpe.jus.br/1g/login.seam',
    '2': process.env.PJE_TJPE_2G_URL || 'https://pje.cloud.tjpe.jus.br/2g/login.seam',
  },
  TRF1: {
    '1': process.env.PJE_TRF1_1G_URL || 'https://pje1g.trf1.jus.br/pje/login.seam',
    '2': process.env.PJE_TRF1_2G_URL || 'https://pje2g.trf1.jus.br/pje/login.seam',
  },
  TRF5: {
    '1': process.env.EPROC_TRF5_URL || 'https://eproc.trf5.jus.br/eproc/',
    '2': process.env.EPROC_TRF5_URL || 'https://eproc.trf5.jus.br/eproc/',
  },
  TRF3: {
    '1': process.env.EPROC_TRF3_URL || 'https://eproc.trf3.jus.br/eproc/',
    '2': process.env.EPROC_TRF3_URL || 'https://eproc.trf3.jus.br/eproc/',
  },
  TRF4: {
    '1': process.env.EPROC_TRF4_URL || 'https://eproc.trf4.jus.br/eproc/',
    '2': process.env.EPROC_TRF4_URL || 'https://eproc.trf4.jus.br/eproc/',
  },
  TRF6: {
    '1': process.env.EPROC_TRF6_URL || 'https://eproc.trf6.jus.br/eproc/',
    '2': process.env.EPROC_TRF6_URL || 'https://eproc.trf6.jus.br/eproc/',
  },
};

// ─────────────────────────────────────────────
//  PRIORIDADE DETERMINÍSTICA
//  Regras objetivas sobrescrevem a sugestão da IA.
//  Evita conflitos entre prioridade da UI e do diagnóstico.
// ─────────────────────────────────────────────
function calcularPrioridade(diag) {
  const prazoFinal   = diag.pendencia?.prazoFinal;
  const statusPrazo  = diag.pendencia?.statusPrazo;
  const tipo         = diag.pendencia?.tipo;

  // Prazo já vencido → sempre CRITICO
  if (statusPrazo === 'VENCIDO') return 'CRITICO';

  if (prazoFinal) {
    const agora   = Date.now();
    const prazo   = new Date(prazoFinal).getTime();
    const diffH   = (prazo - agora) / 3_600_000;
    if (diffH < 0)   return 'CRITICO'; // passou
    if (diffH <= 48) return 'CRITICO'; // menos de 48h
    if (diffH <= 120) return 'ALTO';   // menos de 5 dias
  }

  // Expediente aberto ou determinação judicial = mínimo ALTO
  const URGENTES = new Set(['PETICIONAR', 'CONFERIR_EXPEDIENTE', 'CUMPRIR_DETERMINACAO', 'PROVIDENCIAR_CITACAO']);
  if (URGENTES.has(tipo)) {
    return diag.prioridade === 'CRITICO' ? 'CRITICO' : 'ALTO';
  }

  // Fallback: usa o que a IA classificou (já validado no parser)
  return diag.prioridade || 'MEDIO';
}

// ─────────────────────────────────────────────
//  SALVAR RESULTADO NO BANCO
//  Reutilizado por sincronizarProcesso e sincronizarTodos
// ─────────────────────────────────────────────
async function salvarResultadoSync(processoId, processo, dados, movimentacoesBrutas) {
  console.log(`[Sync] dados extraídos p/${processo.numero}:`, JSON.stringify({ vara: dados.vara, polo_ativo: dados.polo_ativo, polo_passivo: dados.polo_passivo, acao: dados.acao, movs: movimentacoesBrutas.length }));
  // Marca sync bem-sucedido — reseta contador de falhas consecutivas
  await db.execute(
    `UPDATE processos SET sync_status = 'ok', sync_falhas = 0, atualizado_em = NOW() WHERE id = $1`,
    [processoId]
  ).catch(() => {});

  if (dados.vara || dados.polo_ativo || dados.habilitados?.length || dados.data_ajuizamento) {
    const dataDistribuicao = parsearDataPtBR(dados.data_ajuizamento);
    await db.execute(
      `UPDATE processos
       SET vara              = COALESCE($1, vara),
           juiz              = COALESCE($2, juiz),
           polo_ativo        = COALESCE($3, polo_ativo),
           polo_passivo      = COALESCE($4, polo_passivo),
           acao              = COALESCE($5, acao),
           habilitados_pje   = COALESCE($6, habilitados_pje),
           data_distribuicao = COALESCE($7, data_distribuicao),
           importado_pje     = true,
           atualizado_em     = NOW()
       WHERE id = $8`,
      [dados.vara, dados.juiz, dados.polo_ativo, dados.polo_passivo, dados.acao, dados.habilitados, dataDistribuicao, processoId]
    );
    await resolverSeparacaoSocios(processo, dados.habilitados || []);
  }

  let novasMovs = 0;
  const idsNovas = [];
  const CNJ_PURO = /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/;
  for (const mov of movimentacoesBrutas) {
    if (!mov.texto || mov.texto.length < 10) continue;
    if (CNJ_PURO.test(mov.texto.trim())) continue;
    if (/^[\d\s\-\/\.\:,;()]+$/.test(mov.texto)) continue;
    const data = parsearData(mov.data) || new Date();
    try {
      const [inserida] = await db.query(
        `INSERT INTO movimentacoes (processo_id, data_movimentacao, tipo, texto)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (processo_id, data_movimentacao, texto) DO NOTHING
         RETURNING id`,
        [processoId, data, mov.tipo || null, mov.texto]
      );
      if (inserida?.id) { idsNovas.push(inserida.id); novasMovs++; }
    } catch { /* ignora duplicata */ }
  }

  // Dispara diagnóstico IA para cada movimentação nova (sem bloquear o sync)
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

        // Prioridade final: regra determinística prevalece sobre sugestão da IA
        const prioridadeFinal = calcularPrioridade(diag);

        // Campos herdados (retrocompat) + campos estruturados novos
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

        // WhatsApp imediato para movimentações CRÍTICAS
        if (prioridadeFinal === 'CRITICO') {
          try {
            const { enviarAlerta } = await import('../digisac/index.js');
            const master = await db.queryOne(
              `SELECT whatsapp FROM usuarios WHERE id = $1`, [processo.master_responsavel_id]
            );
            if (master?.whatsapp) {
              const prazoTexto = diag.pendencia?.prazoFinal
                ? `\nPrazo: ${new Date(diag.pendencia.prazoFinal).toLocaleDateString('pt-BR')} ${diag.pendencia.statusPrazo === 'VENCIDO' ? '— VENCIDO' : ''}`
                : '';
              const msg =
                `⚠️ *CRÍTICO — ${mov.numero}*\n\n` +
                `${diag.ultimaMovimentacao?.descricao || mov.texto.slice(0, 200)}` +
                prazoTexto +
                `\n\nPendente: ${diag.pendencia?.resumo || 'Verificar processo'}`;
              await enviarAlerta(master.whatsapp, msg);
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

  return novasMovs;
}

// ─────────────────────────────────────────────
//  SINCRONIZAR PROCESSO INDIVIDUAL
//  Usado pela UI (botão "Sincronizar" por processo)
//  Abre e fecha o próprio browser — independente do sync em lote
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

  const grau = processo.grau || '1';
  const cred = await lerCredencialGrau(processo.master_responsavel_id, processo.tribunal, grau);
  if (!cred) throw new Error(`Credencial não encontrada para ${processo.tribunal} grau ${grau}.`);

  const url = URL_TRIBUNAL[processo.tribunal]?.[grau];
  if (!url) throw new Error(`URL não configurada para ${processo.tribunal} grau ${grau}.`);

  let dados = {};
  let movimentacoesBrutas = [];

  if (processo.sistema === 'pje') {
    try {
      const resultado = await mni.consultarProcesso(url, cred.cpf, cred.senha, processo.numero);
      dados               = resultado.dados;
      movimentacoesBrutas = resultado.movimentacoes;
      console.log(`[Sync] MNI OK para ${processo.numero}: ${movimentacoesBrutas.length} movimentações`);
    } catch (mniErr) {
      console.warn(`[Sync] MNI falhou (${mniErr.message}) — usando Puppeteer para ${processo.numero}`);
      const resultado = await pje.buscarProcessoCompleto(url, cred.cpf, cred.senha, cred.totp_secret, processo.numero);
      dados               = resultado.dados;
      movimentacoesBrutas = resultado.movimentacoes;
    }
  } else {
    const resultado = await eproc.buscarProcessoCompleto(url, cred.cpf, cred.senha, cred.totp_secret, processo.numero, grau);
    dados               = resultado.dados;
    movimentacoesBrutas = resultado.movimentacoes;
  }

  const novasMovs = await salvarResultadoSync(processoId, processo, dados, movimentacoesBrutas);
  console.log(`[Sync] Processo ${processo.numero}: ${novasMovs} novas movimentações.`);
  return { processoId, novasMovimentacoes: novasMovs };
}

// ─────────────────────────────────────────────
//  SINCRONIZAR TODOS OS PROCESSOS ATIVOS
//  Opção B: browser compartilhado por grupo (master + tribunal + grau)
//  Uma sessão PJe por grupo → sem EAGAIN, sem 87 logins
// ─────────────────────────────────────────────
export async function sincronizarTodos() {
  // Lock Redis: impede sobreposição se a execução anterior ainda está rodando.
  // TTL de 6h — tempo máximo razoável para um sync completo de ~900 processos.
  const LOCK_KEY = 'sync:global:lock';
  const acquired = await redis.set(LOCK_KEY, '1', 'NX', 'EX', 6 * 60 * 60);
  if (!acquired) {
    console.log('[Sync] Ignorado: execução anterior ainda em andamento (lock ativo).');
    return { ignorado: true, motivo: 'lock ativo' };
  }

  const processos = await db.query(
    `SELECT id, numero, tribunal, sistema, grau, master_responsavel_id
     FROM processos
     WHERE status IN ('ativo', 'suspenso')
     ORDER BY master_responsavel_id, tribunal, grau, atualizado_em ASC NULLS FIRST`
  );

  console.log(`[Sync] Iniciando sync de ${processos.length} processos...`);

  // Registra início da execução
  const execucao = await db.queryOne(
    `INSERT INTO sync_execucoes (total) VALUES ($1) RETURNING id`,
    [processos.length]
  ).catch(() => null);
  const execucaoId = execucao?.id || null;

  // Agrupa por master + tribunal + grau + sistema para compartilhar a sessão do browser
  const grupos = new Map();
  for (const p of processos) {
    const key = `${p.master_responsavel_id}|${p.tribunal}|${p.grau}|${p.sistema}`;
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key).push(p);
  }

  const resultados = [];

  try {
    for (const [, grupoProcessos] of grupos) {
      const { tribunal, grau, sistema, master_responsavel_id } = grupoProcessos[0];

      const url = URL_TRIBUNAL[tribunal]?.[grau];
      if (!url) {
        for (const { id, numero } of grupoProcessos) {
          resultados.push({ processoId: id, numero, ok: false, erro: `URL não configurada para ${tribunal} grau ${grau}` });
        }
        continue;
      }

      let cred = null;
      try {
        cred = await lerCredencialGrau(master_responsavel_id, tribunal, grau);
      } catch (err) {
        console.warn(`[Sync] Erro ao buscar credencial ${tribunal} ${grau}G:`, err.message);
      }
      if (!cred) {
        console.warn(`[Sync] Credencial não encontrada — ${tribunal} ${grau}G — pulando ${grupoProcessos.length} processo(s)`);
        for (const { id, numero } of grupoProcessos) {
          resultados.push({ processoId: id, numero, ok: false, erro: 'Credencial não encontrada' });
        }
        continue;
      }

      // eProc: sessão compartilhada — um login, todos os processos do grupo
      if (sistema !== 'pje') {
        let eprocBrowser = null;
        console.log(`[Sync] Abrindo sessão eProc — ${tribunal} ${grau}G (${grupoProcessos.length} processo(s))`);
        try {
          ({ browser: eprocBrowser } = await eproc.abrirSessao(url, cred.cpf, cred.senha, cred.totp_secret));
          for (const { id, numero } of grupoProcessos) {
            try {
              const resultado = await eproc.buscarProcessoCompletoComSessao(eprocBrowser, url, numero, grau);
              const processo  = await db.queryOne(`SELECT * FROM processos WHERE id = $1`, [id]);
              const novasMovs = await salvarResultadoSync(id, processo, resultado.dados, resultado.movimentacoes);
              await db.execute(`UPDATE processos SET sync_fonte = 'eproc' WHERE id = $1`, [id]).catch(() => {});
              resultados.push({ processoId: id, numero, ok: true, novasMovimentacoes: novasMovs, fonte: 'eproc' });
              console.log(`[Sync eProc] OK: ${numero} (${novasMovs} novas movimentações)`);
            } catch (err) {
              resultados.push({ processoId: id, numero, ok: false, erro: err.message });
              console.error(`[Sync eProc] Falha ${numero}:`, err.message);
              await registrarFalhaSyncProcesso(id);
              if (err.message?.includes('Target closed') || err.message?.includes('Session closed')) {
                console.warn(`[Sync eProc] Sessão encerrada — interrompendo grupo ${tribunal} ${grau}G`);
                break;
              }
            }
            await new Promise(r => setTimeout(r, 2_000));
          }
        } catch (err) {
          console.error(`[Sync eProc] Falha ao abrir sessão ${tribunal} ${grau}G:`, err.message);
          for (const { id, numero } of grupoProcessos) {
            if (!resultados.find(r => r.processoId === id)) {
              resultados.push({ processoId: id, numero, ok: false, erro: `Sessão eProc falhou: ${err.message}` });
            }
          }
        } finally {
          await eprocBrowser?.close().catch(() => {});
        }
        continue;
      }

      // ── CAMADA 1: DataJud (lote, sem browser, ~15 min para 865 processos) ──
      const numeros        = grupoProcessos.map(p => p.numero);
      const naoEncontrados = [];

      console.log(`[Sync DataJud] Consultando ${numeros.length} processo(s) — ${tribunal} ${grau}G`);
      let datajudMap = new Map();
      try {
        datajudMap = await datajud.consultarLote(tribunal, numeros);
        console.log(`[Sync DataJud] Encontrados: ${datajudMap.size}/${numeros.length}`);
      } catch (djErr) {
        console.warn(`[Sync DataJud] Falha geral — usando MNI/Puppeteer para todos:`, djErr.message);
      }

      for (const proc of grupoProcessos) {
        if (datajudMap.has(proc.numero)) {
          try {
            const resultado = datajudMap.get(proc.numero);
            const processo  = await db.queryOne(`SELECT * FROM processos WHERE id = $1`, [proc.id]);
            const novasMovs = await salvarResultadoSync(proc.id, processo, resultado.dados, resultado.movimentacoes);
            await db.execute(`UPDATE processos SET sync_fonte = 'datajud' WHERE id = $1`, [proc.id]).catch(() => {});
            resultados.push({ processoId: proc.id, numero: proc.numero, ok: true, novasMovimentacoes: novasMovs, fonte: 'datajud' });
            console.log(`[Sync DataJud] OK: ${proc.numero} (${novasMovs} novas movimentações)`);
          } catch (err) {
            console.warn(`[Sync DataJud] Salvar falhou para ${proc.numero}:`, err.message);
            naoEncontrados.push(proc); // tenta pelo browser
          }
        } else {
          naoEncontrados.push(proc);
        }
      }

      // ── CAMADA 2: MNI + Puppeteer para o que o DataJud não cobriu ──
      if (naoEncontrados.length === 0) continue;

      console.log(`[Sync] ${naoEncontrados.length} processo(s) não cobertos pelo DataJud — MNI/Puppeteer`);
      let browser = null;
      try {
        ({ browser } = await pje.abrirSessao(url, cred.cpf, cred.senha, cred.totp_secret));

        for (const { id, numero } of naoEncontrados) {
          try {
            let resultado;
            try {
              resultado = await mni.consultarProcesso(url, cred.cpf, cred.senha, numero);
              resultado._fonte = 'mni';
              console.log(`[Sync MNI] OK: ${numero}`);
            } catch (mniErr) {
              console.warn(`[Sync MNI] Falhou (${mniErr.message}) — Puppeteer para ${numero}`);
              resultado = await pje.buscarProcessoCompletoComSessao(browser, url, numero);
              resultado._fonte = 'puppeteer';
            }

            const processo  = await db.queryOne(`SELECT * FROM processos WHERE id = $1`, [id]);
            const novasMovs = await salvarResultadoSync(id, processo, resultado.dados, resultado.movimentacoes);
            const fonteUsada = resultado._fonte || 'puppeteer';
            await db.execute(`UPDATE processos SET sync_fonte = $1 WHERE id = $2`, [fonteUsada, id]).catch(() => {});
            resultados.push({ processoId: id, numero, ok: true, novasMovimentacoes: novasMovs, fonte: fonteUsada });
            console.log(`[Sync ${fonteUsada}] OK: ${numero} (${novasMovs} novas movimentações)`);
          } catch (err) {
            resultados.push({ processoId: id, numero, ok: false, erro: err.message });
            console.error(`[Sync] Falha ${numero}:`, err.message);
            await registrarFalhaSyncProcesso(id);
            if (err.message?.includes('Target closed') || err.message?.includes('Session closed') || err.message?.includes('detached')) {
              console.warn(`[Sync] Sessão PJe encerrada — interrompendo fallback ${tribunal} ${grau}G`);
              break;
            }
          }
          await new Promise(r => setTimeout(r, 2_000));
        }
      } catch (err) {
        console.error(`[Sync] Falha ao abrir sessão ${tribunal} ${grau}G:`, err.message);
        for (const { id, numero } of naoEncontrados) {
          if (!resultados.find(r => r.processoId === id)) {
            resultados.push({ processoId: id, numero, ok: false, erro: `Sessão falhou: ${err.message}` });
          }
        }
      } finally {
        await browser?.close().catch(() => {});
      }
    }
  } finally {
    await redis.del(LOCK_KEY).catch(() => {});
  }

  const ok   = resultados.filter(r => r.ok).length;
  const fail = resultados.filter(r => !r.ok).length;
  console.log(`[Sync] Concluído: ${ok} OK, ${fail} falhas.`);

  // Registra conclusão na tabela de histórico
  if (execucaoId) {
    await db.execute(
      `UPDATE sync_execucoes SET
         concluido_em  = NOW(),
         via_datajud   = $1,
         via_mni       = $2,
         via_puppeteer = $3,
         via_eproc     = $4,
         falhas        = $5
       WHERE id = $6`,
      [
        resultados.filter(r => r.fonte === 'datajud').length,
        resultados.filter(r => r.fonte === 'mni').length,
        resultados.filter(r => r.fonte === 'puppeteer').length,
        resultados.filter(r => r.fonte === 'eproc').length,
        fail,
        execucaoId,
      ]
    ).catch(() => {});
  }

  return resultados;
}

// ─────────────────────────────────────────────
//  COMPLETAR POLOS — preenche polo_ativo/passivo
//  nos processos PJe que ainda estão sem essa info
// ─────────────────────────────────────────────
export async function completarPolos(onProgress) {
  const processos = await db.query(
    `SELECT id, numero, tribunal, grau, sistema, master_responsavel_id
     FROM processos
     WHERE sistema = 'pje' AND status IN ('ativo','suspenso')
       AND (polo_ativo IS NULL OR polo_ativo = '')
     ORDER BY master_responsavel_id, tribunal, grau`
  );

  if (processos.length === 0) return { total: 0, ok: 0, erros: 0 };

  onProgress?.({ total: processos.length, ok: 0, erros: 0 });

  // Agrupa por master + tribunal + grau para reutilizar sessão PJe
  const grupos = new Map();
  for (const p of processos) {
    const key = `${p.master_responsavel_id}|${p.tribunal}|${p.grau}`;
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key).push(p);
  }

  let ok = 0, erros = 0;

  for (const [, grupo] of grupos) {
    const { tribunal, grau, master_responsavel_id } = grupo[0];
    const url = URL_TRIBUNAL[tribunal]?.[grau];
    if (!url) {
      erros += grupo.length;
      onProgress?.({ total: processos.length, ok, erros });
      continue;
    }

    const cred = await lerCredencialGrau(master_responsavel_id, tribunal, grau);
    if (!cred) {
      console.warn(`[Polos] Credencial não encontrada: ${tribunal} ${grau}G master ${master_responsavel_id}`);
      erros += grupo.length;
      onProgress?.({ total: processos.length, ok, erros });
      continue;
    }

    let browser = null;
    try {
      ({ browser } = await pje.abrirSessao(url, cred.cpf, cred.senha, cred.totp_secret));
      console.log(`[Polos] Sessão aberta: ${tribunal} ${grau}G — ${grupo.length} processo(s)`);

      for (const proc of grupo) {
        try {
          const resultado = await pje.buscarProcessoCompletoComSessao(browser, url, proc.numero);
          const { polo_ativo, polo_passivo } = resultado.dados;

          if (polo_ativo || polo_passivo) {
            await db.execute(
              `UPDATE processos SET
                 polo_ativo   = COALESCE($1, polo_ativo),
                 polo_passivo = COALESCE($2, polo_passivo),
                 atualizado_em = NOW()
               WHERE id = $3`,
              [polo_ativo || null, polo_passivo || null, proc.id]
            );
            console.log(`[Polos] OK: ${proc.numero} — ativo="${polo_ativo}" passivo="${polo_passivo}"`);
          }
          ok++;
        } catch (e) {
          console.error(`[Polos] Erro em ${proc.numero}:`, e.message);
          erros++;
          if (e.message?.includes('Target closed') || e.message?.includes('Session closed')) break;
        }
        onProgress?.({ total: processos.length, ok, erros });
        await new Promise(r => setTimeout(r, 1_500));
      }
    } catch (e) {
      console.error(`[Polos] Falha ao abrir sessão ${tribunal} ${grau}G:`, e.message);
      erros += grupo.length;
      onProgress?.({ total: processos.length, ok, erros });
    } finally {
      await browser?.close().catch(() => {});
    }
  }

  console.log(`[Polos] Concluído: ${ok} OK, ${erros} erros de ${processos.length} processos.`);
  return { total: processos.length, ok, erros };
}

// ─────────────────────────────────────────────
//  INSPECIONAR PAINEL — importa processos novos
// ─────────────────────────────────────────────
export async function importarDosPaineis(masterUserId) {
  const credenciais = await db.query(
    `SELECT * FROM credenciais_tribunal WHERE usuario_id = $1 AND ativo = true`,
    [masterUserId]
  );

  const importados = [];

  for (const credRaw of credenciais) {
    const cred = descriptografarCredencial(credRaw);
    const grau = cred.grau || '1';
    const url  = URL_TRIBUNAL[cred.tribunal]?.[grau];
    if (!url) continue;

    console.log(`[Painel] Acessando ${cred.tribunal} ${grau}G: ${url}`);

    try {
      let numeros = [];

      if (cred.sistema === 'pje') {
        numeros = await pje.inspecionarPainel(url, cred.cpf, cred.senha, cred.totp_secret, cred.oab);
      } else {
        numeros = await eproc.inspecionarPainel(url, cred.cpf, cred.senha, cred.totp_secret);
      }

      for (const numero of numeros) {
        const existe = await db.queryOne(`SELECT id FROM processos WHERE numero = $1`, [numero]);
        if (existe) continue;

        await db.execute(
          `INSERT INTO processos (numero, tribunal, sistema, grau, status, master_responsavel_id, importado_pje)
           VALUES ($1, $2, $3, $4, 'ativo', $5, false)
           ON CONFLICT (numero) DO NOTHING`,
          [numero, cred.tribunal, cred.sistema, grau, masterUserId]
        );
        importados.push({ numero, tribunal: cred.tribunal, grau });
      }

      console.log(`[Painel] ${cred.tribunal} ${grau}G: ${numeros.length} processos encontrados`);
    } catch (err) {
      console.error(`[Painel] ${cred.tribunal} ${grau}G falhou:`, err.message);
    }
  }

  console.log(`[Painel] ${importados.length} processos novos importados.`);
  return importados;
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
    await db.execute(
      `UPDATE processos SET compartilhado = true WHERE id = $1`,
      [processo.id]
    );
  }
}

// ─────────────────────────────────────────────
//  REGISTRAR FALHA DE SYNC
//  Após 3 falhas consecutivas, marca sync_status = 'erro_sync'
//  para que a UI possa destacar o processo e o advogado possa investigar.
// ─────────────────────────────────────────────
async function registrarFalhaSyncProcesso(processoId) {
  try {
    await db.execute(
      `UPDATE processos
       SET sync_falhas = COALESCE(sync_falhas, 0) + 1,
           sync_status = CASE
             WHEN COALESCE(sync_falhas, 0) + 1 >= 3 THEN 'erro_sync'
             ELSE sync_status
           END
       WHERE id = $1`,
      [processoId]
    );
  } catch { /* ignora — coluna pode não existir em dev */ }
}

// ─────────────────────────────────────────────
//  UTILITÁRIOS
// ─────────────────────────────────────────────
function parsearData(str) {
  if (!str) return null;
  const dmy = str.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (dmy) return new Date(`${dmy[3]}-${dmy[2]}-${dmy[1]}T12:00:00Z`);
  const iso = str.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(`${iso[1]}-${iso[2]}-${iso[3]}T12:00:00Z`);
  return null;
}

// Parser para datas em português do PJe: "24 jan 2024", "5 fev 2023" etc.
const MESES_PT = { jan:1,fev:2,mar:3,abr:4,mai:5,jun:6,jul:7,ago:8,set:9,out:10,nov:11,dez:12 };
function parsearDataPtBR(str) {
  if (!str) return null;
  // Tenta formato "24 jan 2024" ou "24 de jan de 2024"
  const m = str.toLowerCase().match(/(\d{1,2})\s+(?:de\s+)?([a-z]{3})\.?\s+(?:de\s+)?(\d{4})/);
  if (m) {
    const mes = MESES_PT[m[2]];
    if (mes) {
      const mm = String(mes).padStart(2, '0');
      const dd = String(m[1]).padStart(2, '0');
      return new Date(`${m[3]}-${mm}-${dd}T12:00:00Z`);
    }
  }
  return parsearData(str); // fallback para dd/mm/yyyy ou ISO
}
