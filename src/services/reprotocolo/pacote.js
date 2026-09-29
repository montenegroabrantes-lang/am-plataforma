// Pacote do re-protocolo (Fase 2): reserva e montagem, SEM gerar peça nem tocar no Drive ou no PJe.
//
// 1. Reservar: só ciclo com confirmação válida da verificação. A reserva é única por tarefa e por
//    demanda (índices únicos parciais) — dois pedidos simultâneos nunca geram dois pacotes.
// 2. Montar: junta período pedido, valor da causa (proposta), checklist de documentos e modelos
//    aprovados e produz o RELATÓRIO que o advogado confere. Não escreve inicial nem procuração:
//    isso depende dos modelos aprovados por ente (tabela modelos_reprotocolo) e da aprovação do
//    dossiê. Fica em modo sombra: serve para comparar com re-protocolos já feitos à mão.
// O juízo do processo anterior não é herdado: re-protocolo é processo novo, sem dependência.
import { db } from '../../db/index.js';
import { indiceMes, mesDoIndice } from './levantamento.js';
import { verificarCiclos } from './verificacao.js';
import { calcularValorCausa } from './valorCausa.js';
import { montarChecklist } from './checklist.js';

export const STATUS_PACOTE = { RESERVADO: 'reservado', MONTADO: 'montado', APROVADO: 'aprovado', CANCELADO: 'cancelado' };
export const TIPOS_MODELO = ['inicial', 'procuracao'];

const primeiroDia = (ym) => `${String(ym).slice(0, 7)}-01`;

// Período pedido: por padrão o período inteiro do ciclo; o advogado pode começar depois (por
// exemplo, limitar às últimas 60 competências), nunca antes do início do ciclo.
export function resolverPeriodoPedido(item, inicioPedido = null) {
  const cicloInicio = item.periodo?.inicio;
  const fim = item.periodo?.fim;
  if (!cicloInicio || !fim) return { ok: false, erro: 'O ciclo não tem período calculável.' };
  const iniIdx = indiceMes(inicioPedido ?? cicloInicio);
  const cicloIdx = indiceMes(cicloInicio);
  const fimIdx = indiceMes(fim);
  if (!iniIdx || !fimIdx) return { ok: false, erro: 'Período inválido.' };
  if (iniIdx < cicloIdx) return { ok: false, erro: 'O período pedido não pode começar antes do início do ciclo (antes disso é do processo anterior).' };
  if (iniIdx > fimIdx) return { ok: false, erro: 'O período pedido não pode começar depois do fim.' };
  const primeiroDentro = indiceMes(item.periodo?.primeiro_mes_dentro_5_anos);
  return {
    ok: true,
    inicio: primeiroDia(mesDoIndice(iniIdx)),
    fim: primeiroDia(mesDoIndice(fimIdx)),
    meses: fimIdx - iniIdx + 1,
    meses_acima_5_anos: primeiroDentro ? Math.max(0, Math.min(primeiroDentro, fimIdx + 1) - iniIdx) : 0,
    primeiro_mes_dentro_5_anos: item.periodo?.primeiro_mes_dentro_5_anos ?? null,
  };
}

export function montarRelatorio({ item, resultado, periodo, valor, checklist, modelos }) {
  const alertas = [];
  const confirmacao = resultado.confirmacao;
  for (const m of [...resultado.bloqueios, ...resultado.conferir]) alertas.push({ origem: 'verificacao', codigo: m.codigo, texto: m.texto, aceito: (confirmacao.motivos_aceitos || []).includes(m.codigo) });
  if (periodo.meses_acima_5_anos > 0) alertas.push({ origem: 'periodo', codigo: 'meses_acima_5_anos_no_pedido', texto: `O período pedido inclui ${periodo.meses_acima_5_anos} meses anteriores às últimas 60 competências (decisão do advogado).`, aceito: false });
  if (valor.exige_humano) alertas.push({ origem: 'valor', codigo: 'valor_exige_humano', texto: valor.motivo, aceito: false });

  const pendencias = [];
  for (const tipo of ['inicial', 'procuracao']) {
    if (!modelos[tipo]) pendencias.push(`Modelo aprovado de ${tipo === 'inicial' ? 'inicial' : 'procuração'} para ${item.ente?.nome ?? 'o ente'} não cadastrado.`);
  }
  if (valor.valor === null) pendencias.push('Valor da causa a informar pelo advogado.');
  if (checklist.faltando.length) pendencias.push(`Documentos sem origem na pasta antiga: ${checklist.faltando.join(', ')}.`);

  return {
    versao: 1,
    cliente: { nome: item.cliente.nome, cpf_mascarado: item.cliente.cpf_mascarado },
    tese: item.tese?.nome ?? null,
    ente: item.ente?.nome ?? null,
    periodo,
    processo_anterior: item.processo_anterior ? { numero: item.processo_anterior.numero, periodo_fim: item.processo_anterior.periodo_fim ?? null } : null,
    vinculo: { situacao: item.vinculo?.situacao ?? null, fim: item.vinculo?.fim ?? null, ativos: item.vinculo?.qtd_vinculos_ativos ?? null },
    valor_da_causa: valor,
    documentos: checklist,
    pasta_antiga: resultado.pasta ? { titulo: resultado.pasta.titulo ?? null, pai: resultado.pasta.pai ?? null, drive_pasta_id: resultado.pasta.drive_pasta_id ?? null } : null,
    modelos: { inicial: modelos.inicial ?? null, procuracao: modelos.procuracao ?? null },
    alertas,
    decisao_humana: { confirmado_em: confirmacao.decidido_em ?? null, valida_ate: confirmacao.valida_ate ?? null, observacao: confirmacao.observacao ?? null, motivos_aceitos: confirmacao.motivos_aceitos ?? [] },
    pendencias,
    pronto_para_gerar_pecas: pendencias.length === 0,
  };
}

