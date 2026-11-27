// Folhas de despacho vindas da varredura do PJe (skill /varredura-despachos).
// A rotina grava pela API externa (chave com a permissão "despachos"); a equipe só consulta.
import { registrarAuditoria } from '../middleware/auditoria.js';
import { filtroVisibilidade } from '../utils/visibilidade.js';
import { obterAcessoTribunal } from './acessoTribunal.js';
import { numeroPrecatorioValido, registrarAssinados } from './precatorios/formacao.js';

// 'diligencia' = trabalho interno do escritório, exibido separado das folhas do balcão.
export const FOLHAS = ['assinaturas', 'gabinete', 'cartorio', 'outros', 'diligencia'];
const NUMERO_CNJ = /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/;
const MAX_ITENS = 2000;
const MAX_ACERVOS = 5000;

const texto = (valor, max) => {
  if (valor === null || valor === undefined) return null;
  const limpo = String(valor).replace(/\s+/g, ' ').trim();
  return limpo ? limpo.slice(0, max) : null;
};

const dataOuNula = (valor) => {
  if (!valor) return null;
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? undefined : data;
};

// Valida e normaliza o corpo enviado pela rotina. Devolve { erro } ou os dados prontos.
export function validarVarredura(corpo) {
  if (!corpo || typeof corpo !== 'object') return { erro: 'Corpo inválido.' };
  const executadaEm = dataOuNula(corpo.executada_em);
  if (!executadaEm) return { erro: 'executada_em é obrigatório (data ISO).' };
  const corte = dataOuNula(corpo.corte);
  if (corte === undefined) return { erro: 'corte inválido.' };
  if (!Array.isArray(corpo.itens)) return { erro: 'itens deve ser uma lista.' };
  if (corpo.itens.length > MAX_ITENS) return { erro: `No máximo ${MAX_ITENS} itens por varredura.` };
  const acervosEntrada = Array.isArray(corpo.acervos) ? corpo.acervos : [];
  if (acervosEntrada.length > MAX_ACERVOS) return { erro: `No máximo ${MAX_ACERVOS} acervos por varredura.` };

  const itens = [];
  for (const [i, item] of corpo.itens.entries()) {
    const numero = texto(item?.numero, 30);
    if (!numero || !NUMERO_CNJ.test(numero)) return { erro: `Item ${i + 1}: número de processo inválido.` };
    if (!FOLHAS.includes(item.folha)) return { erro: `Item ${i + 1}: folha inválida.` };
    const local = texto(item.local, 80);
    const bloco = texto(item.bloco, 120);
    if (!local || !bloco) return { erro: `Item ${i + 1}: local e bloco são obrigatórios.` };
    const dias = item.dias_parado === null || item.dias_parado === undefined ? null : Number(item.dias_parado);
    if (dias !== null && (!Number.isInteger(dias) || dias < 0 || dias > 20000)) return { erro: `Item ${i + 1}: dias_parado inválido.` };
    const acervo = texto(item.acervo, 40);
    itens.push({
      numero,
      folha: item.folha,
      local,
      acervo,
      bloco,
      observacao: texto(item.observacao, 400),
      dias_parado: dias,
      concluso: texto(item.concluso, 200),
      ultimo_andamento: texto(item.ultimo_andamento, 300),
      lido_no_pje: item.lido_no_pje !== false,
    });
  }

  const acervos = [];
  for (const a of acervosEntrada) {
    const numero = texto(a?.numero, 30);
    const letra = texto(a?.letra, 1);
    if (numero && NUMERO_CNJ.test(numero) && letra && /^[A-Z]$/.test(letra)) acervos.push({ numero, letra });
  }

  const alertas = (Array.isArray(corpo.alertas) ? corpo.alertas : []).map(a => texto(a, 300)).filter(Boolean).slice(0, 50);
  // Processos que saíram das folhas nesta execução, com o motivo (ato registrado no PJe).
  const saidas = [];
  for (const sItem of (Array.isArray(corpo.saidas) ? corpo.saidas : []).slice(0, MAX_ITENS)) {
    const numero = texto(sItem?.numero, 30);
    if (!numero || !NUMERO_CNJ.test(numero)) continue;
    const saida = { numero, de: FOLHAS.includes(sItem.de) ? sItem.de : null, bloco: texto(sItem.bloco, 120), motivo: texto(sItem.motivo, 200) };
    // Número do precatório no TJPB, quando a rotina o leu no ofício requisitório.
    const precatorio = texto(sItem.precatorio_numero, 30);
    if (precatorio && numeroPrecatorioValido(precatorio)) saida.precatorio_numero = precatorio;
    saidas.push(saida);
  }
  const lidos = Number(corpo.processos_lidos);
  return {
    executada_em: executadaEm,
    corte,
    processos_lidos: Number.isInteger(lidos) && lidos >= 0 ? lidos : 0,
    alertas,
    saidas,
    itens,
    acervos,
  };
}

