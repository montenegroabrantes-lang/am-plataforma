// Acompanhamento do 2º grau pelo PJe TJPB 2º grau (rotina /varredura-2grau, com o advogado logado).
// A rotina lê precatórios (em segredo de justiça) e os processos do escritório em recurso, e grava
// pela API externa (chave com a permissão "despachos"). O sistema guarda só data e título do
// andamento. Precatório que não aparece na pesquisa do PJe fica como "sem acesso".
import { registrarAuditoria } from '../middleware/auditoria.js';

const NUMERO_CNJ = /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_PRECATORIOS = 300;
export const MAX_RECURSOS = 500;
export const MAX_ANDAMENTOS = 200;
export const PREFIXO_RECURSO = '2º grau: ';

const texto = (valor, max) => {
  if (valor === null || valor === undefined) return null;
  const limpo = String(valor).replace(/\s+/g, ' ').trim();
  return limpo ? limpo.slice(0, max) : null;
};

// Andamentos válidos, sem repetição. O que vier torto é descartado (não derruba a leitura inteira).
function lerAndamentos(lista) {
  const vistos = new Set(); const saida = [];
  for (const a of Array.isArray(lista) ? lista.slice(0, MAX_ANDAMENTOS) : []) {
    const data = texto(a?.data, 10); const t = texto(a?.texto, 200);
    if (!data || !DATA.test(data) || Number.isNaN(new Date(`${data}T12:00:00Z`).getTime()) || !t) continue;
    const chave = `${data}|${t}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave); saida.push({ data, texto: t });
  }
  return saida;
}

// Valida e normaliza o corpo enviado pela rotina. Devolve { erro } ou os dados prontos.
export function validarLeitura(corpo) {
  if (!corpo || typeof corpo !== 'object') return { erro: 'Corpo inválido.' };
  const executada = corpo.executada_em ? new Date(corpo.executada_em) : null;
  if (!executada || Number.isNaN(executada.getTime())) return { erro: 'executada_em é obrigatório (data ISO).' };
  const entradaP = corpo.precatorios ?? []; const entradaR = corpo.recursos ?? [];
  if (!Array.isArray(entradaP) || !Array.isArray(entradaR)) return { erro: 'precatorios e recursos devem ser listas.' };
  if (entradaP.length > MAX_PRECATORIOS) return { erro: `No máximo ${MAX_PRECATORIOS} precatórios por leitura.` };
  if (entradaR.length > MAX_RECURSOS) return { erro: `No máximo ${MAX_RECURSOS} recursos por leitura.` };

  const precatorios = []; const recursos = []; const numeros = new Set();
  for (const [i, p] of entradaP.entries()) {
    const numero = texto(p?.numero, 30);
    if (!numero || !NUMERO_CNJ.test(numero)) return { erro: `Precatório ${i + 1}: número inválido.` };
    if (typeof p.acessivel !== 'boolean') return { erro: `Precatório ${i + 1}: informe "acessivel" (verdadeiro ou falso).` };
    if (numeros.has(`p${numero}`)) continue;
    numeros.add(`p${numero}`);
    precatorios.push({ numero, acessivel: p.acessivel, classe: texto(p.classe, 80), orgao: texto(p.orgao, 120), relator: texto(p.relator, 120),
      andamentos: p.acessivel ? lerAndamentos(p.andamentos) : [] });
  }
  for (const [i, r] of entradaR.entries()) {
    const numero = texto(r?.numero, 30);
    if (!numero || !NUMERO_CNJ.test(numero)) return { erro: `Recurso ${i + 1}: número inválido.` };
    if (numeros.has(`r${numero}`)) continue;
    numeros.add(`r${numero}`);
    recursos.push({ numero, andamentos: lerAndamentos(r.andamentos) });
  }
  return { executada_em: executada, precatorios, recursos };
}

// GET — o que a rotina deve ler: todos os precatórios cadastrados e os processos ativos em recurso
// (situação "em recurso", marcados como 2º grau, ou listados em "2º grau e Turmas" na última folha).
export function criarBaseSegundoGrau(conexao) {
  return async (_req, res) => {
    const precatorios = await conexao.query(`SELECT numero FROM precatorios ORDER BY numero`);
    const recursos = await conexao.query(
      `SELECT DISTINCT p.numero
         FROM processos p
        WHERE p.status = 'ativo'
          AND (p.situacao_atual = 'em_recurso' OR p.grau::text = '2'
               OR EXISTS (SELECT 1 FROM despachos_itens i
                           WHERE i.processo_id = p.id AND i.local = '2º grau e Turmas'
                             AND i.varredura_id = (SELECT id FROM despachos_varreduras ORDER BY criado_em DESC LIMIT 1)))
        ORDER BY p.numero`);
    res.json({ ok: true, precatorios: precatorios.map(l => l.numero), recursos: recursos.map(l => l.numero) });
  };
}

export function criarGravacaoSegundoGrau(conexao, { auditar = registrarAuditoria } = {}) {
  return async (req, res) => {
    const dados = validarLeitura(req.body);
    if (dados.erro) return res.status(400).json({ ok: false, erro: dados.erro });
    try {
      const resultado = await conexao.transaction(async (tx) => {
        const fichas = dados.precatorios.length
          ? await tx.query('SELECT id, numero, habilitacao_ramon FROM precatorios WHERE numero = ANY($1)', [dados.precatorios.map(p => p.numero)]) : [];
        const fichaPorNumero = new Map(fichas.map(f => [f.numero, f]));
        const processos = dados.recursos.length
          ? await tx.query('SELECT id, numero FROM processos WHERE numero = ANY($1)', [dados.recursos.map(r => r.numero)]) : [];
        const processoPorNumero = new Map(processos.map(p => [p.numero, p.id]));

        let lidos = 0, semAcesso = 0, novos = 0, liberados = 0, ignorados = 0;
        for (const p of dados.precatorios) {
          const ficha = fichaPorNumero.get(p.numero);
          if (!ficha) { ignorados += 1; continue; }
          await tx.execute(
            `UPDATE precatorios SET pje_acesso = $2, pje_lido_em = $3,
                    pje_classe = COALESCE($4, pje_classe), pje_orgao = COALESCE($5, pje_orgao), pje_relator = COALESCE($6, pje_relator)
              WHERE id = $1`, [ficha.id, p.acessivel ? 'ok' : 'sem_acesso', dados.executada_em, p.classe, p.orgao, p.relator]);
          if (!p.acessivel) { semAcesso += 1; continue; }
          lidos += 1;
          // A rotina roda com o acesso do Dr. Ramon: se os autos abriram, a habilitação dele foi liberada.
          if (ficha.habilitacao_ramon !== 'habilitado') {
            await tx.execute(`UPDATE precatorios SET habilitacao_ramon = 'habilitado', atualizado_em = NOW() WHERE id = $1`, [ficha.id]);
            await tx.execute(`INSERT INTO precatorio_eventos (precatorio_id, campo, de, para) VALUES ($1, 'habilitacao_ramon', $2, 'habilitado')`, [ficha.id, ficha.habilitacao_ramon]);
            liberados += 1;
          }
          if (p.andamentos.length) {
            const r = await tx.execute(
              `INSERT INTO precatorio_andamentos (precatorio_id, data, texto)
               SELECT $1, x.data, x.texto FROM jsonb_to_recordset($2::jsonb) AS x(data date, texto text)
               ON CONFLICT (precatorio_id, data, texto) DO NOTHING`, [ficha.id, JSON.stringify(p.andamentos)]);
            novos += r?.rowCount || 0;
          }
        }

        let recursosLidos = 0, movimentos = 0;
        for (const rec of dados.recursos) {
          const processoId = processoPorNumero.get(rec.numero);
          if (!processoId) { ignorados += 1; continue; }
          recursosLidos += 1;
          if (!rec.andamentos.length) continue;
          const linhas = rec.andamentos.map(a => ({ data: a.data, texto: `${PREFIXO_RECURSO}${a.texto}`.slice(0, 220) }));
          // Meio-dia de Brasília: o PJe dá só o dia, e assim a data não muda de dia em nenhum fuso.
          const r = await tx.execute(
            `INSERT INTO movimentacoes (processo_id, data_movimentacao, texto, origem)
             SELECT $1, (x.data::timestamp + INTERVAL '12 hours') AT TIME ZONE 'America/Sao_Paulo', x.texto, 'pje_2g'
               FROM jsonb_to_recordset($2::jsonb) AS x(data date, texto text)
             ON CONFLICT DO NOTHING`, [processoId, JSON.stringify(linhas)]);
          if (r?.rowCount) { movimentos += r.rowCount; await tx.execute(`UPDATE processos SET atualizado_em = NOW() WHERE id = $1`, [processoId]); }
        }

        const varredura = await tx.queryOne(
          `INSERT INTO segundo_grau_varreduras (executada_em, precatorios_lidos, precatorios_sem_acesso, recursos_lidos, andamentos_novos, ignorados, chave_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [dados.executada_em, lidos, semAcesso, recursosLidos, novos + movimentos, ignorados, req.integracao?.id || null]);
        const resumo = { precatorios_lidos: lidos, precatorios_sem_acesso: semAcesso, andamentos_de_precatorio: novos, habilitacoes_liberadas: liberados,
          recursos_lidos: recursosLidos, movimentacoes_de_recurso: movimentos, ignorados };
        await auditar({ acao: 'gravar_varredura_2grau', entidade: 'segundo_grau_varredura', entidadeId: varredura.id,
          valorDepois: { ...resumo, chave_id: req.integracao?.id || null }, ip: req._ip }, tx);
        return { varredura_id: varredura.id, ...resumo };
      });
      return res.json({ ok: true, ...resultado });
    } catch (err) {
      console.error('[2º grau] Falha ao gravar a leitura:', err.message);
      return res.status(500).json({ ok: false, erro: 'Não foi possível gravar a leitura do 2º grau.' });
    }
  };
}
