/**
 * Sync — DataJud (CNJ) como fonte de movimentações.
 * importarDosPaineis usa Puppeteer PJe/eProc para descobrir processos novos por OAB.
 */
import { db }       from '../../db/index.js';
import { redis }    from '../../cache/redis.js';
import * as datajud from './datajud.js';
import * as pje     from './pje.js';
import * as eproc   from './eproc.js';
import { lerCredencialGrau, descriptografarCredencial } from '../../routes/credenciais.js';

const URL_TRIBUNAL = {
  TJPB: { '1': process.env.PJE_TJPB_1G_URL || 'https://pje.tjpb.jus.br/pje/login.seam',   '2': process.env.PJE_TJPB_2G_URL || 'https://pje.tjpb.jus.br/pje2g/login.seam' },
  TJRN: { '1': process.env.PJE_TJRN_1G_URL || 'https://pje1g.tjrn.jus.br/pje/login.seam', '2': process.env.PJE_TJRN_2G_URL || 'https://pje2g.tjrn.jus.br/pje/login.seam' },
  TJPE: { '1': process.env.PJE_TJPE_1G_URL || 'https://pje.cloud.tjpe.jus.br/1g/login.seam','2': process.env.PJE_TJPE_2G_URL || 'https://pje.cloud.tjpe.jus.br/2g/login.seam' },
  TRF1: { '1': process.env.PJE_TRF1_1G_URL || 'https://pje1g.trf1.jus.br/pje/login.seam',  '2': process.env.PJE_TRF1_2G_URL || 'https://pje2g.trf1.jus.br/pje/login.seam' },
  TRF5: { '1': process.env.EPROC_TRF5_URL  || 'https://eproc.trf5.jus.br/eproc/',          '2': process.env.EPROC_TRF5_URL  || 'https://eproc.trf5.jus.br/eproc/' },
  TRF3: { '1': process.env.EPROC_TRF3_URL  || 'https://eproc.trf3.jus.br/eproc/',          '2': process.env.EPROC_TRF3_URL  || 'https://eproc.trf3.jus.br/eproc/' },
  TRF4: { '1': process.env.EPROC_TRF4_URL  || 'https://eproc.trf4.jus.br/eproc/',          '2': process.env.EPROC_TRF4_URL  || 'https://eproc.trf4.jus.br/eproc/' },
  TRF6: { '1': process.env.EPROC_TRF6_URL  || 'https://eproc.trf6.jus.br/eproc/',          '2': process.env.EPROC_TRF6_URL  || 'https://eproc.trf6.jus.br/eproc/' },
};

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
async function salvarResultadoSync(processoId, processo, dados, movimentacoesBrutas) {
  console.log(`[Sync] dados p/${processo.numero}: vara=${dados.vara} movs=${movimentacoesBrutas.length}`);

  await db.execute(
    `UPDATE processos SET sync_status = 'ok', sync_falhas = 0, atualizado_em = NOW() WHERE id = $1`,
    [processoId]
  ).catch(err => console.warn(`[Sync] sync_status update falhou ${processo.numero}:`, err.message));

  if (dados.vara || dados.polo_ativo || dados.polo_passivo || dados.habilitados?.length || dados.data_ajuizamento) {
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
      [dados.vara, dados.juiz, dados.polo_ativo, dados.polo_passivo,
       dados.acao, dados.habilitados, dataDistribuicao, processoId]
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
      if (inserida?.id) { idsNovas.push(inserida.id); novasMovs++; }
    } catch { /* ignora duplicata */ }
  }

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
              const prazoTexto = diag.pendencia?.prazoFinal
                ? `\nPrazo: ${new Date(diag.pendencia.prazoFinal).toLocaleDateString('pt-BR')} ${diag.pendencia.statusPrazo === 'VENCIDO' ? '— VENCIDO' : ''}`
                : '';
              await enviarAlerta(master.whatsapp,
                `⚠️ *CRÍTICO — ${mov.numero}*\n\n` +
                `${diag.ultimaMovimentacao?.descricao || mov.texto.slice(0, 200)}` +
                prazoTexto +
                `\n\nPendente: ${diag.pendencia?.resumo || 'Verificar processo'}`
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

  return novasMovs;
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

  const r = await datajud.consultarProcesso(processo.tribunal, processo.numero);
  if (!r) throw new Error(`Processo ${processo.numero} não encontrado no DataJud.`);

  const novasMovs = await salvarResultadoSync(processoId, processo, r.dados, r.movimentacoes);
  await db.execute(`UPDATE processos SET sync_fonte = 'datajud' WHERE id = $1`, [processoId]).catch(() => {});
  console.log(`[Sync] ${processo.numero}: ${novasMovs} novas movimentações.`);
  return { processoId, novasMovimentacoes: novasMovs };
}

