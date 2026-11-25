// Peças que faltam no acervo, etapa 1 (24/11/2026). Spec "AM - Spec Pecas que Faltam no Acervo.md" (Drive).
// Cobertura (só leitura): processos ativos e não restritos sem nenhuma peça no acervo, com a tese (pela ligação
// produto → tese), o ente deduzido do polo passivo, a data de distribuição e a última decisão publicada.
// O cadastro retroativo (etapa 2) usa estas mesmas funções para decidir o que pode ser criado sozinho.
// Sem nome de cliente na saída.

import { db } from '../db/index.js';
import { dadosDaDecisao } from './decisoesPublicacoes.js';

const normalizar = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

// Entes reconhecidos no polo passivo. Só devolve ente quando um único aparece; dois entes diferentes (ex.: Estado e
// Município) ou nenhum → null ("a definir"). Autarquia previdenciária estadual fica com o Estado, com detalhe.
const ENTES_POLO = [
  ['municipio-joao-pessoa', /\b(MUNICIPIO DE JOAO PESSOA|PREFEITURA (MUNICIPAL )?DE JOAO PESSOA|PMJP)\b/],
  ['estado-paraiba', /\b(ESTADO DA PARAIBA|GOVERNO DO ESTADO DA PARAIBA|PBPREV|PARAIBA PREVIDENCIA)\b/],
  ['estado-pernambuco', /\b(ESTADO DE PERNAMBUCO|GOVERNO DO ESTADO DE PERNAMBUCO)\b/],
  ['estado-espirito-santo', /\b(ESTADO DO ESPIRITO SANTO)\b/],
  ['inss', /\b(INSTITUTO NACIONAL DO SEGURO SOCIAL|INSS)\b/],
  ['uniao', /\b(UNIAO FEDERAL|UNIAO)\b/],
  ['alpb', /\b(ASSEMBLEIA LEGISLATIVA (DO ESTADO )?DA PARAIBA|ALPB)\b/],
];
export function enteDoPoloPassivo(texto, tribunal = null) {
  const t = normalizar(texto);
  if (!t) return { ente: null, detalhe: null, motivo: 'polo passivo vazio' };
  const achados = new Set(ENTES_POLO.filter(([, re]) => re.test(t)).map(([e]) => e));
  if (!achados.size && /\bMUNICIPIO DE [A-Z]/.test(t) && /TJPB/i.test(String(tribunal ?? ''))) achados.add('municipio-outro-pb');
  if (achados.size === 1) {
    const ente = [...achados][0];
    const detalhe = ente === 'estado-paraiba' && /\b(PBPREV|PARAIBA PREVIDENCIA)\b/.test(t) ? 'PBPREV'
      : ente === 'municipio-outro-pb' ? (t.match(/\bMUNICIPIO DE ([A-Z ]{3,40}?)(?= E | X |$)/)?.[1]?.trim() ?? null) : null;
    return { ente, detalhe, motivo: null };
  }
  return { ente: null, detalhe: null, motivo: achados.size ? 'mais de um ente no polo passivo' : 'ente não reconhecido' };
}

// Sugestão de tese do acervo para um produto (D5: o usuário aprova). Pontua pelas palavras em comum entre o nome do
// produto e o rótulo/slug da tese; no empate vale a tese-mãe (sem `tese_mae`) e depois a de menos palavras sobrando;
// empate que persiste ou nenhuma palavra → sem sugestão. A tese "outros" fica fora.
const VAZIAS = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'X', 'A', 'O', 'EM', 'POR', 'SOBRE', 'NIVEL', 'ACAO', 'CONTRATO', 'TEMPORARIO']);
const palavras = s => new Set(normalizar(s).split(' ').filter(w => w.length > 1 && !VAZIAS.has(w)));
export function sugerirTese(nomeProduto, teses) {
  const p = palavras(nomeProduto);
  if (!p.size) return null;
  const pontos = teses.filter(t => t.slug !== 'outros').map(t => {
    const w = palavras(`${t.label} ${String(t.slug).replace(/-/g, ' ')}`);
    let n = 0; for (const x of p) if (w.has(x)) n++;
    return { slug: t.slug, n, raiz: t.tese_mae ? 1 : 0, extras: w.size - n };
  }).filter(x => x.n > 0).sort((a, b) => b.n - a.n || a.raiz - b.raiz || a.extras - b.extras);
  if (!pontos.length) return null;
  if (pontos[1] && pontos[1].n === pontos[0].n && pontos[1].raiz === pontos[0].raiz && pontos[1].extras === pontos[0].extras) return null;
  return pontos[0].slug;
}

