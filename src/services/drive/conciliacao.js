// Conciliação entre o fluxo da equipe no Drive e as tarefas de protocolo do AM.
//
//  A) Caminho principal: a pasta do cliente nasce em "_PENDENTE A PROTOCOLAR - 2026 - AM" com o nome
//     "NOME x ENTE"; ao concluir a ÚLTIMA tarefa de protocolo do cliente (com número), o AM move a
//     pasta para "Outorgantes 2026".
//  B) Detector: pasta que a equipe moveu à mão para Outorgantes enquanto a tarefa segue aberta vira
//     "Protocolado no Drive — falta o número". Se houver comprovante PDF na pasta, os números CNJ
//     lidos dele ficam como sugestão. NUNCA conclui sozinho: sem número confirmado não há processo.
//  C) Relatório de divergências para o Master (pastas sem cliente, tarefas sem pasta, vínculos).
//
// Só tarefas de protocolo INICIAL (ciclo_inicio IS NULL); re-protocolo tem fluxo próprio.

import { db as dbPadrao } from '../../db/index.js';
import * as drivePadrao from './index.js';
import { registrarAuditoria as auditarPadrao } from '../../middleware/auditoria.js';
import { pastasConfiguradas, nomePastaEquipe, clienteDaPasta, numerosCnj, ehComprovante } from './pastasEquipe.js';

const SUBPASTAS_LEGADO = ['Documentos Pessoais', 'Vínculo Funcional', 'Procurações', 'Contratos', 'Petições'];

