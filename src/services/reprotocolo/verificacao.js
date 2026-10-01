// Verificação e confirmação dos re-protocolos pendentes (Fase 2 do re-protocolo automatizado).
//
// Cada ciclo aberto (fila "Re-protocolo" + "Novos ciclos") é avaliado por regras objetivas e cai em
// um de três grupos:
//   confirmado — passou em tudo; pode seguir para o pacote;
//   conferir   — o sistema não consegue decidir sozinho (decisão jurídica ou dado ambíguo);
//   bloqueado  — ainda não venceu, já tem processo cobrindo o período ou há possível protocolo à mão.
// A decisão humana (confirmar) fica gravada em `verificacoes_reprotocolo`, presa a um hash dos
// dados verificados: se o vínculo, o período, o processo anterior ou a pasta mudarem, ou se passarem
// 30 dias, a confirmação perde a validade sozinha. O juízo do processo anterior NÃO entra nas
// regras: re-protocolo é sempre processo novo, sem dependência do anterior (decisão de 29/09/2026).
//
// As regras são funções puras (avaliarCiclo); o acesso ao banco recebe a conexão por parâmetro.
import crypto from 'node:crypto';
import { db } from '../../db/index.js';
import { carregarItens } from './levantamento.js';

export const GRUPO = { CONFIRMADO: 'confirmado', CONFERIR: 'conferir', BLOQUEADO: 'bloqueado' };
export const VALIDADE_CONFIRMACAO_DIAS = 30;
export const VALIDADE_CONFERENCIA_OFICIAL_DIAS = 30;
// Bloqueios que a equipe pode liberar com uma observação ("conferi: não foi protocolado").
export const BLOQUEIOS_LIBERAVEIS = ['protocolo_a_mao'];
const MESES_SEM_PAGAMENTO_ALERTA = 6;
const DIA_MS = 86_400_000;

// Confirmação só é exigida no aceite do ciclo quando a chave estiver ligada (nasce desligada).
export const confirmacaoExigida = () => process.env.REPROTOCOLO_EXIGE_CONFIRMACAO === 'true';

// ───────────────────────────── Regras (puras) ─────────────────────────────

const PRECISA_OFICIAL = (item) => item.periodo?.intervalo_completo === true
  && Boolean(item.ente?.fonte_oficial)
  && item.ente?.origem !== 'padrao_tese'
  && (item.periodo?.meses ?? 0) > 0
  && String(item.periodo?.fim ?? '').slice(0, 7) >= String(item.periodo?.primeiro_mes_dentro_5_anos ?? '');