const TIPOS_DECISAO_SQL = `(COALESCE(pu.tipo_documento,'') = '' OR pu.tipo_documento ~* '(senten|ac[oó]rd|ementa|decis)')`;

// Processos sem peça. Filtros: tese (slug), ente, com_decisao (só os que têm decisão publicada), limite.
// "Pronto" = tem tese e ente. A data de distribuição não bloqueia: o cadastro busca no DataJud (decisão do usuário
// em 24/11/2026, D3 revista: nenhum processo tinha a data, por um erro de leitura do formato do DataJud).
export async function listarCobertura({ tese = null, ente = null, comDecisao = false, limite = 500 } = {}, banco = db) {
  const procs = await banco.query(
    `SELECT pr.id, pr.numero, pr.tribunal, pr.grau, pr.vara, pr.polo_passivo, pr.data_distribuicao::date::text AS data_distribuicao,
            pd.nome AS produto, t.slug AS tese, (c.drive_pasta_url IS NOT NULL AND c.drive_pasta_url <> '') AS tem_drive,
            dec.tipo_documento, dec.texto, dec.data_disponibilizacao, dec.tribunal AS pub_tribunal, dec.orgao, dec.id AS publicacao_id
       FROM processos pr
       LEFT JOIN produtos pd ON pd.id = pr.produto_id
       LEFT JOIN teses_acervo t ON t.id = pd.tese_acervo_id
       LEFT JOIN clientes c ON c.id = pr.cliente_id
       LEFT JOIN LATERAL (
         SELECT pu.id, pu.tipo_documento, pu.texto, pu.data_disponibilizacao::text AS data_disponibilizacao, pu.tribunal, pu.orgao
           FROM publicacoes pu
          WHERE (pu.processo_id = pr.id OR pu.numero_processo_raw = REGEXP_REPLACE(pr.numero, '[^0-9]', '', 'g'))
            AND NOT COALESCE(pu.cancelada, false) AND ${TIPOS_DECISAO_SQL}
          ORDER BY pu.data_disponibilizacao DESC, pu.id DESC LIMIT 1) dec ON true
      WHERE pr.status = 'ativo' AND pr.visibilidade = 'normal'
        AND NOT EXISTS (SELECT 1 FROM acervo_pecas a WHERE a.arquivada_em IS NULL
              AND (a.processo_id = pr.id OR REGEXP_REPLACE(COALESCE(a.processo_numero,''), '[^0-9]', '', 'g') = REGEXP_REPLACE(pr.numero, '[^0-9]', '', 'g')))
      ORDER BY dec.data_disponibilizacao DESC NULLS LAST, pr.data_distribuicao DESC NULLS LAST, pr.numero`);
  const todos = procs.map(p => {
    const e = enteDoPoloPassivo(p.polo_passivo, p.tribunal);
    const d = p.publicacao_id ? dadosDaDecisao({ tipo_documento: p.tipo_documento, texto: p.texto, data_disponibilizacao: p.data_disponibilizacao, tribunal: p.pub_tribunal, orgao: p.orgao }) : null;
    const pendencias = [];
    if (!p.tese) pendencias.push(p.produto ? 'produto sem tese ligada' : 'processo sem produto');
    if (!e.ente) pendencias.push(e.motivo);
    return {
      processo_id: p.id, processo_numero: p.numero, tribunal: p.tribunal, grau: p.grau, vara: p.vara,
      produto: p.produto, tese: p.tese, ente: e.ente, ente_detalhe: e.detalhe, data_distribuicao: p.data_distribuicao, tem_drive: Boolean(p.tem_drive),
      decisao: d ? { publicacao_id: String(p.publicacao_id), tipo: d.tipo_decisao, data: d.data, resultado: d.resultado ?? 'a confirmar' } : null,
      pronto: pendencias.length === 0, pendencias,
    };
  });
  const filtrados = todos.filter(x => (!tese || x.tese === tese) && (!ente || x.ente === ente) && (!comDecisao || x.decisao));
  const conta = (lista, chave) => Object.entries(lista.reduce((acc, x) => { const k = x[chave] ?? 'a definir'; acc[k] = (acc[k] || 0) + 1; return acc; }, {}))
    .map(([k, n]) => ({ [chave]: k, processos: n })).sort((a, b) => b.processos - a.processos);
  return {
    total: todos.length,
    com_decisao: todos.filter(x => x.decisao).length,
    prontos: todos.filter(x => x.pronto).length,
    sem_tese: todos.filter(x => !x.tese).length,
    sem_ente: todos.filter(x => !x.ente).length,
    sem_data: todos.filter(x => !x.data_distribuicao).length,
    por_tese: conta(todos, 'tese'),
    por_ente: conta(todos, 'ente'),
    filtrados: filtrados.length,
    processos: filtrados.slice(0, limite),
  };
}