async function extrairTextoPadrao(buffer) {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

function dependencias(deps = {}) {
  return {
    db: deps.db || dbPadrao,
    drive: deps.drive || drivePadrao,
    auditar: deps.auditar || auditarPadrao,
    extrairTexto: deps.extrairTexto || extrairTextoPadrao,
    env: deps.env || process.env,
  };
}

const SQL_TAREFAS_ABERTAS = `
  SELECT t.id AS tarefa_id, t.status, t.prazo_data, t.atribuido_a,
         t.drive_protocolo_detectado_em, t.drive_protocolo_pasta_id, t.drive_protocolo_pasta_url, t.drive_numeros_encontrados,
         cp.cliente_id, cl.nome AS cliente_nome, cl.drive_pasta_id, cl.drive_pasta_url, pr.nome AS produto_nome
    FROM tarefas t
    JOIN cliente_produtos cp ON cp.id = t.cliente_produto_id
    JOIN clientes cl ON cl.id = cp.cliente_id
    JOIN produtos pr ON pr.id = cp.produto_id
   WHERE t.tipo = 'protocolar' AND t.status NOT IN ('concluida','cancelada') AND t.ciclo_inicio IS NULL`;

function porCliente(tarefas) {
  const mapa = new Map();
  for (const t of tarefas) {
    if (!mapa.has(t.cliente_id)) mapa.set(t.cliente_id, { id: t.cliente_id, nome: t.cliente_nome, drive_pasta_id: t.drive_pasta_id, drive_pasta_url: t.drive_pasta_url, tarefas: [] });
    mapa.get(t.cliente_id).tarefas.push(t);
  }
  return [...mapa.values()];
}

// ── A) criação e mudança da pasta ────────────────────────────────────────────

// Cria a pasta do cliente. Com GOOGLE_DRIVE_PASTA_PENDENTES configurada, no padrão da equipe e sem
// subpastas; sem ela, o formato antigo ("CPF — Nome" + 5 subpastas na raiz do AM).
export async function criarPastaDoCliente(cliente, deps) {
  const { drive, env } = dependencias(deps);
  const { pendentes } = pastasConfiguradas(env);
  if (pendentes) return drive.criarPasta(nomePastaEquipe(cliente.nome, cliente.polo_passivo), pendentes);
  const pasta = await drive.criarPastaCliente(cliente.cpf || cliente.id, cliente.nome);
  await Promise.all(SUBPASTAS_LEGADO.map(n => drive.criarSubpasta(pasta.id, n)));
  return pasta;
}

// Depois de concluir um protocolo: se o cliente não tem mais protocolo inicial aberto e a pasta
// dele está em Pendentes, move para o Outorgantes do ano. Nunca lança (roda depois do commit).
export async function moverParaOutorgantesSeConcluido(clienteId, { usuarioId = null, ...deps } = {}) {
  const { db, drive, auditar, env } = dependencias(deps);
  try {
    const { pendentesTodas, outorgantes } = pastasConfiguradas(env);
    if (!pendentesTodas.length || !outorgantes.length) return { movida: false, motivo: 'pastas_nao_configuradas' };
    const aberta = await db.queryOne(
      `SELECT 1 FROM tarefas t JOIN cliente_produtos cp ON cp.id = t.cliente_produto_id
        WHERE cp.cliente_id = $1 AND t.tipo = 'protocolar' AND t.status NOT IN ('concluida','cancelada')
          AND t.ciclo_inicio IS NULL LIMIT 1`, [clienteId]);
    if (aberta) return { movida: false, motivo: 'ainda_ha_protocolo_aberto' };
    const cliente = await db.queryOne(`SELECT id, drive_pasta_id FROM clientes WHERE id = $1`, [clienteId]);
    if (!cliente?.drive_pasta_id) return { movida: false, motivo: 'cliente_sem_pasta' };
    const pasta = await drive.dadosDaPasta(cliente.drive_pasta_id);
    const origem = pasta.pais.find(p => pendentesTodas.includes(p));
    if (!origem) return { movida: false, motivo: 'pasta_fora_de_pendentes' };
    await drive.moverPasta(pasta.id, origem, outorgantes[0]);
    await auditar({ usuarioId, acao: 'mover_pasta_outorgantes', entidade: 'cliente', entidadeId: clienteId,
      valorAntes: { pasta_pai: origem }, valorDepois: { pasta_pai: outorgantes[0], pasta: pasta.nome } }).catch(() => {});
    return { movida: true };
  } catch (err) {
    console.error('[Drive/Conciliação] Falha ao mover a pasta para Outorgantes:', err.message);
    return { movida: false, motivo: 'erro', erro: err.message };
  }
}

// ── B) detector ──────────────────────────────────────────────────────────────

async function numerosDoComprovante(pastaId, { db, drive, extrairTexto }) {
  const arquivos = (await drive.listarArquivos(pastaId)).filter(a => ehComprovante(a.nome)).slice(0, 3);
  const numeros = new Set();
  for (const a of arquivos) {
    try {
      const texto = await extrairTexto(await drive.baixarArquivo(a.id));
      for (const n of numerosCnj(texto)) numeros.add(n);
    } catch (err) {
      console.warn('[Drive/Conciliação] Comprovante ilegível:', a.nome, err.message);
    }
  }
  if (!numeros.size) return [];
  // Número já cadastrado como processo no AM não é sugestão (já foi tratado).
  const ja = await db.query(`SELECT numero FROM processos WHERE numero = ANY($1)`, [[...numeros]]);
  const cadastrados = new Set(ja.map(r => r.numero));
  return [...numeros].filter(n => !cadastrados.has(n));
}

// Varre Outorgantes; marca as tarefas abertas cujo cliente já tem pasta lá. Idempotente.
export async function detectarProtocolosNoDrive(deps) {
  const d = dependencias(deps);
  const { db, drive, env } = d;
  const { outorgantes } = pastasConfiguradas(env);
  if (!outorgantes.length) return { configurado: false, marcadas: 0 };
  const clientes = porCliente(await db.query(SQL_TAREFAS_ABERTAS));
  if (!clientes.length) return { configurado: true, marcadas: 0 };

  let marcadas = 0;
  for (const paiId of outorgantes) {
    for (const pasta of await drive.listarSubpastas(paiId)) {
      const { cliente } = clienteDaPasta(pasta, clientes);
      if (!cliente) continue;
      const pendentesDeLeitura = cliente.tarefas.filter(t => !t.drive_protocolo_detectado_em
        || (t.drive_protocolo_pasta_id === pasta.id && !(t.drive_numeros_encontrados || []).length));
      if (!pendentesDeLeitura.length) continue;
      const numeros = await numerosDoComprovante(pasta.id, d);
      for (const t of pendentesDeLeitura) {
        const r = await db.query(
          `UPDATE tarefas
              SET drive_protocolo_detectado_em = COALESCE(drive_protocolo_detectado_em, NOW()),
                  drive_protocolo_pasta_id = $2, drive_protocolo_pasta_url = $3,
                  drive_numeros_encontrados = $4::jsonb
            WHERE id = $1 AND status NOT IN ('concluida','cancelada')
            RETURNING id`,
          [t.tarefa_id, pasta.id, pasta.url || null, JSON.stringify(numeros)]
        );
        if (r.length && !t.drive_protocolo_detectado_em) marcadas++;
      }
    }
  }
  if (marcadas) console.log(`[Drive/Conciliação] ${marcadas} tarefa(s) marcadas como "Protocolado no Drive — falta o número".`);
  return { configurado: true, marcadas };
}

// ── C) relatório e vínculo manual ────────────────────────────────────────────

export async function relatorioConciliacao(deps) {
  const { db, drive, env } = dependencias(deps);
  const { pendentesTodas, outorgantes } = pastasConfiguradas(env);
  if (!pendentesTodas.length && !outorgantes.length) return { configurado: false };

  const tarefas = await db.query(SQL_TAREFAS_ABERTAS);
  const comTarefa = porCliente(tarefas);
  const todos = await db.query(`SELECT id, nome, drive_pasta_id FROM clientes WHERE ativo IS NOT FALSE`);
  const pastasPendentes = [];
  for (const pai of pendentesTodas) pastasPendentes.push(...await drive.listarSubpastas(pai));
  const idsPendentes = new Set(pastasPendentes.map(p => p.id));

  const vincular = [], semCliente = [], ok = [];
  const clientesComPastaPendente = new Set();
  for (const pasta of pastasPendentes) {
    const m = clienteDaPasta(pasta, todos);
    if (!m.cliente) {
      semCliente.push({ pasta, candidatos: m.candidatos.map(c => ({ id: c.id, nome: c.nome })) });
      continue;
    }
    clientesComPastaPendente.add(m.cliente.id);
    const item = { pasta, cliente: { id: m.cliente.id, nome: m.cliente.nome } };
    (m.cliente.drive_pasta_id === pasta.id ? ok : vincular).push(item);
  }

  const protocoladoFora = tarefas
    .filter(t => t.drive_protocolo_detectado_em)
    .map(t => ({ tarefa_id: t.tarefa_id, cliente: { id: t.cliente_id, nome: t.cliente_nome }, produto: t.produto_nome,
      pasta_url: t.drive_protocolo_pasta_url, pasta_id: t.drive_protocolo_pasta_id, numeros: t.drive_numeros_encontrados || [], detectado_em: t.drive_protocolo_detectado_em }));
  const detectados = new Set(protocoladoFora.map(x => x.cliente.id));

  const semPasta = comTarefa
    .filter(c => !clientesComPastaPendente.has(c.id) && !detectados.has(c.id) && !idsPendentes.has(c.drive_pasta_id))
    .map(c => ({ cliente: { id: c.id, nome: c.nome }, tarefas: c.tarefas.map(t => ({ id: t.tarefa_id, produto: t.produto_nome, prazo: t.prazo_data })) }));

  return { configurado: true, vincular, sem_cliente: semCliente, protocolado_fora: protocoladoFora, sem_pasta: semPasta, ok: ok.length };
}

// Liga uma pasta da equipe (em Pendentes ou Outorgantes) ao cliente.
export async function vincularPasta(clienteId, pastaId, { usuarioId = null, ...deps } = {}) {
  const { db, drive, auditar, env } = dependencias(deps);
  const { pendentesTodas, outorgantes } = pastasConfiguradas(env);
  const pasta = await drive.dadosDaPasta(pastaId);
  const permitidas = [...pendentesTodas, ...outorgantes];
  if (pasta.apagada || !pasta.pais.some(p => permitidas.includes(p))) {
    const e = new Error('A pasta precisa estar em Pendentes a protocolar ou em Outorgantes.'); e.status = 400; throw e;
  }
  const antes = await db.queryOne(`SELECT drive_pasta_id, drive_pasta_url FROM clientes WHERE id = $1`, [clienteId]);
  if (!antes) { const e = new Error('Cliente não encontrado.'); e.status = 404; throw e; }
  await db.execute(`UPDATE clientes SET drive_pasta_id = $1, drive_pasta_url = $2 WHERE id = $3`, [pasta.id, pasta.url, clienteId]);
  await auditar({ usuarioId, acao: 'vincular_pasta_drive', entidade: 'cliente', entidadeId: clienteId,
    valorAntes: antes, valorDepois: { drive_pasta_id: pasta.id, drive_pasta_url: pasta.url, pasta: pasta.nome } });
  return { pasta };
}