// POST /api/integracoes/v1/despachos/varredura — tudo numa transação.
export function criarGravacaoVarredura(conexao) {
  return async (req, res) => {
    const dados = validarVarredura(req.body);
    if (dados.erro) return res.status(400).json({ ok: false, erro: dados.erro });
    try {
      const resultado = await conexao.transaction(async (tx) => {
        const numeros = [...new Set([...dados.itens.map(i => i.numero), ...dados.acervos.map(a => a.numero), ...dados.saidas.map(x => x.numero)])];
        const linhas = numeros.length
          ? await tx.query('SELECT id, numero FROM processos WHERE numero = ANY($1)', [numeros])
          : [];
        const idPorNumero = new Map(linhas.map(l => [l.numero, l.id]));
        const itens = dados.itens.filter(i => idPorNumero.has(i.numero));
        const ignorados = dados.itens.length - itens.length;

        const varredura = await tx.queryOne(
          `INSERT INTO despachos_varreduras (executada_em, corte, processos_lidos, itens_total, ignorados, alertas, chave_id, saidas)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb) RETURNING id`,
          [dados.executada_em, dados.corte, dados.processos_lidos, itens.length, ignorados,
            JSON.stringify(dados.alertas), req.integracao?.id || null,
            JSON.stringify(dados.saidas.filter(x => idPorNumero.has(x.numero)))],
        );

        if (itens.length) {
          await tx.execute(
            `INSERT INTO despachos_itens
               (varredura_id, processo_id, folha, local, acervo, bloco, observacao, dias_parado, concluso, ultimo_andamento, lido_no_pje)
             SELECT $1, x.processo_id, x.folha, x.local, x.acervo, x.bloco, x.observacao, x.dias_parado, x.concluso, x.ultimo_andamento, x.lido_no_pje
               FROM jsonb_to_recordset($2::jsonb) AS x(processo_id uuid, folha text, local text, acervo text, bloco text,
                    observacao text, dias_parado int, concluso text, ultimo_andamento text, lido_no_pje boolean)`,
            [varredura.id, JSON.stringify(itens.map(i => ({ ...i, processo_id: idPorNumero.get(i.numero), numero: undefined })))],
          );
        }

        const acervos = dados.acervos.filter(a => idPorNumero.has(a.numero));
        let acervosAtualizados = 0;
        if (acervos.length) {
          const r = await tx.execute(
            `UPDATE processos p SET acervo = x.letra, acervo_origem = 'pje', acervo_lido_em = $2
               FROM jsonb_to_recordset($1::jsonb) AS x(numero text, letra text)
              WHERE p.numero = x.numero AND p.acervo IS DISTINCT FROM x.letra`,
            [JSON.stringify(acervos), dados.executada_em],
          );
          acervosAtualizados = r.rowCount || 0;
        }

        await registrarAuditoria({
          acao: 'gravar_varredura_despachos',
          entidade: 'despachos_varredura',
          entidadeId: varredura.id,
          valorDepois: { itens: itens.length, ignorados, acervos_atualizados: acervosAtualizados, chave_id: req.integracao?.id || null },
          ip: req._ip,
        }, tx);

        // Juiz assinou o precatório: a ficha nasce sozinha, ligada ao processo de origem.
        const assinados = await registrarAssinados(tx, dados.saidas, { ip: req._ip });

        return { varredura_id: varredura.id, itens: itens.length, ignorados, acervos_atualizados: acervosAtualizados, ...assinados };
      });
      return res.json({ ok: true, ...resultado });
    } catch (err) {
      console.error('[Despachos] Falha ao gravar varredura:', err.message);
      return res.status(500).json({ ok: false, erro: 'Não foi possível gravar a varredura.' });
    }
  };
}

