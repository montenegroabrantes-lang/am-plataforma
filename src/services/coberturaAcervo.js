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
    if (!p.data_distribuicao) pendencias.push('sem data de distribuição');
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
