// Baixa de prazos (versão 2.0). Regra decidida pelo Dr. Ramon em 26/11/2026:
//   • Audiência: a tarefa fecha sozinha no dia seguinte à data.
//   • Demais prazos: o aviso do tribunal diz só "Juntada de Petição", sem dizer QUEM juntou.
//     Por isso a movimentação sozinha NÃO fecha o prazo — vira sugestão ("petição juntada em
//     tal data") para a pessoa confirmar com um clique. Só fecha sozinho quando há também uma
//     peça nossa no acervo, do mesmo processo, feita depois da publicação e antes da juntada.
// Nenhuma baixa automática apaga o evento da agenda do Google.
export const TOLERANCIA_DIAS = 5; // juntada ou peça contam até este tanto de dias depois do prazo

const DIA = 86_400_000;
const soData = v => { const d = v ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) : null; };
const br = d => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const ehAudiencia = descricao => semAcento(descricao).trim().startsWith('audiencia');
export const ehJuntadaDePeticao = texto => semAcento(texto).includes('peticao');

// tarefa: { descricao, prazo_data }   inicio: data da publicação (ou da criação da tarefa)
// juntadas: [{ data, texto }]         pecas: [{ titulo, tipo_peca, criado_em }]
export function avaliarPrazo({ tarefa, inicio, juntadas = [], pecas = [], hoje = new Date() }) {
  const dia = soData(hoje);
  const prazo = soData(tarefa?.prazo_data);
  const desde = soData(inicio);
  if (!prazo) return { acao: 'nada' };

  if (ehAudiencia(tarefa.descricao)) {
    return prazo < dia
      ? { acao: 'concluir', motivo: 'audiencia', nota: `Baixa automática: a data da audiência (${br(prazo)}) passou.` }
      : { acao: 'nada' };
  }
  if (!desde) return { acao: 'nada' };

  const limite = new Date(prazo.getTime() + TOLERANCIA_DIAS * DIA);
  // Depois da publicação (no mesmo dia não conta: costuma ser o ato que gerou a intimação).
  const validas = juntadas.map(j => ({ ...j, dia: soData(j.data) }))
    .filter(j => j.dia && ehJuntadaDePeticao(j.texto) && j.dia > desde && j.dia <= limite)
    .sort((a, b) => a.dia - b.dia);
  if (!validas.length) return { acao: 'nada' };

  const nossas = pecas.map(p => ({ ...p, dia: soData(p.criado_em) }))
    .filter(p => p.dia && p.tipo_peca !== 'inicial' && p.dia >= desde && p.dia <= limite)
    .sort((a, b) => a.dia - b.dia);
  for (const peca of nossas) {
    const juntada = validas.find(j => j.dia >= peca.dia);
    if (juntada) {
      return { acao: 'concluir', motivo: 'peca', data: juntada.dia,
        nota: `Baixa automática: peça "${peca.titulo || 'sem título'}" no acervo e petição juntada em ${br(juntada.dia)}.` };
    }
  }
  const ultima = validas[validas.length - 1];
  return { acao: 'sugerir', data: ultima.dia, texto: `Petição juntada em ${br(ultima.dia)}`, quantas: validas.length };
}

// Carrega do banco o que a regra precisa e avalia cada tarefa. Só leitura.
// tarefas: [{ id, descricao, prazo_data, processo_id, inicio }]  →  Map(id → avaliação)
export async function avaliarTarefas({ banco, tarefas, hoje = new Date() }) {
  const resultado = new Map();
  const comProcesso = tarefas.filter(t => t.processo_id && !ehAudiencia(t.descricao));
  const processos = [...new Set(comProcesso.map(t => t.processo_id))];
  let juntadas = [], pecas = [];
  if (processos.length) {
    const inicios = comProcesso.map(t => soData(t.inicio)).filter(Boolean);
    const desde = inicios.length ? new Date(Math.min(...inicios.map(d => d.getTime()))) : new Date(0);
    juntadas = await banco.query(
      `SELECT processo_id, data_movimentacao AS data, texto FROM movimentacoes
        WHERE processo_id = ANY($1::uuid[]) AND data_movimentacao >= $2 AND texto ILIKE '%peti%'`, [processos, desde]);
    pecas = await banco.query(
      `SELECT processo_id, titulo, tipo_peca, criado_em FROM acervo_pecas
        WHERE processo_id = ANY($1::uuid[]) AND criado_em >= $2 AND arquivada_em IS NULL AND COALESCE(retroativa, false) = false`, [processos, desde]);
  }
  for (const t of tarefas) {
    resultado.set(t.id, avaliarPrazo({ tarefa: t, inicio: t.inicio, hoje,
      juntadas: juntadas.filter(j => j.processo_id === t.processo_id),
      pecas: pecas.filter(p => p.processo_id === t.processo_id) }));
  }
  return resultado;
}

const SQL_PRAZOS_ABERTOS = `
  SELECT t.id, t.descricao, t.prazo_data, t.processo_id, COALESCE(pb.data_disponibilizacao, t.criado_em::date) AS inicio
    FROM tarefas t LEFT JOIN publicacoes pb ON pb.id = t.publicacao_id
   WHERE t.tipo = 'prazo' AND t.status = 'pendente'`;

// Rotina diária. Com `simular: true` só devolve o que faria, sem gravar nada.
export async function executarBaixaAutomatica({ banco, agora = () => new Date(), simular = false }) {
  const tarefas = await banco.query(SQL_PRAZOS_ABERTOS);
  const avaliacoes = await avaliarTarefas({ banco, tarefas, hoje: agora() });
  const concluir = tarefas.map(t => ({ t, a: avaliacoes.get(t.id) })).filter(x => x.a.acao === 'concluir');
  const sugeridas = [...avaliacoes.values()].filter(a => a.acao === 'sugerir').length;
  const resumo = { abertas: tarefas.length, audiencias: concluir.filter(x => x.a.motivo === 'audiencia').length,
    com_peca: concluir.filter(x => x.a.motivo === 'peca').length, sugeridas, concluidas: 0,
    itens: concluir.map(x => ({ id: x.t.id, descricao: x.t.descricao, motivo: x.a.motivo })) };
  if (simular || !concluir.length) return resumo;

  const feitas = [];
  for (const { t, a } of concluir) {
    const r = await banco.execute(
      `UPDATE tarefas SET status = 'concluida', concluida_em = NOW(),
              observacao = CASE WHEN COALESCE(observacao, '') = '' THEN $2 ELSE observacao || E'\n' || $2 END
        WHERE id = $1 AND status = 'pendente' AND tipo = 'prazo'`, [t.id, a.nota]);
    if (r?.rowCount !== 0) feitas.push({ id: t.id, motivo: a.motivo });
  }
  if (feitas.length) {
    await banco.execute(
      `INSERT INTO logs_auditoria (acao, entidade, valor_antes, valor_depois, usuario_nome) VALUES ($1, $2, $3, $4, $5)`,
      ['baixa_automatica_prazo', 'tarefa', JSON.stringify({ status: 'pendente' }),
        JSON.stringify({ status: 'concluida', total: feitas.length, itens: feitas }), 'Sistema (baixa automática de prazos)']);
  }
  return { ...resumo, concluidas: feitas.length };
}