// Palavras-chave de tese em um texto (nome da tese da tarefa ou título de pasta do Drive).
const TESES_PALAVRAS = [['FGTS', 'FGTS'], ['FERIAS', 'FERIAS'], ['INSALUBRIDADE', 'INSALUBRIDADE'], ['NOTURNO', 'NOTURNO'], ['PISO', 'PISO'], ['EQUIPARA', 'EQUIPARA'], ['13 SALARIO', '13SAL']];
export function palavrasDeTese(texto) {
  const t = String(texto ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ');
  return TESES_PALAVRAS.filter(([p]) => t.includes(p)).map(([, k]) => k);
}

// ctx: { oficial, publicacoes, pasta } — todos opcionais.
//   oficial: resumo da conferência na fonte oficial PB/PE ({ status, correspondencia, vinculos:[{regime, ultima_paga, sem_pgto_meses}] })
//   publicacoes: publicações sem processo cadastrado que citam o cliente
//   pasta: linha de reprotocolo_pasta_antiga do cliente ({ status, titulo, duplicidade:[{ pasta, pai, criada, exato, teses, onda_fgts }] })
//     exato = nome igual; teses = palavras de tese no título da pasta; onda_fgts = pasta de _REPROTOCOLO (onda FGTS)
export function avaliarCiclo(item, { oficial = null, publicacoes = [], pasta = null } = {}) {
  const bloqueios = [];
  const conferir = [];
  const b = (codigo, texto) => bloqueios.push({ codigo, texto });
  const c = (codigo, texto) => conferir.push({ codigo, texto });
  const flags = new Set(item.flags || []);
  const vencido = item.periodo?.intervalo_completo === true;

  // Bloqueios
  if (flags.has('intervalo_da_tese_incompleto') || !vencido) {
    b('intervalo_incompleto', `Ainda não venceu (vence ${item.periodo?.completa_intervalo_em ?? 'em data indefinida'})`);
  }
  if (flags.has('processo_cobrindo_periodo')) {
    const nums = (item.processos_cobrindo_periodo || []).map(p => p.numero ?? p).slice(0, 2).join(', ');
    b('processo_cobrindo_periodo', `Já existe processo cobrindo o período${nums ? `: ${nums}` : ''}`);
  }
  // Pastas recentes da equipe com o mesmo nome (ou parecido) que podem ser re-protocolo feito à mão.
  // A tese decide: pasta de OUTRA tese (ex.: "EMLUR (INSALUBRIDADE)") não indica duplicidade de FGTS.
  const tesesTarefa = palavrasDeTese(item.tese?.nome);
  // A pasta "Outorgantes {ano}" do ano do processo anterior é a do PRÓPRIO ajuizamento anterior (ex.:
  // processo de 2026 cobrindo período até 2023): não indica re-protocolo do período novo.
  const anoAnterior = /\.(\d{4})\./.exec(item.processo_anterior?.numero ?? '')?.[1] ?? null;
  for (const d of (pasta?.duplicidade || [])) {
    if (!vencido) continue;
    if (anoAnterior && d.pai === `Outorgantes ${anoAnterior}`) continue;
    const onde = `pasta "${String(d.pasta ?? '').slice(0, 60)}" em ${d.pai ?? 'Drive'}${d.criada ? ` (criada ${d.criada})` : ''}`;
    const tesesPasta = d.teses || [];
    if (tesesPasta.length && !tesesPasta.some(t => tesesTarefa.includes(t))) continue;
    if (!d.exato) {
      if (d.onda_fgts && !tesesPasta.length && !tesesTarefa.includes('FGTS')) continue;
      c('pasta_reprotocolo_parecida', `Pasta de re-protocolo com nome parecido (pode ser outra pessoa): ${onde}`);
    } else if (tesesPasta.length || (d.onda_fgts && tesesTarefa.includes('FGTS'))) b('protocolo_a_mao', `Possível protocolo à mão / em preparo: ${onde}`);
    else c('pasta_recente_sem_tese', `Pasta recente sem tese no nome (pode ser outro processo): ${onde}`);
  }

  // Período
  if (flags.has('meses_acima_5_anos')) c('meses_acima_5_anos', `${item.periodo?.meses_mais_5_anos ?? '?'} meses anteriores às últimas 60 competências (decisão do advogado)`);
  if (flags.has('sem_processo_anterior')) c('sem_processo_anterior', 'Sem processo anterior: o ciclo parte do início do vínculo (ajuizamento novo, não re-protocolo)');
  if (flags.has('inicio_no_futuro') || flags.has('sem_inicio_periodo')) c('periodo_invalido', 'Início do ciclo ausente ou no futuro (dado errado)');

  // Vínculo, ente e polo (cadastro)
  if (flags.has('vinculo_divergente')) c('vinculo_divergente', 'Cadastro contraditório: vínculo ativo com data de fim');
  if (flags.has('vinculo_encerrado')) c('vinculo_encerrado', 'Vínculo encerrado: o período vai só até o desligamento');
  if (flags.has('fim_do_vinculo_antes_do_ciclo') || flags.has('vinculo_encerrado_antes_do_inicio')) c('fim_do_vinculo_antes_do_ciclo', 'Fim do vínculo anterior ao início do ciclo: pode não haver período novo');
  if (flags.has('varios_vinculos_ativos')) c('varios_vinculos_ativos', 'Mais de um vínculo ativo: escolher o vínculo e o polo');
  if (flags.has('polo_generico')) c('polo_generico', 'Polo genérico: falta definir o município');
  if (flags.has('sem_polo')) c('sem_polo', 'Polo passivo não informado');
  if (flags.has('polo_inferido_da_tese') || item.ente?.origem === 'padrao_tese') c('polo_inferido_da_tese', 'Ente inferido do padrão da tese, não do cadastro do cliente');
  if (flags.has('ente_diverge_do_tribunal_anterior')) c('ente_diverge_do_tribunal_anterior', 'Ente diverge do tribunal do processo anterior');
  if (flags.has('sem_cpf')) c('sem_cpf', 'Cliente sem CPF no cadastro');
  if (flags.has('cliente_inativo')) c('cliente_inativo', 'Cadastro do cliente inativo');

  // Publicações de processo que o AM não conhece
  if (vencido && publicacoes.length) c('publicacao_desconhecida', `Publicação cita o cliente em processo que o AM não tem: ${publicacoes[0].numero_processo}`);

  // Fonte oficial PB/PE
  if (PRECISA_OFICIAL(item)) {
    if (!oficial) c('oficial_pendente', 'Fonte oficial (PB/PE) ainda não conferida');
    else if (oficial.status === 'erro') c('oficial_indisponivel', 'Fonte oficial indisponível na última tentativa: repetir a conferência');
    else {
      const vinculos = oficial.vinculos || [];
      if (oficial.status === 'nao_encontrado' || !vinculos.length) c('oficial_sem_vinculo', 'Fonte oficial: nenhum vínculo encontrado');
      else if (oficial.correspondencia === 'ambigua') c('oficial_homonimos', 'Fonte oficial: mais de um vínculo com o mesmo nome (homônimos)');
      else {
        const v = vinculos[0];
        if ((v.sem_pgto_meses ?? 0) >= MESES_SEM_PAGAMENTO_ALERTA) {
          c('oficial_ultimo_pagamento_antigo', `Fonte oficial: último pagamento em ${v.ultima_paga} (${v.sem_pgto_meses} meses sem pagamento)`);
        }
        const regime = String(v.regime || '').toUpperCase();
        if (regime && regime !== 'TEMPORARIO') c('oficial_regime', `Fonte oficial: regime ${regime}`);
      }
    }
  }

  // Pasta antiga no Drive
  if (!pasta) c('pasta_nao_verificada', 'Pasta antiga ainda não localizada no Drive');
  else if (pasta.status === 'nao_encontrada') c('pasta_nao_encontrada', 'Pasta antiga não encontrada no Drive');
  else if (pasta.status === 'ambigua') c('pasta_ambigua', 'Pasta antiga ambígua: confirme qual é');

  const grupo = bloqueios.length ? GRUPO.BLOQUEADO : conferir.length ? GRUPO.CONFERIR : GRUPO.CONFIRMADO;
  return { grupo, bloqueios, conferir };
}

// Hash dos dados que a confirmação cobre. O fim do período fica de fora de propósito: para vínculo
// ativo ele acompanha o mês atual e invalidaria toda confirmação na virada do mês.
export function hashVerificacao(item, avaliacao, { oficial = null, pasta = null } = {}) {
  const base = {
    p: [item.periodo?.inicio ?? null],
    v: [item.vinculo?.situacao ?? null, item.vinculo?.fim ?? null, item.vinculo?.qtd_vinculos_ativos ?? null],
    e: [item.ente?.nome ?? null, item.ente?.origem ?? null],
    a: item.processo_anterior?.numero ?? null,
    pa: [pasta?.drive_pasta_id ?? null, pasta?.status ?? null],
    of: oficial ? [oficial.status ?? null, oficial.correspondencia ?? null, oficial.vinculos?.[0]?.ultima_paga ?? null] : null,
    m: [...avaliacao.bloqueios, ...avaliacao.conferir].map(x => x.codigo).sort(),
  };
  return crypto.createHash('sha256').update(JSON.stringify(base)).digest('hex').slice(0, 32);
}

// salva: última linha de verificacoes_reprotocolo da tarefa (ou null).
export function situacaoConfirmacao(atual, salva, agora = new Date()) {
  if (!salva || salva.decisao !== 'confirmada') return { confirmada: false, motivo: 'sem_decisao' };
  if (salva.snapshot_hash !== atual.hash) return { confirmada: false, motivo: 'dados_mudaram' };
  const decididoEm = new Date(salva.decidido_em);
  if (Number.isNaN(decididoEm.getTime()) || (agora - decididoEm) / DIA_MS > VALIDADE_CONFIRMACAO_DIAS) {
    return { confirmada: false, motivo: 'expirada' };
  }
  if (atual.bloqueios.some(m => !BLOQUEIOS_LIBERAVEIS.includes(m.codigo))) return { confirmada: false, motivo: 'bloqueada' };
  const aceitos = new Set(salva.motivos_aceitos || []);
  if ([...atual.bloqueios, ...atual.conferir].some(m => !aceitos.has(m.codigo))) return { confirmada: false, motivo: 'motivos_nao_aceitos' };
  return {
    confirmada: true,
    decidido_por: salva.decidido_por ?? null,
    decidido_em: decididoEm.toISOString(),
    valida_ate: new Date(decididoEm.getTime() + VALIDADE_CONFIRMACAO_DIAS * DIA_MS).toISOString(),
    motivos_aceitos: [...aceitos],
    observacao: salva.observacao ?? null,
  };
}

// ───────────────────────────── Acesso ao banco ─────────────────────────────

const NORM = c => `translate(lower(${c}), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')`;

export const SQL_PUBLICACOES_DESCONHECIDAS = `
  SELECT p.numero_processo, p.tribunal, p.data_disponibilizacao::text AS data, c.id AS cliente_id
    FROM publicacoes p
    JOIN clientes c ON c.id = ANY($1::uuid[])
   WHERE p.processo_id IS NULL AND COALESCE(p.cancelada, false) = false
     AND position(${NORM('c.nome')} in ${NORM('p.texto')}) > 0`;

export const SQL_PASTAS = `SELECT * FROM reprotocolo_pasta_antiga WHERE cliente_id = ANY($1::uuid[])`;

export const SQL_OFICIAL = `
  SELECT tarefa_id, resultado FROM reprotocolo_conferencia_oficial
   WHERE tarefa_id = ANY($1::uuid[]) AND conferido_em > NOW() - ($2::int * INTERVAL '1 day')`;

export const SQL_ULTIMAS = `
  SELECT DISTINCT ON (tarefa_id) id, tarefa_id, snapshot_hash, decisao, decidido_por, decidido_em, motivos_aceitos, observacao, verificado_em
    FROM verificacoes_reprotocolo
   WHERE tarefa_id = ANY($1::uuid[])
   ORDER BY tarefa_id, verificado_em DESC`;

async function carregarContexto(conexao, itens) {
  const tarefaIds = itens.map(i => i.tarefa_id);
  const clienteIds = [...new Set(itens.map(i => i.cliente.id).filter(Boolean))];
  if (!tarefaIds.length) return { pubs: new Map(), pastas: new Map(), oficiais: new Map(), salvas: new Map() };
  const [pubs, pastas, oficiais, salvas] = await Promise.all([
    clienteIds.length ? conexao.query(SQL_PUBLICACOES_DESCONHECIDAS, [clienteIds]) : [],
    clienteIds.length ? conexao.query(SQL_PASTAS, [clienteIds]) : [],
    conexao.query(SQL_OFICIAL, [tarefaIds, VALIDADE_CONFERENCIA_OFICIAL_DIAS]),
    conexao.query(SQL_ULTIMAS, [tarefaIds]),
  ]);
  const porCliente = new Map();
  for (const p of pubs) { if (!porCliente.has(p.cliente_id)) porCliente.set(p.cliente_id, []); porCliente.get(p.cliente_id).push(p); }
  return {
    pubs: porCliente,
    pastas: new Map(pastas.map(p => [p.cliente_id, p])),
    oficiais: new Map(oficiais.map(o => [o.tarefa_id, o.resultado])),
    salvas: new Map(salvas.map(s => [s.tarefa_id, s])),
  };
}

// Avalia os ciclos abertos hoje. `tarefaId` avalia só uma; `ids` filtra o conjunto carregado.
export async function verificarCiclos({ conexao = db, podeVerRestrito = false, tarefaId = null, ids = null, agora = new Date() } = {}) {
  const { hoje, itens: todos } = await carregarItens({ conexao, podeVerRestrito, tarefaId });
  const itens = ids ? todos.filter(i => ids.includes(i.tarefa_id)) : todos;
  const ctx = await carregarContexto(conexao, itens);
  const resultados = itens.map((item) => {
    const c = { oficial: ctx.oficiais.get(item.tarefa_id) ?? null, publicacoes: ctx.pubs.get(item.cliente.id) ?? [], pasta: ctx.pastas.get(item.cliente.id) ?? null };
    const avaliacao = avaliarCiclo(item, c);
    const hash = hashVerificacao(item, avaliacao, c);
    const salva = ctx.salvas.get(item.tarefa_id) ?? null;
    return { item, ...avaliacao, hash, pasta: c.pasta, oficial: c.oficial, salva, confirmacao: situacaoConfirmacao({ ...avaliacao, hash }, salva, agora) };
  });
  return { hoje, resultados };
}

export function totaisPorGrupo(resultados) {
  const t = { confirmado: 0, conferir: 0, bloqueado: 0, confirmadas_validas: 0, total: resultados.length };
  for (const r of resultados) { t[r.grupo] += 1; if (r.confirmacao.confirmada) t.confirmadas_validas += 1; }
  return t;
}

// Forma compacta para tela e chat (sem dados além dos que o levantamento já mostra).
export function resumirResultado(r) {
  const it = r.item;
  return {
    tarefa_id: it.tarefa_id,
    secao: it.secao,
    cliente: { id: it.cliente.id, nome: it.cliente.nome, cpf_mascarado: it.cliente.cpf_mascarado },
    tese: it.tese?.nome ?? null,
    ente: it.ente?.nome ?? null,
    periodo: { inicio: it.periodo?.inicio ?? null, fim: it.periodo?.fim ?? null, meses: it.periodo?.meses ?? null, vence: it.periodo?.completa_intervalo_em ?? null },
    grupo: r.grupo,
    motivos: [...r.bloqueios.map(m => ({ ...m, tipo: 'bloqueio', liberavel: BLOQUEIOS_LIBERAVEIS.includes(m.codigo) })), ...r.conferir.map(m => ({ ...m, tipo: 'conferir' }))],
    confirmacao: r.confirmacao,
    pasta: r.pasta ? { status: r.pasta.status, titulo: r.pasta.titulo ?? null, pai: r.pasta.pai ?? null, drive_pasta_id: r.pasta.drive_pasta_id ?? null, documentos: r.pasta.documentos ?? null } : null,
    oficial: r.oficial ? { status: r.oficial.status, correspondencia: r.oficial.correspondencia ?? null } : null,
  };
}

// Grava a verificação atual (uma linha nova só quando o hash mudou). Devolve o id da linha vigente.
async function garantirLinha(conexao, r, demandaId) {
  if (r.salva && r.salva.snapshot_hash === r.hash) return r.salva.id;
  const snapshot = {
    periodo: r.item.periodo, vinculo: { situacao: r.item.vinculo?.situacao, fim: r.item.vinculo?.fim, ativos: r.item.vinculo?.qtd_vinculos_ativos },
    ente: r.item.ente?.nome, processo_anterior: r.item.processo_anterior?.numero ?? null, pasta: r.pasta?.drive_pasta_id ?? null,
    oficial: r.oficial ? { status: r.oficial.status, correspondencia: r.oficial.correspondencia } : null,
  };
  const linha = await conexao.queryOne(
    `INSERT INTO verificacoes_reprotocolo (tarefa_id, demanda_id, grupo, motivos, snapshot, snapshot_hash)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6) RETURNING id`,
    [r.item.tarefa_id, demandaId ?? null, r.grupo, JSON.stringify([...r.bloqueios, ...r.conferir]), JSON.stringify(snapshot), r.hash]);
  return linha.id;
}

// Registra a verificação atual de todos os ciclos (histórico por hash). Não altera nenhuma tarefa.
export async function registrarVerificacoes({ conexao = db, podeVerRestrito = false, agora = new Date() } = {}) {
  const { resultados } = await verificarCiclos({ conexao, podeVerRestrito, agora });
  let novas = 0;
  for (const r of resultados) {
    if (r.salva && r.salva.snapshot_hash === r.hash) continue;
    const demanda = await conexao.queryOne(`SELECT demanda_id FROM tarefas WHERE id=$1`, [r.item.tarefa_id]);
    await garantirLinha(conexao, r, demanda?.demanda_id);
    novas += 1;
  }
  return { total: resultados.length, novas };
}

// Confirma ciclos. `pedidos`: [{ tarefaId, motivosAceitos: string[] }]. Grupo "confirmado" não exige
// observação; qualquer motivo aceito exige. Bloqueios não liberáveis nunca são confirmados.
export async function confirmarCiclos({ conexao = db, usuarioId, pedidos, observacao = '', podeVerRestrito = false, agora = new Date() }) {
  const ids = pedidos.map(p => p.tarefaId);
  const { resultados } = await verificarCiclos({ conexao, podeVerRestrito, ids, agora });
  const porId = new Map(resultados.map(r => [r.item.tarefa_id, r]));
  const saida = [];
  for (const p of pedidos) {
    const r = porId.get(p.tarefaId);
    if (!r) { saida.push({ tarefa_id: p.tarefaId, ok: false, erro: 'Ciclo não encontrado nas filas Re-protocolo/Novos ciclos.' }); continue; }
    const naoLiberaveis = r.bloqueios.filter(m => !BLOQUEIOS_LIBERAVEIS.includes(m.codigo));
    if (naoLiberaveis.length) { saida.push({ tarefa_id: p.tarefaId, ok: false, erro: `Bloqueado: ${naoLiberaveis.map(m => m.texto).join('; ')}` }); continue; }
    const aceitos = new Set(p.motivosAceitos || []);
    const pendentes = [...r.bloqueios, ...r.conferir].filter(m => !aceitos.has(m.codigo));
    if (pendentes.length) { saida.push({ tarefa_id: p.tarefaId, ok: false, erro: 'Há motivos não aceitos.', pendentes: pendentes.map(m => m.codigo) }); continue; }
    if (aceitos.size && String(observacao).trim().length < 5) { saida.push({ tarefa_id: p.tarefaId, ok: false, erro: 'Informe a observação da decisão.' }); continue; }
    const demanda = await conexao.queryOne(`SELECT demanda_id FROM tarefas WHERE id=$1`, [p.tarefaId]);
    const linhaId = await garantirLinha(conexao, r, demanda?.demanda_id);
    await conexao.execute(
      `UPDATE verificacoes_reprotocolo SET decisao='confirmada', decidido_por=$1, decidido_em=NOW(), motivos_aceitos=$2::jsonb, observacao=$3 WHERE id=$4`,
      [usuarioId, JSON.stringify([...aceitos]), String(observacao).trim() || null, linhaId]);
    saida.push({ tarefa_id: p.tarefaId, ok: true });
  }
  return saida;
}

// Guarda do aceite de ciclo: devolve os ids que NÃO têm confirmação válida.
export async function semConfirmacaoValida(ids, { conexao = db, podeVerRestrito = false, agora = new Date() } = {}) {
  if (!ids.length) return [];
  const { resultados } = await verificarCiclos({ conexao, podeVerRestrito, ids, agora });
  const validos = new Set(resultados.filter(r => r.confirmacao.confirmada).map(r => r.item.tarefa_id));
  return ids.filter(id => !validos.has(id));
}

// Cache da conferência oficial (a consulta é lenta e tem limite na fonte pública).
export async function salvarConferenciaOficial(conexao, tarefaId, conferencia) {
  const resumo = conferencia.status === 'erro' ? { status: 'erro', mensagem: conferencia.mensagem ?? null } : {
    status: conferencia.status, uf: conferencia.uf ?? null, correspondencia: conferencia.correspondencia ?? null,
    // Referência de 8% (FGTS) só quando a correspondência é clara; usada pelo valor da causa do pacote.
    risco: conferencia.valor_em_risco_referencia?.referencia_8pct ?? null,
    periodo_consultado: conferencia.periodo_consultado ?? null,
    vinculos: (conferencia.vinculos_encontrados || []).map(v => ({
      cargo: v.cargo, orgao: v.orgao, regime: v.regime, admissao: v.admissao,
      ultima_paga: v.ultima_competencia_com_pagamento, sem_pgto_meses: v.meses_sem_pagamento_ate_o_fim_da_consulta,
      competencias: v.competencias_localizadas,
    })),
  };
  await conexao.execute(
    `INSERT INTO reprotocolo_conferencia_oficial (tarefa_id, resultado, conferido_em) VALUES ($1,$2::jsonb,NOW())
     ON CONFLICT (tarefa_id) DO UPDATE SET resultado=EXCLUDED.resultado, conferido_em=NOW()`,
    [tarefaId, JSON.stringify(resumo)]);
  return resumo;
}

// Vincula (ou corrige) a pasta antiga do cliente. `origem`: 'manual' | 'indice_drive' | 'importacao'.
export async function vincularPastaAntiga(conexao, { clienteId, driveId, titulo, pai = null, usuarioId = null, origem = 'manual' }) {
  await conexao.execute(
    `INSERT INTO reprotocolo_pasta_antiga (cliente_id, status, drive_pasta_id, titulo, pai, origem, confirmada_por, confirmada_em, atualizado_em)
     VALUES ($1,'unica',$2,$3,$4,$5,$6,NOW(),NOW())
     ON CONFLICT (cliente_id) DO UPDATE SET status='unica', drive_pasta_id=EXCLUDED.drive_pasta_id, titulo=EXCLUDED.titulo,
       pai=EXCLUDED.pai, origem=EXCLUDED.origem, confirmada_por=EXCLUDED.confirmada_por, confirmada_em=NOW(), atualizado_em=NOW()`,
    [clienteId, driveId, titulo, pai, origem, usuarioId]);
}
