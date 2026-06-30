/**
 * Comunica API — PJe/CNJ
 * API pública de publicações e intimações do Diário de Justiça Eletrônico Nacional.
 * Documentação: https://comunicaapi.pje.jus.br/api/v1
 * Sem autenticação — busca por número de OAB + UF.
 */
import axios from 'axios';

const BASE = 'https://comunicaapi.pje.jus.br/api/v1';

function http() {
  return axios.create({
    baseURL: BASE,
    timeout: 30_000,
    validateStatus: () => true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; AM-Plataforma/1.0; juridico)',
      'Accept': 'application/json',
    },
  });
}

/**
 * Busca publicações de uma OAB em um intervalo de datas (paginado).
 * Retorna array com todos os itens encontrados.
 */
export async function buscarPublicacoes({ numeroOab, ufOab, dataInicio, dataFim }) {
  const itens = [];
  let pagina = 1;

  while (true) {
    const resp = await http().get('/comunicacao', {
      params: {
        numeroOab,
        ufOab,
        dataDisponibilizacaoInicio: dataInicio,
        dataDisponibilizacaoFim:    dataFim,
        pagina,
      },
    });

    if (resp.status !== 200 || resp.data?.status !== 'success') {
      console.warn(`[Comunica] Erro pág.${pagina}: HTTP ${resp.status}`, resp.data?.message);
      break;
    }

    const page = resp.data.items || [];
    itens.push(...page);

    // Se retornou menos do que o total esperado, acabou
    if (itens.length >= (resp.data.count || 0) || page.length === 0) break;
    pagina++;
  }

  return itens;
}

/**
 * Sincroniza publicações dos últimos `diasAtras` dias para uma OAB.
 * Insere novas publicações na tabela `publicacoes` e vincula ao processo se número bater.
 * Retorna { inseridas, vinculadas }.
 */
export async function sincronizarPublicacoes(db, numeroOab, ufOab, diasAtras = 3) {
  const hoje    = new Date();
  const inicio  = new Date(hoje);
  inicio.setDate(inicio.getDate() - diasAtras);

  const dataInicio = inicio.toISOString().substring(0, 10);
  const dataFim    = hoje.toISOString().substring(0, 10);

  console.log(`[Comunica] Buscando publicações OAB ${numeroOab}/${ufOab} de ${dataInicio} até ${dataFim}...`);

  let itens;
  try {
    itens = await buscarPublicacoes({ numeroOab, ufOab, dataInicio, dataFim });
  } catch (err) {
    console.error('[Comunica] Falha ao buscar publicações:', err.message);
    return { inseridas: 0, vinculadas: 0 };
  }

  console.log(`[Comunica] ${itens.length} publicações encontradas.`);

  let inseridas  = 0;
  let vinculadas = 0;

  for (const item of itens) {
    if (!item.id) continue;

    // Tenta casar com processo existente pelo número puro
    let processoId = null;
    if (item.numero_processo) {
      const proc = await db.queryOne(
        `SELECT id FROM processos WHERE REGEXP_REPLACE(numero, '[^0-9]', '', 'g') = $1`,
        [item.numero_processo]
      ).catch(() => null);
      if (proc) { processoId = proc.id; vinculadas++; }
    }

    const cancelada = !item.ativo || !!item.data_cancelamento;

    const result = await db.query(
      `INSERT INTO publicacoes
         (id, processo_id, numero_processo_raw, numero_processo, data_disponibilizacao,
          tribunal, tipo_comunicacao, tipo_documento, orgao, texto, link, status, cancelada)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO UPDATE SET
         processo_id  = COALESCE(EXCLUDED.processo_id, publicacoes.processo_id),
         cancelada    = EXCLUDED.cancelada,
         status       = EXCLUDED.status
       RETURNING (xmax = 0) AS inserted`,
      [
        item.id,
        processoId,
        item.numero_processo || '',
        item.numeroprocessocommascara || null,
        item.data_disponibilizacao,
        item.siglaTribunal || null,
        item.tipoComunicacao || null,
        item.tipoDocumento || null,
        item.nomeOrgao || null,
        item.texto || null,
        item.link || null,
        item.status || null,
        cancelada,
      ]
    ).catch(() => []);

    if (result[0]?.inserted) inseridas++;
  }

  console.log(`[Comunica] Sync concluído — ${inseridas} novas, ${vinculadas} vinculadas a processos.`);
  return { inseridas, vinculadas };
}