export function relatorioEmTexto(rel) {
  const brl = v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const l = [];
  l.push(`${rel.cliente.nome} · CPF ${rel.cliente.cpf_mascarado} · ${rel.tese} · ${rel.ente ?? 'ente não definido'}`);
  l.push(`Período: ${String(rel.periodo.inicio).slice(0, 7)} a ${String(rel.periodo.fim).slice(0, 7)} (${rel.periodo.meses} meses${rel.periodo.meses_acima_5_anos ? `, ${rel.periodo.meses_acima_5_anos} fora das últimas 60 competências` : ''})`);
  if (rel.processo_anterior) l.push(`Processo anterior: ${rel.processo_anterior.numero} (cobriu até ${String(rel.processo_anterior.periodo_fim ?? '?').slice(0, 7)}) — o juízo não é herdado`);
  l.push(`Valor da causa: ${rel.valor_da_causa.valor === null ? 'a informar' : `${brl(rel.valor_da_causa.valor)} (proposta)`}${rel.valor_da_causa.exige_humano ? ' — exige decisão' : ''}`);
  for (const m of rel.valor_da_causa.memoria || []) l.push(`  · ${m}`);
  l.push(`Documentos: reaproveita ${rel.documentos.reaproveita.join(', ') || 'nada'}; novos ${rel.documentos.novos.join(', ')}${rel.documentos.faltando.length ? `; faltando ${rel.documentos.faltando.join(', ')}` : ''}`);
  if (rel.alertas.length) { l.push('Alertas:'); for (const a of rel.alertas) l.push(`  · ${a.texto}${a.aceito ? ' (aceito na confirmação)' : ''}`); }
  if (rel.pendencias.length) { l.push('Pendências para gerar as peças:'); for (const p of rel.pendencias) l.push(`  · ${p}`); }
  return l.join('\n');
}

// ───────────────────────────── Banco ─────────────────────────────

export const SQL_MODELOS = `
  SELECT tipo, titulo, drive_arquivo_id, tese_id FROM modelos_reprotocolo
   WHERE ativo = true AND ente = $1 AND (tese_id IS NULL OR tese_id = $2)
   ORDER BY (tese_id IS NULL) ASC`;

export async function reservarPacotes({ conexao = db, usuarioId, tarefaIds, podeVerRestrito = false, agora = new Date(), verificar = verificarCiclos }) {
  const { resultados } = await verificar({ conexao, podeVerRestrito, ids: tarefaIds, agora });
  const porId = new Map(resultados.map(r => [r.item.tarefa_id, r]));
  const saida = [];
  for (const id of tarefaIds) {
    const r = porId.get(id);
    if (!r) { saida.push({ tarefa_id: id, ok: false, erro: 'Ciclo não encontrado nas filas Re-protocolo/Novos ciclos.' }); continue; }
    if (!r.confirmacao.confirmada) { saida.push({ tarefa_id: id, ok: false, erro: 'Sem confirmação válida da verificação.', motivo: r.confirmacao.motivo }); continue; }
    const linha = await conexao.queryOne(
      `INSERT INTO pacotes_reprotocolo (tarefa_id, demanda_id, cliente_id, reservado_por)
       SELECT t.id, t.demanda_id, cp.cliente_id, $2 FROM tarefas t JOIN cliente_produtos cp ON cp.id = t.cliente_produto_id WHERE t.id = $1
       ON CONFLICT DO NOTHING RETURNING id`, [id, usuarioId]);
    saida.push(linha ? { tarefa_id: id, ok: true, pacote_id: linha.id } : { tarefa_id: id, ok: false, erro: 'Já existe pacote ativo para esta tarefa ou demanda.' });
  }
  return saida;
}