// "O que mudou hoje": compara a última varredura com a última do dia anterior (horário de Brasília).
// Mudança de folha, entrada nova e saída (com o motivo gravado pela rotina, quando houver).
export function diferencas(anteriores, atuais, saidasDoDia = []) {
  // Um processo pode estar em mais de uma folha (balcão e diligência): compara o conjunto de folhas.
  const agrupar = lista => {
    const m = new Map();
    for (const i of lista) {
      if (!m.has(i.processo_id)) m.set(i.processo_id, { numero: i.numero, folhas: new Map() });
      m.get(i.processo_id).folhas.set(i.folha, i.bloco);
    }
    return m;
  };
  const antes = agrupar(anteriores), depois = agrupar(atuais);
  const motivo = new Map(saidasDoDia.map(s => [s.numero, s.motivo]));
  const lista = [];
  for (const id of new Set([...antes.keys(), ...depois.keys()])) {
    const a = antes.get(id), d = depois.get(id);
    const saiu = a ? [...a.folhas.keys()].filter(f => !d?.folhas.has(f)) : [];
    const entrou = d ? [...d.folhas.keys()].filter(f => !a?.folhas.has(f)) : [];
    const numero = (d || a).numero;
    entrou.forEach((para, k) => {
      const de = saiu[k] ?? null;
      lista.push({ processo_id: id, numero, de, para, ato: d.folhas.get(para) });
    });
    saiu.slice(entrou.length).forEach(de => {
      lista.push({ processo_id: id, numero, de, para: 'sai', ato: motivo.get(numero) || a.folhas.get(de) });
    });
  }
  return lista;
}

async function calcularMudancas(conexao, varredura, itensAtuais, user) {
  const anterior = await conexao.queryOne(
    `SELECT id FROM despachos_varreduras
      WHERE (executada_em AT TIME ZONE 'America/Sao_Paulo')::date < ($1::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
      ORDER BY executada_em DESC, criado_em DESC LIMIT 1`,
    [varredura.executada_em],
  );
  if (!anterior) return [];
  const [anteriores, saidas] = await Promise.all([
    conexao.query(
      `SELECT p.id AS processo_id, p.numero, d.folha, d.bloco
         FROM despachos_itens d JOIN processos p ON p.id = d.processo_id
        WHERE d.varredura_id = $1 ${filtroVisibilidade(user, 'p')}`,
      [anterior.id],
    ),
    conexao.query(
      `SELECT s->>'numero' AS numero, s->>'motivo' AS motivo
         FROM despachos_varreduras v, jsonb_array_elements(v.saidas) s
        WHERE (v.executada_em AT TIME ZONE 'America/Sao_Paulo')::date = ($1::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date`,
      [varredura.executada_em],
    ),
  ]);
  return diferencas(anteriores, itensAtuais, saidas);
}

// GET /api/despachos — última varredura, para a tela de consulta.
export function criarConsultaDespachos(conexao) {
  return async (req, res) => {
    try {
      const varredura = await conexao.queryOne(
        `SELECT id, executada_em, corte, processos_lidos, itens_total, ignorados, alertas
           FROM despachos_varreduras ORDER BY executada_em DESC, criado_em DESC LIMIT 1`,
      );
      if (!varredura) return res.json({ ok: true, varredura: null, itens: [] });
      const itens = await conexao.query(
        `SELECT p.id AS processo_id, p.numero, d.folha, d.local, d.acervo, d.bloco, d.observacao,
                d.dias_parado, d.concluso, d.ultimo_andamento, d.lido_no_pje, p.tribunal, p.grau, p.pje_id_processo, p.polo_passivo
           FROM despachos_itens d
           JOIN processos p ON p.id = d.processo_id
          WHERE d.varredura_id = $1 ${filtroVisibilidade(req.user, 'p')}
          ORDER BY d.folha, d.local, d.bloco, d.dias_parado DESC NULLS LAST, p.numero`,
        [varredura.id],
      );
      // Botão "abrir no PJe" em cada linha: mesmo destino da tela do processo.
      for (const i of itens) { i.acesso_tribunal = obterAcessoTribunal(i); delete i.tribunal; delete i.grau; delete i.pje_id_processo; }
      const mudancas = await calcularMudancas(conexao, varredura, itens, req.user);
      return res.json({ ok: true, varredura, itens, mudancas });
    } catch (err) {
      console.error('[Despachos] Falha ao consultar:', err.message);
      return res.status(500).json({ ok: false, erro: 'Não foi possível carregar as folhas de despacho.' });
    }
  };
}