// ─────────────────────────────────────────────
//  SINCRONIZAR TODOS — DataJud inteligente por data
//  Em vez de consultar 864 processos um a um, faz UMA query
//  por tribunal pedindo só os atualizados desde o último sync.
//  Roda a cada hora via BullMQ em segundos (não minutos).
// ─────────────────────────────────────────────
export async function sincronizarTodos() {
  const LOCK_KEY = 'sync:global:lock';
  const acquired = await redis.set(LOCK_KEY, '1', 'NX', 'EX', 30 * 60); // 30 min — bem mais rápido agora
  if (!acquired) {
    console.log('[Sync] Ignorado: execução anterior ainda em andamento (lock ativo).');
    return { ignorado: true, motivo: 'lock ativo' };
  }

  try {
    // Determina ponto de partida: último sync concluído - 2h de buffer (para não perder nada)
    const ultimaExecucao = await db.queryOne(
      `SELECT concluido_em FROM sync_execucoes WHERE concluido_em IS NOT NULL ORDER BY concluido_em DESC LIMIT 1`
    ).catch(() => null);

    const desde = ultimaExecucao?.concluido_em
      ? new Date(new Date(ultimaExecucao.concluido_em).getTime() - 2 * 60 * 60 * 1000).toISOString()
      : new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(); // primeira vez: últimas 48h

    console.log(`[Sync] Iniciando sync DataJud — atualizações desde ${desde.slice(0, 16).replace('T', ' ')}`);

    // Busca todos os nossos processos ativos e monta lookup por número puro (20 dígitos)
    const processos = await db.query(
      `SELECT id, numero, tribunal FROM processos WHERE status IN ('ativo', 'suspenso')`
    );

    const nossosPorPuro = new Map();
    for (const p of processos) {
      nossosPorPuro.set(p.numero.replace(/\D/g, ''), p);
    }

    // Agrupa por tribunal para fazer uma query por tribunal
    const tribunais = [...new Set(processos.map(p => p.tribunal))];

    const execucao = await db.queryOne(
      `INSERT INTO sync_execucoes (total) VALUES ($1) RETURNING id`,
      [processos.length]
    ).catch(() => null);
    const execucaoId = execucao?.id || null;

    const resultados = [];

    for (const tribunal of tribunais) {
      console.log(`[Sync DataJud] ${tribunal}: buscando atualizados desde ${desde.slice(0, 10)}...`);

      let atualizadosMap = new Map();
      try {
        atualizadosMap = await datajud.consultarAtualizados(tribunal, desde);
        console.log(`[Sync DataJud] ${tribunal}: ${atualizadosMap.size} processos com novidades no DataJud`);
      } catch (err) {
        console.warn(`[Sync DataJud] ${tribunal}: falha —`, err.message);
        continue;
      }

      // Cruza com nossos processos
      let nossosTribunal = 0;
      for (const [numeroPuro, resultado] of atualizadosMap) {
        const proc = nossosPorPuro.get(numeroPuro);
        if (!proc) continue; // Processo do DataJud que não é nosso — ignora

        nossosTribunal++;
        try {
          const processo  = await db.queryOne(`SELECT * FROM processos WHERE id = $1`, [proc.id]);
          const novasMovs = await salvarResultadoSync(proc.id, processo, resultado.dados, resultado.movimentacoes);
          await db.execute(`UPDATE processos SET sync_fonte = 'datajud' WHERE id = $1`, [proc.id]).catch(() => {});
          resultados.push({ processoId: proc.id, numero: proc.numero, ok: true, novasMovimentacoes: novasMovs });
          if (novasMovs > 0) console.log(`[Sync DataJud] ✦ ${proc.numero}: ${novasMovs} nova(s) movimentação(ões)`);
        } catch (err) {
          console.warn(`[Sync DataJud] Salvar falhou ${proc.numero}:`, err.message);
          resultados.push({ processoId: proc.id, numero: proc.numero, ok: false, erro: err.message });
          await registrarFalhaSyncProcesso(proc.id);
        }
      }

      console.log(`[Sync DataJud] ${tribunal}: ${nossosTribunal} dos nossos processos tinham novidades`);
    }

    const ok        = resultados.filter(r => r.ok).length;
    const fail      = resultados.filter(r => !r.ok).length;
    const novasMovs = resultados.reduce((acc, r) => acc + (r.novasMovimentacoes || 0), 0);
    const agora     = new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    console.log(`[Sync] ✅ Concluído em ${agora}`);
    console.log(`[Sync]    ${ok} processos com novidades, ${fail} falhas`);
    console.log(`[Sync]    Movimentações novas: ${novasMovs}`);

    if (execucaoId) {
      await db.execute(
        `UPDATE sync_execucoes SET concluido_em = NOW(), via_datajud = $1, falhas = $2, novas_movimentacoes = $3 WHERE id = $4`,
        [ok, fail, novasMovs, execucaoId]
      ).catch(() => {});
    }

    return resultados;

  } finally {
    await redis.del(LOCK_KEY).catch(() => {});
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
      console.log(`[PolosDataJud] OK: ${proc.numero} — ativo="${polo_ativo}" passivo="${polo_passivo}"`);
      ok++;
      onProgress?.({ total: processos.length, ok, sem_dados });
    }
  }

  console.log(`[PolosDataJud] Concluído: ${ok} OK, ${sem_dados} sem dados de ${processos.length}`);
  return { total: processos.length, ok, sem_dados };
}

// ─────────────────────────────────────────────
//  IMPORTAR PROCESSOS DO PAINEL PJe/eProc
//  Faz login com a credencial do advogado e busca todos os
//  CNJs associados ao número OAB — sem abrir cada processo.
//  Roda manualmente quando precisar importar processos novos.
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
      console.log(`[Painel] ${cred.tribunal} ${grau}G: ${numeros.length} processos encontrados, ${importados.length} novos`);
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
