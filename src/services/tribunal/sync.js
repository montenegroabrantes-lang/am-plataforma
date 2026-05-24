import { db }     from '../../db/index.js';
import { lerCredencial } from '../../routes/credenciais.js';
import * as pje   from './pje.js';
import * as eproc from './eproc.js';

const URL_TRIBUNAL = {
  TJPB: process.env.PJE_TJPB_URL,
  TJRN: process.env.PJE_TJRN_URL,
  TJPE: process.env.PJE_TJPE_URL,
  TRF1: process.env.PJE_TRF1_URL,
  TRF5: process.env.EPROC_TRF5_URL,
  TRF3: process.env.EPROC_TRF3_URL,
  TRF4: process.env.EPROC_TRF4_URL,
  TRF6: process.env.EPROC_TRF6_URL,
};

// Sincroniza um processo específico
export async function sincronizarProcesso(processoId) {
  const processo = await db.queryOne(
    `SELECT p.*, c.nome AS cliente_nome, pr.nome AS produto
     FROM processos p
     LEFT JOIN clientes c  ON c.id = p.cliente_id
     LEFT JOIN produtos  pr ON pr.id = p.produto_id
     WHERE p.id = $1`,
    [processoId]
  );

  if (!processo) throw new Error(`Processo ${processoId} não encontrado.`);

  const cred = await lerCredencial(processo.master_responsavel_id, processo.tribunal);
  if (!cred) throw new Error(`Credencial não encontrada para ${processo.tribunal}.`);

  const url = URL_TRIBUNAL[processo.tribunal];
  if (!url) throw new Error(`URL não configurada para ${processo.tribunal}.`);

  let movimentacoesBrutas = [];
  let dadosProcesso       = {};

  if (processo.sistema === 'pje') {
    [movimentacoesBrutas, dadosProcesso] = await Promise.all([
      pje.buscarMovimentacoes(url, cred.cpf, cred.senha, processo.numero),
      pje.buscarDadosProcesso(url, cred.cpf, cred.senha, processo.numero),
    ]);
  } else {
    [movimentacoesBrutas, dadosProcesso] = await Promise.all([
      eproc.buscarMovimentacoes(url, cred.cpf, cred.senha, cred.totp_secret, processo.numero),
      eproc.buscarDadosProcesso(url, cred.cpf, cred.senha, cred.totp_secret, processo.numero),
    ]);
  }

  // Atualiza dados do processo
  if (dadosProcesso.vara || dadosProcesso.juiz) {
    await db.execute(
      `UPDATE processos SET vara = COALESCE($1, vara), juiz = COALESCE($2, juiz),
              polo_passivo = COALESCE($3, polo_passivo), habilitados_pje = COALESCE($4, habilitados_pje),
              importado_pje = true, atualizado_em = NOW()
       WHERE id = $5`,
      [dadosProcesso.vara, dadosProcesso.juiz, dadosProcesso.polo_passivo,
       dadosProcesso.habilitados, processoId]
    );

    await resolverSeparacaoSocios(processo, dadosProcesso.habilitados || []);
  }

  // Insere novas movimentações (ignora duplicatas pela constraint UNIQUE)
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
    } catch { /* ignora */ }
  }

  return { processoId, novasMovimentacoes: novasMovs };
}

// Sincroniza todos os processos ativos (chamado pelo worker)
export async function sincronizarTodos() {
  const processos = await db.query(
    `SELECT id FROM processos WHERE status = 'em_andamento' ORDER BY atualizado_em ASC`
  );

  const resultados = [];
  // Sequencial — não dois robôs paralelos (decisão arquitetural)
  for (const { id } of processos) {
    try {
      const r = await sincronizarProcesso(id);
      resultados.push({ ...r, ok: true });
    } catch (err) {
      resultados.push({ processoId: id, ok: false, erro: err.message });
      console.error(`[Sync] Processo ${id}:`, err.message);
    }
  }

  return resultados;
}

// Detecta processo compartilhado e atribui master_responsavel_id correto
async function resolverSeparacaoSocios(processo, habilitados) {
  if (!habilitados.length) return;

  // Busca masters cujos CPFs/OABs batem com os habilitados
  const masters = await db.query(
    `SELECT u.id FROM usuarios u
     JOIN credenciais_tribunal ct ON ct.usuario_id = u.id AND ct.tribunal = $1
     WHERE u.perfil = 'master' AND ct.cpf = ANY($2)`,
    [processo.tribunal, habilitados]
  );

  if (masters.length === 1) {
    // Um habilitado → auto-atribuição
    await db.execute(
      `UPDATE processos SET master_responsavel_id = $1, compartilhado = false WHERE id = $2`,
      [masters[0].id, processo.id]
    );
  } else if (masters.length >= 2) {
    // Dois habilitados → compartilhado
    await db.execute(
      `UPDATE processos SET compartilhado = true WHERE id = $1`,
      [processo.id]
    );
  }
}

function parsearData(str) {
  if (!str) return null;
  // Formatos: dd/mm/aaaa ou aaaa-mm-dd
  const dmy = str.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (dmy) return new Date(`${dmy[3]}-${dmy[2]}-${dmy[1]}`);
  const iso = str.match(/\d{4}-\d{2}-\d{2}/);
  if (iso) return new Date(iso[0]);
  return null;
}
