import { db }              from '../../db/index.js';
import { lerCredencial, lerCredencialGrau, descriptografarCredencial } from '../../routes/credenciais.js';
import * as pje           from './pje.js';
import * as eproc         from './eproc.js';
import * as mni           from './mni.js';

// URLs públicas dos sistemas. Env vars sobrescrevem os padrões caso necessário.
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
//  SINCRONIZAR PROCESSO INDIVIDUAL
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
    // PJe: tenta MNI primeiro (sem Puppeteer, muito mais rápido).
    // Se MNI falhar (403, indisponível, etc.) usa Puppeteer como fallback.
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
    // eProc: busca tudo em uma sessão com suporte a grau
    const resultado = await eproc.buscarProcessoCompleto(url, cred.cpf, cred.senha, cred.totp_secret, processo.numero, grau);
    dados               = resultado.dados;
    movimentacoesBrutas = resultado.movimentacoes;
  }

  // Atualiza dados básicos do processo
  if (dados.vara || dados.habilitados?.length) {
    await db.execute(
      `UPDATE processos
       SET vara              = COALESCE($1, vara),
           juiz              = COALESCE($2, juiz),
           polo_passivo      = COALESCE($3, polo_passivo),
           habilitados_pje   = COALESCE($4, habilitados_pje),
           importado_pje     = true,
           atualizado_em     = NOW()
       WHERE id = $5`,
      [dados.vara, dados.juiz, dados.polo_passivo, dados.habilitados, processoId]
    );

    await resolverSeparacaoSocios(processo, dados.habilitados || []);
  }

  // Insere movimentações novas (ON CONFLICT ignora duplicatas)
  let novasMovs = 0;
  for (const mov of movimentacoesBrutas) {
    if (!mov.texto) continue;
    const data = parsearData(mov.data) || new Date();
    try {
      await db.execute(
        `INSERT INTO movimentacoes (processo_id, data_movimentacao, tipo, texto)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (processo_id, data_movimentacao, texto) DO NOTHING`,
        [processoId, data, mov.tipo || null, mov.texto]
      );
      novasMovs++;
    } catch { /* ignora duplicata */ }
  }

  console.log(`[Sync] Processo ${processo.numero}: ${novasMovs} novas movimentações.`);
  return { processoId, novasMovimentacoes: novasMovs };
}

// ─────────────────────────────────────────────
//  SINCRONIZAR TODOS OS PROCESSOS ATIVOS
// ─────────────────────────────────────────────
export async function sincronizarTodos() {
  const processos = await db.query(
    `SELECT id, numero, tribunal, sistema, grau
     FROM processos
     WHERE status IN ('ativo', 'suspenso')
     ORDER BY atualizado_em ASC NULLS FIRST`
  );

  console.log(`[Sync] Iniciando sync de ${processos.length} processos...`);

  const resultados = [];
  // Sequencial — decisão arquitetural: não dois robôs paralelos
  for (const { id, numero } of processos) {
    try {
      const r = await sincronizarProcesso(id);
      resultados.push({ ...r, ok: true });
    } catch (err) {
      resultados.push({ processoId: id, numero, ok: false, erro: err.message });
      console.error(`[Sync] Processo ${numero} (${id}):`, err.message);
    }
  }

  const ok   = resultados.filter(r => r.ok).length;
  const fail = resultados.filter(r => !r.ok).length;
  console.log(`[Sync] Concluído: ${ok} OK, ${fail} falhas.`);

  return resultados;
}

// ─────────────────────────────────────────────
//  INSPECIONAR PAINEL — importa processos novos
// ─────────────────────────────────────────────
// Acessa o painel do PJe/eProc e importa números de processos ainda não cadastrados
export async function importarDosPaineis(masterUserId) {
  const credenciais = await db.query(
    `SELECT * FROM credenciais_tribunal WHERE usuario_id = $1 AND ativo = true`,
    [masterUserId]
  );

  const importados = [];

  for (const credRaw of credenciais) {
    const cred = descriptografarCredencial(credRaw);
    // Usa o grau cadastrado na credencial — cada grau pode ter login diferente
    const grau = cred.grau || '1';
    {
      const url = URL_TRIBUNAL[cred.tribunal]?.[grau];
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
          // Só importa se não existir ainda
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
        console.error(`[Painel] Stack:`, err.stack);
      }
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
//  UTILITÁRIO
// ─────────────────────────────────────────────
function parsearData(str) {
  if (!str) return null;
  const dmy = str.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (dmy) return new Date(`${dmy[3]}-${dmy[2]}-${dmy[1]}`);
  const iso = str.match(/\d{4}-\d{2}-\d{2}/);
  if (iso) return new Date(iso[0]);
  return null;
}