// ── Arquivos da varredura (PDF das folhas e planilhas) ─────────────────────────
const TAMANHO_MAXIMO = 5 * 1024 * 1024;
const DIAS_GUARDADOS = 30;
const NOME_ARQUIVO = /^[\p{L}\p{N} ._()-]{3,120}\.(pdf|xlsx)$/u;
export const MIME = { pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Valida nome, tipo e conteúdo (assinatura do arquivo) antes de gravar.
export function validarArquivo(corpo) {
  const varreduraId = String(corpo?.varredura_id || '');
  if (!UUID.test(varreduraId)) return { erro: 'varredura_id inválido.' };
  const nome = String(corpo?.nome || '').trim();
  if (!NOME_ARQUIVO.test(nome)) return { erro: 'Nome de arquivo inválido (só .pdf ou .xlsx).' };
  const tipo = nome.toLowerCase().endsWith('.pdf') ? 'pdf' : 'xlsx';
  const base64 = String(corpo?.conteudo_base64 || '');
  if (!base64 || !/^[A-Za-z0-9+/=\s]+$/.test(base64)) return { erro: 'Conteúdo inválido.' };
  const conteudo = Buffer.from(base64, 'base64');
  if (!conteudo.length || conteudo.length > TAMANHO_MAXIMO) return { erro: 'Arquivo vazio ou maior que 5 MB.' };
  const assinatura = conteudo.subarray(0, 4).toString('latin1');
  if (tipo === 'pdf' && assinatura !== '%PDF') return { erro: 'O conteúdo não é um PDF.' };
  if (tipo === 'xlsx' && assinatura !== 'PK\u0003\u0004') return { erro: 'O conteúdo não é uma planilha .xlsx.' };
  return { varreduraId, nome, tipo, conteudo };
}

// POST /api/integracoes/v1/despachos/arquivos — um arquivo por chamada.
export function criarEnvioArquivo(conexao) {
  return async (req, res) => {
    const dados = validarArquivo(req.body);
    if (dados.erro) return res.status(400).json({ ok: false, erro: dados.erro });
    try {
      const existe = await conexao.queryOne('SELECT id FROM despachos_varreduras WHERE id = $1', [dados.varreduraId]);
      if (!existe) return res.status(404).json({ ok: false, erro: 'Varredura não encontrada.' });
      const linha = await conexao.queryOne(
        `INSERT INTO despachos_arquivos (varredura_id, nome, tipo, tamanho, conteudo)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (varredura_id, nome) DO UPDATE SET tipo = EXCLUDED.tipo, tamanho = EXCLUDED.tamanho, conteudo = EXCLUDED.conteudo, criado_em = NOW()
         RETURNING id`,
        [dados.varreduraId, dados.nome, dados.tipo, dados.conteudo.length, dados.conteudo],
      );
      await conexao.execute(`DELETE FROM despachos_arquivos WHERE criado_em < NOW() - INTERVAL '${DIAS_GUARDADOS} days'`);
      return res.json({ ok: true, id: linha.id, nome: dados.nome, tamanho: dados.conteudo.length });
    } catch (err) {
      console.error('[Despachos] Falha ao gravar arquivo:', err.message);
      return res.status(500).json({ ok: false, erro: 'Não foi possível gravar o arquivo.' });
    }
  };
}

// GET /api/despachos/arquivos — arquivos da varredura mais recente que tenha arquivos.
export function criarListaArquivos(conexao) {
  return async (_req, res) => {
    try {
      const arquivos = await conexao.query(
        `SELECT a.id, a.nome, a.tipo, a.tamanho, a.criado_em, v.executada_em
           FROM despachos_arquivos a
           JOIN despachos_varreduras v ON v.id = a.varredura_id
          WHERE a.varredura_id = (
                SELECT a2.varredura_id FROM despachos_arquivos a2
                  JOIN despachos_varreduras v2 ON v2.id = a2.varredura_id
                 ORDER BY v2.executada_em DESC, a2.criado_em DESC LIMIT 1)
          ORDER BY a.tipo, a.nome`,
      );
      return res.json({ ok: true, arquivos });
    } catch (err) {
      console.error('[Despachos] Falha ao listar arquivos:', err.message);
      return res.status(500).json({ ok: false, erro: 'Não foi possível listar os arquivos.' });
    }
  };
}

// GET /api/despachos/arquivos/:id — download (registra na auditoria).
export function criarDownloadArquivo(conexao, auditar = registrarAuditoria) {
  return async (req, res) => {
    if (!UUID.test(String(req.params.id || ''))) return res.status(400).json({ ok: false, erro: 'Arquivo inválido.' });
    try {
      const arq = await conexao.queryOne('SELECT id, nome, tipo, conteudo FROM despachos_arquivos WHERE id = $1', [req.params.id]);
      if (!arq) return res.status(404).json({ ok: false, erro: 'Arquivo não encontrado.' });
      await auditar({ usuarioId: req.user?.id, acao: 'baixar_arquivo_despachos', entidade: 'despachos_arquivo', entidadeId: arq.id, valorDepois: { nome: arq.nome }, ip: req._ip });
      res.setHeader('Content-Type', MIME[arq.tipo]);
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(arq.nome)}`);
      res.setHeader('Cache-Control', 'no-store');
      return res.send(arq.conteudo);
    } catch (err) {
      console.error('[Despachos] Falha no download:', err.message);
      return res.status(500).json({ ok: false, erro: 'Não foi possível baixar o arquivo.' });
    }
  };
}

// ── Métricas (aba "Métricas" da tela Despachos) ────────────────────────────────
// O retrato do dia sai dos itens da última varredura (GET /api/despachos). Aqui fica a evolução,
// calculada a partir da última varredura de cada dia (horário de Brasília). Só leitura.
export const PERIODOS_METRICAS = [7, 30, 90];
const UM_DIA = 24 * 60 * 60 * 1000;
const diaUTC = dia => Date.UTC(+dia.slice(0, 4), +dia.slice(5, 7) - 1, +dia.slice(8, 10));
const entreDias = (a, b) => Math.round((diaUTC(b) - diaUTC(a)) / UM_DIA);
// Segunda-feira da semana do dia (AAAA-MM-DD).
export function inicioDaSemana(dia) {
  const t = diaUTC(dia);
  const semana = (new Date(t).getUTCDay() + 6) % 7;
  return new Date(t - semana * UM_DIA).toISOString().slice(0, 10);
}
const mediana = lista => {
  const v = [...lista].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
};

// dias: [{ dia: 'AAAA-MM-DD', itens: [{ processo_id, folha, local, bloco }] }], do mais antigo ao mais novo.
export function evolucaoDespachos(dias) {
  const serie = dias.map(({ dia, itens }) => {
    const linha = { dia };
    for (const f of FOLHAS) linha[f] = 0;
    for (const i of itens) linha[i.folha] += 1;
    return linha;
  });

  // Entradas, saídas e trocas de folha entre um dia e o seguinte.
  const fluxo = [];
  for (let k = 1; k < dias.length; k++) {
    const comNumero = l => l.map(i => ({ ...i, numero: i.processo_id }));
    const d = diferencas(comNumero(dias[k - 1].itens), comNumero(dias[k].itens));
    fluxo.push({
      dia: dias[k].dia,
      entraram: d.filter(x => x.de === null).length,
      sairam: d.filter(x => x.para === 'sai').length,
      mudaram: d.filter(x => x.de !== null && x.para !== 'sai').length,
    });
  }

  // Tempo até sair da folha, por ato de entrada. Quem já estava no 1º dia do período não entra
  // na conta (não se sabe quando entrou).
  const abertos = new Map();
  const duracoes = new Map();
  const saidasPorSemana = [];
  dias.forEach(({ dia, itens }, k) => {
    const hoje = new Map(itens.map(i => [`${i.processo_id}|${i.folha}`, i]));
    for (const [chave, aberto] of abertos) {
      if (hoje.has(chave)) continue;
      abertos.delete(chave);
      saidasPorSemana.push({ semana: inicioDaSemana(dia), local: aberto.local, folha: aberto.folha });
      if (aberto.conhecido) {
        if (!duracoes.has(aberto.bloco)) duracoes.set(aberto.bloco, []);
        duracoes.get(aberto.bloco).push(entreDias(aberto.desde, dia));
      }
    }
    for (const [chave, i] of hoje) {
      if (!abertos.has(chave)) abertos.set(chave, { desde: dia, conhecido: k > 0, bloco: i.bloco, local: i.local, folha: i.folha });
    }
  });
  const tempoAteSair = [...duracoes.entries()]
    .map(([ato, v]) => ({ ato, mediana: mediana(v), saidas: v.length }))
    .sort((a, b) => b.saidas - a.saidas || a.ato.localeCompare(b.ato, 'pt-BR'));

  // Resolução por vara, por semana (folhas do balcão): saíram ÷ estiveram na folha na semana.
  const presentes = new Map();
  for (const { dia, itens } of dias) {
    const semana = inicioDaSemana(dia);
    for (const i of itens) {
      if (i.folha === 'diligencia') continue;
      const chave = `${semana}|${i.local}`;
      if (!presentes.has(chave)) presentes.set(chave, new Set());
      presentes.get(chave).add(`${i.processo_id}|${i.folha}`);
    }
  }
  const resolucao = [...presentes.entries()].map(([chave, conjunto]) => {
    const [semana, vara] = chave.split('|');
    const saidas = saidasPorSemana.filter(x => x.semana === semana && x.local === vara && x.folha !== 'diligencia').length;
    return { semana, vara, presentes: conjunto.size, saidas };
  }).sort((a, b) => a.semana.localeCompare(b.semana) || a.vara.localeCompare(b.vara, 'pt-BR'));

  return { serie, fluxo, tempoAteSair, resolucao };
}

// GET /api/despachos/metricas?dias=30&vara=1º JEFP
export function criarMetricasDespachos(conexao) {
  return async (req, res) => {
    const periodo = Number(req.query?.dias || 30);
    if (!PERIODOS_METRICAS.includes(periodo)) return res.status(400).json({ ok: false, erro: 'Período inválido (7, 30 ou 90 dias).' });
    const vara = texto(req.query?.vara, 80);
    try {
      const varreduras = await conexao.query(
        `SELECT DISTINCT ON (dia) id, dia::text AS dia
           FROM (SELECT id, executada_em, criado_em, (executada_em AT TIME ZONE 'America/Sao_Paulo')::date AS dia
                   FROM despachos_varreduras
                  WHERE executada_em >= NOW() - make_interval(days => $1)) v
          ORDER BY dia, executada_em DESC, criado_em DESC`,
        [periodo],
      );
      if (!varreduras.length) return res.json({ ok: true, periodo, dias: 0, serie: [], fluxo: [], tempoAteSair: [], resolucao: [] });
      const params = [varreduras.map(v => v.id)];
      if (vara) params.push(vara);
      const itens = await conexao.query(
        `SELECT d.varredura_id, d.processo_id, d.folha, d.local, d.bloco
           FROM despachos_itens d JOIN processos p ON p.id = d.processo_id
          WHERE d.varredura_id = ANY($1::uuid[]) ${vara ? 'AND d.local = $2' : ''} ${filtroVisibilidade(req.user, 'p')}`,
        params,
      );
      const porVarredura = new Map(varreduras.map(v => [v.id, []]));
      for (const i of itens) porVarredura.get(i.varredura_id)?.push(i);
      const dias = varreduras.map(v => ({ dia: v.dia, itens: porVarredura.get(v.id) }));
      return res.json({ ok: true, periodo, dias: dias.length, ...evolucaoDespachos(dias) });
    } catch (err) {
      console.error('[Despachos] Falha nas métricas:', err.message);
      return res.status(500).json({ ok: false, erro: 'Não foi possível calcular as métricas.' });
    }
  };
}
