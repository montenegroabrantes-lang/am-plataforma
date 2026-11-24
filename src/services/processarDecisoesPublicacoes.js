// Decisões do acervo pelas publicações, etapa 2 (24/11/2026): roda depois de cada importação de publicações
// (script local e botão da tela) e, na etapa 3, no reprocessamento. Spec "AM - Spec Decisoes pelas
// Publicacoes.md" (Drive). Para cada publicação de sentença, acórdão ou decisão de processo com peça pendente
// no acervo, registra a decisão pelo mesmo caminho da rotina das 15h (registrarDecisao, fonte "Diário"):
// precedente não conferido com o link da publicação, tarefa de conferência e aviso por WhatsApp.
//
// Quem recebe a tarefa (o mesmo critério dos prazos das publicações): o Master responsável pelo processo;
// sem ele, quem importou pelo navegador; na importação do script (sem usuário), o Master ativo mais antigo.
// Age sem acesso a registros restritos. Falha numa publicação não interrompe as outras.

import { db } from '../db/index.js';
import { registrarDecisao } from '../routes/acervo.js';
import { dadosDaDecisao, escolherPeca } from './decisoesPublicacoes.js';

export async function processarPublicacoes(ids, { usuarioImportacao = null, simular = false, banco = db, registrar = registrarDecisao } = {}) {
  const lista = [...new Set((ids ?? []).map(String))].filter(Boolean);
  const res = { analisadas: 0, decisoes: 0, registradas: 0, ja_registradas: 0, sem_peca: 0, erros: 0, itens: [] };
  if (!lista.length) return res;
  const pubs = await banco.query(
    `SELECT p.id, p.processo_id, p.numero_processo_raw, p.numero_processo, p.data_disponibilizacao::text AS data_disponibilizacao, p.tribunal, p.orgao,
            p.tipo_documento, p.texto, p.link, pr.master_responsavel_id
       FROM publicacoes p LEFT JOIN processos pr ON pr.id = p.processo_id
      WHERE p.id::text = ANY($1::text[]) AND NOT COALESCE(p.cancelada, false)`, [lista]);
  let masterPadrao;
  for (const pub of pubs) {
    res.analisadas++;
    const dados = dadosDaDecisao(pub);
    if (!dados) continue;
    res.decisoes++;
    const digitos = String(pub.numero_processo_raw || pub.numero_processo || '').replace(/\D/g, '');
    const pecas = await banco.query(
      `SELECT a.id, a.tipo_peca, a.resultado, a.decisao_id, a.arquivada_em, a.data_protocolo::text AS data_protocolo, a.processo_numero
         FROM acervo_pecas a
        WHERE a.arquivada_em IS NULL AND a.visibilidade_snapshot = 'normal'
          AND (($1::uuid IS NOT NULL AND a.processo_id = $1::uuid) OR ($2 <> '' AND REGEXP_REPLACE(COALESCE(a.processo_numero,''), '[^0-9]', '', 'g') = $2))`,
      [pub.processo_id ?? null, digitos]);
    const peca = escolherPeca(pecas, dados);
    const base = { publicacao_id: String(pub.id), processo: pub.numero_processo || digitos, tipo: dados.tipo_decisao, data: dados.data, resultado: dados.resultado ?? 'a confirmar' };
    if (!peca) { res.sem_peca++; if (pecas.length) res.itens.push({ ...base, situacao: 'sem peça apta' }); continue; }
    if (simular) { res.itens.push({ ...base, peca_id: peca.id, tipo_peca: peca.tipo_peca, situacao: 'registraria', evidencia: dados.evidencia }); continue; }
    try {
      if (masterPadrao === undefined && !pub.master_responsavel_id && !usuarioImportacao) {
        masterPadrao = (await banco.queryOne(`SELECT id FROM usuarios WHERE perfil='master' AND ativo=true ORDER BY criado_em NULLS LAST, id LIMIT 1`))?.id ?? null;
      }
      const responsavel = pub.master_responsavel_id || usuarioImportacao || masterPadrao;
      if (!responsavel) throw new Error('nenhum Master ativo para receber a tarefa');
      const req = { user: { id: responsavel, perfil: 'master', pode_marcar_restrito: false }, _ip: null };
      const r = await registrar(req, peca.id, { data_decisao: dados.data, resultado: dados.resultado, evidencia: dados.evidencia, tipo_decisao: dados.tipo_decisao, documento_url: pub.link || null }, { fonte: 'Diário' });
      if (r.status === 201) { res.registradas++; res.itens.push({ ...base, peca_id: peca.id, situacao: 'registrada', tarefa_id: r.body.tarefa?.id ?? null }); }
      else if (r.status === 409) { res.ja_registradas++; }
      else { res.erros++; res.itens.push({ ...base, peca_id: peca.id, situacao: `erro ${r.status}` }); }
    } catch (e) {
      res.erros++; res.itens.push({ ...base, peca_id: peca.id, situacao: `erro: ${String(e.message).slice(0, 200)}` });
    }
  }
  if (res.decisoes) console.log(`[DecisoesPublicacoes] ${JSON.stringify({ ...res, itens: undefined })}`);
  return res;
}

// Depois de responder à importação: não segura a resposta e nunca derruba quem importou.
export function processarEmSeguida(ids, opcoes) {
  if (!ids?.length) return;
  setImmediate(() => { processarPublicacoes(ids, opcoes).catch(err => console.warn('[DecisoesPublicacoes] Falhou:', err.message)); });
}