export async function montarPacote({ conexao = db, pacoteId, usuarioId, periodoInicioPedido = null, podeVerRestrito = false, agora = new Date(), verificar = verificarCiclos }) {
  const pacote = await conexao.queryOne(`SELECT * FROM pacotes_reprotocolo WHERE id = $1 FOR UPDATE`, [pacoteId]);
  if (!pacote) return { ok: false, status: 404, erro: 'Pacote não encontrado.' };
  if (![STATUS_PACOTE.RESERVADO, STATUS_PACOTE.MONTADO].includes(pacote.status)) return { ok: false, status: 409, erro: `Pacote ${pacote.status}: não pode ser montado.` };

  const { resultados } = await verificar({ conexao, podeVerRestrito, tarefaId: pacote.tarefa_id, agora });
  const resultado = resultados[0];
  if (!resultado) return { ok: false, status: 409, erro: 'O ciclo saiu das filas de re-protocolo.' };
  if (!resultado.confirmacao.confirmada) return { ok: false, status: 409, erro: 'A confirmação da verificação perdeu a validade: confirme de novo.', motivo: resultado.confirmacao.motivo };

  const item = resultado.item;
  const periodo = resolverPeriodoPedido(item, periodoInicioPedido);
  if (!periodo.ok) return { ok: false, status: 400, erro: periodo.erro };

  const valor = calcularValorCausa({ tese: item.tese?.nome, oficial: resultado.oficial });
  const checklist = montarChecklist({ documentos: resultado.pasta?.documentos ?? null, ente: item.ente?.nome ?? null, fonteOficial: item.ente?.fonte_oficial ?? null });
  const linhasModelo = item.ente?.nome ? await conexao.query(SQL_MODELOS, [item.ente.nome, item.tese?.id ?? null]) : [];
  const modelos = {};
  for (const m of linhasModelo) if (!modelos[m.tipo]) modelos[m.tipo] = { titulo: m.titulo ?? null, drive_arquivo_id: m.drive_arquivo_id };

  const relatorio = montarRelatorio({ item, resultado, periodo, valor, checklist, modelos });
  await conexao.execute(
    `UPDATE pacotes_reprotocolo SET status = 'montado', periodo_inicio = $1::date, periodo_fim = $2::date, meses = $3, valor_causa = $4,
            valor_exige_humano = $5, dados = $6::jsonb, montado_em = NOW(), atualizado_em = NOW() WHERE id = $7`,
    [periodo.inicio, periodo.fim, periodo.meses, valor.valor, valor.exige_humano, JSON.stringify(relatorio), pacoteId]);
  return { ok: true, pacote_id: pacoteId, relatorio, texto: relatorioEmTexto(relatorio) };
}

export async function cancelarPacote({ conexao = db, pacoteId, usuarioId, motivo }) {
  const r = await conexao.execute(
    `UPDATE pacotes_reprotocolo SET status = 'cancelado', cancelado_por = $1, cancelado_em = NOW(), motivo_cancelamento = $2, atualizado_em = NOW()
      WHERE id = $3 AND status IN ('reservado','montado')`, [usuarioId, motivo, pacoteId]);
  return (r?.rowCount ?? 0) > 0;
}

export async function listarPacotes({ conexao = db, status = null, limite = 200 } = {}) {
  return conexao.query(
    `SELECT p.id, p.tarefa_id, p.cliente_id, p.status, p.periodo_inicio::text, p.periodo_fim::text, p.meses, p.valor_causa, p.valor_exige_humano,
            p.reservado_em, p.montado_em, c.nome AS cliente_nome, p.dados->>'tese' AS tese, p.dados->>'ente' AS ente,
            (p.dados->>'pronto_para_gerar_pecas')::boolean AS pronto_para_gerar_pecas
       FROM pacotes_reprotocolo p JOIN clientes c ON c.id = p.cliente_id
      WHERE ($1::text IS NULL OR p.status = $1) ORDER BY p.reservado_em DESC LIMIT $2`, [status, limite]);
}

export async function obterPacote({ conexao = db, pacoteId }) {
  const p = await conexao.queryOne(`SELECT id, tarefa_id, cliente_id, status, dados, reservado_em, montado_em FROM pacotes_reprotocolo WHERE id = $1`, [pacoteId]);
  if (!p) return null;
  return { ...p, texto: p.dados?.versao ? relatorioEmTexto(p.dados) : null };
}

export async function cadastrarModelo({ conexao = db, ente, teseId = null, tipo, titulo = '', driveId, usuarioId }) {
  if (!TIPOS_MODELO.includes(tipo)) throw new Error('tipo inválido');
  await conexao.execute(
    `UPDATE modelos_reprotocolo SET ativo = false WHERE ente = $1 AND tipo = $2 AND COALESCE(tese_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE($3::uuid, '00000000-0000-0000-0000-000000000000'::uuid) AND ativo`,
    [ente, tipo, teseId]);
  await conexao.execute(
    `INSERT INTO modelos_reprotocolo (ente, tese_id, tipo, titulo, drive_arquivo_id, aprovado_por) VALUES ($1,$2,$3,$4,$5,$6)`,
    [ente, teseId, tipo, titulo, driveId, usuarioId]);
}

export async function listarModelos({ conexao = db } = {}) {
  return conexao.query(`SELECT m.id, m.ente, m.tese_id, pr.nome AS tese, m.tipo, m.titulo, m.drive_arquivo_id, m.aprovado_em
                          FROM modelos_reprotocolo m LEFT JOIN produtos pr ON pr.id = m.tese_id WHERE m.ativo ORDER BY m.ente, m.tipo`);
}
