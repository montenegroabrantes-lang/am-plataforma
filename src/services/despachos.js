// Folhas de despacho vindas da varredura do PJe (skill /varredura-despachos).
// A rotina grava pela API externa (chave com a permissão "despachos"); a equipe só consulta.
import { registrarAuditoria } from '../middleware/auditoria.js';
import { filtroVisibilidade } from '../utils/visibilidade.js';

export const FOLHAS = ['assinaturas', 'gabinete', 'cartorio', 'outros'];
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
  const lidos = Number(corpo.processos_lidos);
  return {
    executada_em: executadaEm,
    corte,
    processos_lidos: Number.isInteger(lidos) && lidos >= 0 ? lidos : 0,
    alertas,
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
        const numeros = [...new Set([...dados.itens.map(i => i.numero), ...dados.acervos.map(a => a.numero)])];
        const linhas = numeros.length
          ? await tx.query('SELECT id, numero FROM processos WHERE numero = ANY($1)', [numeros])
          : [];
        const idPorNumero = new Map(linhas.map(l => [l.numero, l.id]));
        const itens = dados.itens.filter(i => idPorNumero.has(i.numero));
        const ignorados = dados.itens.length - itens.length;

        const varredura = await tx.queryOne(
          `INSERT INTO despachos_varreduras (executada_em, corte, processos_lidos, itens_total, ignorados, alertas, chave_id)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7) RETURNING id`,
          [dados.executada_em, dados.corte, dados.processos_lidos, itens.length, ignorados,
            JSON.stringify(dados.alertas), req.integracao?.id || null],
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

        return { varredura_id: varredura.id, itens: itens.length, ignorados, acervos_atualizados: acervosAtualizados };
      });
      return res.json({ ok: true, ...resultado });
    } catch (err) {
      console.error('[Despachos] Falha ao gravar varredura:', err.message);
      return res.status(500).json({ ok: false, erro: 'Não foi possível gravar a varredura.' });
    }
  };
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
                d.dias_parado, d.concluso, d.ultimo_andamento, d.lido_no_pje
           FROM despachos_itens d
           JOIN processos p ON p.id = d.processo_id
          WHERE d.varredura_id = $1 ${filtroVisibilidade(req.user, 'p')}
          ORDER BY d.folha, d.local, d.bloco, d.dias_parado DESC NULLS LAST, p.numero`,
        [varredura.id],
      );
      return res.json({ ok: true, varredura, itens });
    } catch (err) {
      console.error('[Despachos] Falha ao consultar:', err.message);
      return res.status(500).json({ ok: false, erro: 'Não foi possível carregar as folhas de despacho.' });
    }
  };
}