// Produtos com a tese ligada, a sugestão (D5) e quantos processos ativos e sem peça cada um tem.
export async function listarProdutos(banco = db) {
  const [produtos, teses] = await Promise.all([
    banco.query(`SELECT pd.id, pd.nome, pd.ativo, t.slug AS tese,
        (SELECT COUNT(*)::int FROM processos pr WHERE pr.produto_id = pd.id AND pr.status = 'ativo' AND pr.visibilidade = 'normal') AS processos_ativos
       FROM produtos pd LEFT JOIN teses_acervo t ON t.id = pd.tese_acervo_id ORDER BY pd.ativo DESC, pd.nome`),
    banco.query(`SELECT t.slug, t.label, m.slug AS tese_mae FROM teses_acervo t LEFT JOIN teses_acervo m ON m.id = t.tese_mae_id WHERE t.ativo = true`),
  ]);
  return produtos.map(p => ({ ...p, sugestao: p.tese ? null : sugerirTese(p.nome, teses) }));
}

// ── Etapa 2: cadastro retroativo (spec §3.3). Simulação por padrão. ─────────────────────────────────────────
// Para cada processo pronto (tese e ente), cria a peça inicial mínima: título "Inicial (cadastro retroativo)",
// tese do produto (e as mães dela), ente e detalhe pelo polo passivo, tribunal e vara do processo, protocolo = data
// de distribuição (do AM ou, sem ela, do DataJud — e o processo ganha a data), pasta do cliente no Drive,
// retroativa=true. Depois lê as decisões já publicadas desses processos (processarPublicacoes), em ordem de data.
// Sem data no AM nem no DataJud, a peça entra sem data (fica na curadoria "sem data de protocolo").
export const TITULO_RETROATIVA = 'Inicial (cadastro retroativo)';
export const MAX_LOTE_RETROATIVAS = 300;

// Datas de ajuizamento no DataJud, uma consulta por tribunal e lote. Falha de um lote não interrompe: os números
// dele ficam sem data. Devolve Map(numero só com dígitos → 'AAAA-MM-DD') e quantos lotes falharam.
// 25/11/2026: chamado do Railway, o DataJud dá timeout ou 429 e as 4 tentativas de 35 s seguraram a simulação por
// mais de 15 minutos. Aqui vale UMA tentativa de até 10 s por lote e 30 s no total; o que não couber fica sem data
// (as datas podem vir prontas no pedido, buscadas de uma máquina do escritório — `datas`).
export const DATAJUD_CADASTRO = { tentativas: 1, timeoutMs: 10_000, totalMs: 30_000 };
export async function datasNoDataJud(porTribunal, { agora = () => Date.now() } = {}) {
  const { consultarPorNumeros, dividirEmLotes, INDICE } = await import('./tribunal/datajud.js');
  const datas = new Map(); let falhas = 0;
  const fim = agora() + DATAJUD_CADASTRO.totalMs;
  for (const [tribunal, numeros] of porTribunal) {
    if (!INDICE[tribunal]) { falhas++; continue; }
    for (const lote of dividirEmLotes(numeros)) {
      if (agora() >= fim) { falhas++; continue; }
      try {
        const r = await consultarPorNumeros(tribunal, lote, { tentativas: DATAJUD_CADASTRO.tentativas, timeoutMs: DATAJUD_CADASTRO.timeoutMs });
        for (const [n, x] of r.encontrados) if (x?.dados?.data_ajuizamento) datas.set(n, x.dados.data_ajuizamento);
        if (r.falharam?.size) falhas++;
      } catch (e) { falhas++; console.warn(`[Cobertura] DataJud ${tribunal}:`, e.message); }
    }
  }
  return { datas, falhas };
}

// Datas informadas no pedido: { "numero (com ou sem máscara)": "AAAA-MM-DD" } → Map(só dígitos → data). Inválidas ficam fora.
export function datasInformadas(datas) {
  const m = new Map();
  if (!datas || typeof datas !== 'object') return m;
  for (const [n, d] of Object.entries(datas)) {
    const num = String(n).replace(/\D/g, '');
    const dia = String(d ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (num.length !== 20 || !dia) continue;
    const dt = new Date(`${dia[0]}T12:00:00Z`);
    if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== dia[0]) continue;
    m.set(num, dia[0]);
  }
  return m;
}

export async function cadastrarRetroativas({ processos = null, comDecisao = false, tese = null, limite = 100, simular = true, usuarioId = null,
  datas: datasDoPedido = null, buscarDataJud = true, banco = db, buscarDatas = datasNoDataJud, processar = null } = {}) {
  const cob = await listarCobertura({ tese, comDecisao, limite: 100000 }, banco);
  let escolhidos = cob.processos;
  if (processos?.length) { const q = new Set(processos.map(String)); escolhidos = escolhidos.filter(x => q.has(String(x.processo_id))); }
  escolhidos = escolhidos.slice(0, Math.min(limite, MAX_LOTE_RETROATIVAS));
  const prontos = escolhidos.filter(x => x.pronto);
  const precisaDeVoce = escolhidos.filter(x => !x.pronto).map(x => ({ processo_numero: x.processo_numero, produto: x.produto, pendencias: x.pendencias }));

  // Datas que faltam: primeiro as informadas no pedido (DataJud consultado de uma máquina do escritório); o resto,
  // DataJud pelo servidor, com tentativa curta (buscarDataJud=false pula a consulta).
  const informadas = datasInformadas(datasDoPedido);
  const digitos = x => x.processo_numero.replace(/\D/g, '');
  const semData = prontos.filter(x => !x.data_distribuicao && !informadas.has(digitos(x)));
  const porTribunal = new Map();
  for (const x of semData) { const l = porTribunal.get(x.tribunal) ?? []; l.push(digitos(x)); porTribunal.set(x.tribunal, l); }
  const { datas, falhas } = semData.length && buscarDataJud ? await buscarDatas(porTribunal) : { datas: new Map(), falhas: 0 };

  const itens = prontos.map(x => {
    const doPedido = !x.data_distribuicao ? informadas.get(digitos(x)) ?? null : null;
    const doDataJud = !x.data_distribuicao && !doPedido ? datas.get(digitos(x)) ?? null : null;
    return { processo_id: x.processo_id, processo_numero: x.processo_numero, tese: x.tese, ente: x.ente, ente_detalhe: x.ente_detalhe,
      data_protocolo: x.data_distribuicao || doPedido || doDataJud,
      fonte_data: x.data_distribuicao ? 'AM' : doPedido || doDataJud ? 'DataJud' : null, decisao: x.decisao };
  });
  const resumo = {
    simular, selecionados: escolhidos.length, criaria: itens.length, precisa_de_voce: precisaDeVoce.length,
    datas_do_am: itens.filter(i => i.fonte_data === 'AM').length, datas_do_datajud: itens.filter(i => i.fonte_data === 'DataJud').length,
    datas_informadas: itens.filter(i => i.fonte_data === 'DataJud' && informadas.has(digitos(i))).length,
    datajud_consultado: Boolean(semData.length && buscarDataJud),
    sem_data: itens.filter(i => !i.data_protocolo).length, lotes_datajud_com_falha: falhas, com_decisao_publicada: itens.filter(i => i.decisao).length,
  };
  if (simular) return { ...resumo, itens, precisa_de_voce_itens: precisaDeVoce };

  // Gravação: uma transação por processo; confere de novo que ainda não há peça (duas cargas ao mesmo tempo).
  const criadas = [];
  for (const it of itens) {
    const r = await banco.transaction(async tx => {
      const ja = await tx.queryOne(`SELECT 1 AS x FROM acervo_pecas a, processos pr WHERE pr.id=$1 AND a.arquivada_em IS NULL
          AND (a.processo_id=pr.id OR REGEXP_REPLACE(COALESCE(a.processo_numero,''),'[^0-9]','','g')=REGEXP_REPLACE(pr.numero,'[^0-9]','','g')) LIMIT 1`, [it.processo_id]);
      if (ja) return null;
      if (it.fonte_data === 'DataJud') await tx.execute(`UPDATE processos SET data_distribuicao = COALESCE(data_distribuicao, $1::date + TIME '12:00') WHERE id=$2`, [it.data_protocolo, it.processo_id]);
      const p = await tx.queryOne(`SELECT pr.id, pr.numero, pr.tribunal, pr.vara, pr.cliente_id, COALESCE(c.nome,'Sem cliente vinculado') AS cliente_nome, c.drive_pasta_url
          FROM processos pr LEFT JOIN clientes c ON c.id=pr.cliente_id WHERE pr.id=$1 AND pr.visibilidade='normal' AND pr.status='ativo'`, [it.processo_id]);
      if (!p) return null;
      const drive = /^https:\/\//.test(String(p.drive_pasta_url ?? '')) ? p.drive_pasta_url : null;
      const peca = await tx.queryOne(`INSERT INTO acervo_pecas (processo_id, processo_numero, cliente_id, cliente_nome, titulo, tipo_peca, ente, ente_detalhe, tribunal, instancia,
            orgao_julgador, data_protocolo, drive_url, resultado, modelo_aprovado, visibilidade_snapshot, criado_por, retroativa)
          VALUES ($1,$2,$3,$4,$5,'inicial',$6,$7,$8,'1grau',$9,$10,$11,'pendente',false,'normal',$12,true) RETURNING id`,
        [p.id, p.numero, p.cliente_id, p.cliente_nome, TITULO_RETROATIVA, it.ente, it.ente_detalhe, p.tribunal, p.vara, it.data_protocolo, drive, usuarioId]);
      // A tese do produto e as mães dela (a variante sempre leva a mãe).
      await tx.execute(`WITH RECURSIVE acima AS (SELECT id, tese_mae_id FROM teses_acervo WHERE slug=$2
            UNION SELECT t.id, t.tese_mae_id FROM teses_acervo t JOIN acima a ON t.id=a.tese_mae_id)
          INSERT INTO acervo_pecas_teses (peca_id, tese_id) SELECT $1, id FROM acima ON CONFLICT DO NOTHING`, [peca.id, it.tese]);
      return { ...it, peca_id: peca.id };
    });
    if (r) criadas.push(r);
  }
  // Decisões já publicadas nesses processos, em ordem de data (sentença antes do acórdão).
  let decisoes = null;
  if (criadas.length) {
    const ids = (await banco.query(`SELECT pu.id::text AS id FROM publicacoes pu JOIN processos pr ON pr.id = ANY($1::uuid[])
        AND (pu.processo_id = pr.id OR pu.numero_processo_raw = REGEXP_REPLACE(pr.numero,'[^0-9]','','g'))
      WHERE NOT COALESCE(pu.cancelada,false) AND ${TIPOS_DECISAO_SQL} ORDER BY pu.data_disponibilizacao, pu.id`, [criadas.map(c => c.processo_id)])).map(x => x.id);
    if (ids.length) {
      const proc = processar ?? (await import('./processarDecisoesPublicacoes.js')).processarPublicacoes;
      const d = await proc(ids, { usuarioImportacao: usuarioId, banco });
      decisoes = { analisadas: d.analisadas, registradas: d.registradas, ja_registradas: d.ja_registradas, sem_peca: d.sem_peca, erros: d.erros };
    }
  }
  return { ...resumo, criadas: criadas.length, decisoes, itens: criadas, precisa_de_voce_itens: precisaDeVoce };
}
