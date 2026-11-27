// Pedidos de conferência das folhas de despacho: a rotina escreve a dúvida na linha e o escritório
// responde na tela (Confirmar = "é isso mesmo"; Descartar = "não é").
//
// A resposta vale para um processo + um tipo de pergunta + um documento (a data dele, dd/mm/aaaa).
// Documento de outra data é fato novo: a pergunta volta. A resposta é aplicada na hora ao item da
// última varredura e reaplicada a cada varredura nova, enquanto não for reaberta.
import { createHash } from 'node:crypto';
import { registrarAuditoria } from '../middleware/auditoria.js';
import { filtroVisibilidade } from '../utils/visibilidade.js';

const DATA = '(\\d{2}\\/\\d{2})(?:\\/(\\d{4}))?';
const BLOCO_DESCARTE = 'Analisar: conferência descartada';
// Bloco inteiro "Conferir antes de despachar" (Gabinete, Cartório e Outros órgãos): a rotina sugere o ato,
// mas pede que alguém olhe antes. Confirmado, o item passa ao bloco dos prontos; descartado, vai à Diligência.
export const BLOCO_CONFERIR = 'Conferir antes de despachar';
export const BLOCO_CONFERIDO = 'Despachar (conferido)';
const FOLHAS_BALCAO = ['gabinete', 'cartorio', 'outros'];
// Providência do cartório: no Juizado, o do próprio Juizado; em vara comum, o Núcleo 4.0 (folha Outros órgãos).
const noCartorio = (item, bloco) => {
  const local = /Vara/.test(item.local) ? 'Núcleo 4.0' : item.local;
  return { folha: local === 'Núcleo 4.0' ? 'outros' : 'cartorio', local, bloco };
};
// 'sai' = o item deixa as folhas (volta sozinho se a rotina trouxer fato novo, ou se a resposta for reaberta).
const SAI = { folha: 'sai' };

// Sem documento datado, a referência é o próprio texto da linha: se a rotina mudar o texto (fato novo),
// a pergunta volta. Os trechos "Novo em dd/mm: …" e "novo no rodízio" entram e saem sozinhos e não contam.
export function referenciaTexto(observacao) {
  const limpo = String(observacao || '').replace(/\s+/g, ' ').trim().slice(0, 400)
    .split(' · ').map(x => x.trim()).filter(x => x && !/^Novo em \d\d\/\d\d:/.test(x) && !/^novo no rodízio$/i.test(x)).join(' · ');
  return `t:${createHash('sha1').update(limpo).digest('hex').slice(0, 12)}`;
}

// Cada tipo: como reconhecer a dúvida no texto, os rótulos dos dois botões e o que cada resposta faz.
export const TIPOS = {
  certidao_sapre: {
    padrao: new RegExp(`Certidão do cartório em ${DATA} \\(conferir se é a do SAPRE\\)`),
    confirmar: 'É a certidão de envio ao SAPRE',
    descartar: 'Não é a do SAPRE',
    assunto: 'Certidão de',
    aplicar(item, d, resposta) {
      if (resposta === 'confirmado') return { texto: `Certidão de envio para assinatura em ${d} (SAPRE/GEPRE, conferida)` };
      const nota = `Certidão de ${d} conferida: não é a do SAPRE`;
      // Concluso: a vez é do juiz. Sem conclusão: falta o cartório certificar o envio.
      if (item.concluso) return { folha: 'gabinete', bloco: 'Determinar precatório/RPV', texto: `Concluso: ${item.concluso} · ${nota}` };
      const local = /Vara/.test(item.local) ? 'Núcleo 4.0' : item.local;
      return { folha: local === 'Núcleo 4.0' ? 'outros' : 'cartorio', local, bloco: 'Certificar o envio ao SAPRE', texto: `${nota} · falta a certidão de envio ao SAPRE` };
    },
  },
  rpv_sentenca: {
    padrao: new RegExp(`Sentença publicada em ${DATA}: conferir antes de pedir a RPV`),
    confirmar: 'Pode pedir a RPV',
    descartar: 'Não é caso de RPV',
    assunto: 'Sentença de',
    aplicar(_item, d, resposta) {
      if (resposta === 'confirmado') return { texto: `Sentença publicada em ${d} (conferida: pedir a RPV)` };
      return { folha: 'diligencia', bloco: BLOCO_DESCARTE, texto: `Sentença publicada em ${d} · conferida: não é caso de pedir a RPV` };
    },
  },
  cumprimento_conclusao: {
    padrao: new RegExp(`após nossa petição de ${DATA}: conferir se é cumprimento e pedir conclusão`),
    confirmar: 'É cumprimento: pedir conclusão',
    descartar: 'Não é cumprimento',
    assunto: 'Petição de',
    aplicar(_item, d, resposta) {
      if (resposta === 'confirmado') return { bloco: 'Pedir conclusão para homologar o cumprimento', texto: `após nossa petição de ${d} (conferida: é cumprimento)` };
      return { folha: 'diligencia', bloco: BLOCO_DESCARTE, texto: `após nossa petição de ${d} · conferida: não é cumprimento` };
    },
  },
  despacho_alvara: {
    padrao: new RegExp(`Juiz despachou em ${DATA} · cartório expedir o alvará no BRBJus \\(conferir o despacho\\)`),
    confirmar: 'O despacho determinou o alvará',
    descartar: 'O despacho não determinou o alvará',
    assunto: 'Despacho de',
    aplicar(_item, d, resposta) {
      if (resposta === 'confirmado') return { texto: `Juiz despachou em ${d} · cartório expedir o alvará no BRBJus (despacho conferido)` };
      return { folha: 'diligencia', bloco: BLOCO_DESCARTE, texto: `Juiz despachou em ${d} · conferido: o despacho não determinou o alvará` };
    },
  },
  // ── Blocos inteiros "Conferir…": a pergunta é o próprio bloco; a referência é o texto da linha. ──
  antes_despachar: {
    blocos: [BLOCO_CONFERIR], folhas: FOLHAS_BALCAO, assunto: 'Antes de despachar',
    confirmar: 'Conferido: pode despachar', descartar: 'Não é para despachar',
    bloco: (_i, r) => (r === 'confirmado' ? { bloco: BLOCO_CONFERIDO } : { folha: 'diligencia', bloco: BLOCO_DESCARTE, nota: 'conferido: não é para despachar' }),
  },
  transito_sem_ato: {
    blocos: ['Conferir trânsito sem ato posterior'], folhas: ['diligencia'], assunto: 'Trânsito sem ato posterior',
    confirmar: 'Transitou: iniciar cumprimento', descartar: 'Nada a fazer: tirar da lista',
    bloco: (_i, r) => (r === 'confirmado' ? { bloco: 'Iniciar cumprimento' } : SAI),
  },
  arquivado_pendencia: {
    blocos: ['Conferir processo arquivado com pendência'], assunto: 'Arquivado com pendência',
    confirmar: 'Há pendência: desarquivar', descartar: 'Sem pendência: tirar da lista',
    bloco: (_i, r) => (r === 'confirmado' ? { bloco: 'Desarquivar e agir' } : SAI),
  },
  rpv_deposito: {
    blocos: ['Conferir depósito de RPV vencida'], folhas: ['diligencia'], assunto: 'Depósito de RPV vencida',
    confirmar: 'Não houve depósito: cobrar', descartar: 'Foi depositado: pedir alvará', validadeDias: 30,
    bloco: (i, r) => (r === 'confirmado' ? { bloco: 'Cobrar depósito da RPV' } : { ...noCartorio(i, 'Pedir conclusão para determinar alvará'), nota: 'conferido: RPV depositada' }),
  },
  sem_pagamento: {
    blocos: ['Conferir RPV ou precatório sem pagamento', 'Conferir RPV sem pagamento', 'Conferir precatório sem pagamento'], folhas: ['diligencia'], assunto: 'Requisição sem pagamento',
    confirmar: 'Segue sem pagamento', descartar: 'Foi pago: tirar da lista', validadeDias: 30,
    bloco: (_i, r) => (r === 'confirmado' ? {} : SAI),
  },
  recurso_sentenca: {
    blocos: ['Conferir recurso ou sentença'], folhas: ['diligencia'], assunto: 'Recurso ou sentença',
    confirmar: 'Há o que fazer: manter', descartar: 'Nada a fazer: tirar da lista',
    bloco: (_i, r) => (r === 'confirmado' ? {} : SAI),
  },
  fase_calculos: {
    blocos: ['Conferir fase dos cálculos'], folhas: ['diligencia'], assunto: 'Fase dos cálculos',
    confirmar: 'Cálculos homologados: fazer formulário', descartar: 'Ainda não homologados',
    bloco: (_i, r) => (r === 'confirmado' ? { bloco: 'Fazer formulário de precatório/RPV' } : {}),
  },
  // A minuta do precatório é do cartório (Juizado: o do próprio Juizado; vara comum: Núcleo 4.0). O que cabe
  // ao escritório é o formulário: com ele nos autos, a cobrança é de balcão; sem ele, é trabalho interno.
  minuta_precatorio: {
    blocos: ['Fazer minuta de precatório'], folhas: ['diligencia'], assunto: 'Minuta de precatório',
    confirmar: 'Formulário juntado: cartório expedir a minuta', descartar: 'Falta o nosso formulário',
    bloco: (i, r) => (r === 'confirmado' ? { ...noCartorio(i, 'Expedir minuta de precatório'), nota: 'conferido: formulário juntado, falta a minuta' } : { bloco: 'Fazer formulário de precatório/RPV' }),
  },
  cumprimento_antes: {
    blocos: ['Conferir cumprimento antes da conclusão'], folhas: ['diligencia'], assunto: 'Cumprimento antes da conclusão',
    confirmar: 'Pode pedir a conclusão', descartar: 'Não é o caso: tirar da lista',
    bloco: (i, r) => (r === 'confirmado' ? noCartorio(i, 'Pedir conclusão para homologar o cumprimento') : SAI),
  },
};
// "Conferir prazo da Fazenda" fica de fora de propósito: é espera com data, que a rotina resolve pela aba Expedientes.
const tipoDoBloco = item => Object.entries(TIPOS).find(([, t]) => t.blocos?.includes(item.bloco) && (!t.folhas || t.folhas.includes(item.folha)))?.[0] || null;

const RE_REFERENCIA = /^(\d{2}\/\d{2}\/\d{4}|t:[0-9a-f]{12})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const diaBrasilia = data => new Date(data || Date.now()).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

// O texto da folha traz só dd/mm. O ano é o mais recente em que a data não fica no futuro.
export function referenciaCheia(ddmm, ano, base) {
  if (ano) return `${ddmm}/${ano}`;
  const hoje = diaBrasilia(base);
  const anoBase = Number(hoje.slice(0, 4));
  const [d, m] = ddmm.split('/');
  return `${ddmm}/${`${m}-${d}` > hoje.slice(5) ? anoBase - 1 : anoBase}`;
}

// Reconhece o pedido de conferência pelo texto da linha (para varreduras que não marcam o tipo).
// `item` (folha e bloco) é opcional: com ele, vale também o bloco inteiro "Conferir antes de despachar".
export function detectarConferencia(observacao, base, item) {
  for (const [tipo, t] of Object.entries(TIPOS)) {
    const m = t.padrao && observacao ? t.padrao.exec(observacao) : null;
    if (m) return { tipo, referencia: referenciaCheia(m[1], m[2], base), pendente: true };
  }
  const tipo = item ? tipoDoBloco(item) : null;
  return tipo ? { tipo, referencia: referenciaTexto(observacao), pendente: true } : null;
}

// Marca enviada pela rotina: { tipo, referencia: 'dd/mm/aaaa', pendente }. Inválida = ignorada.
export function validarConferencia(c) {
  if (!c || typeof c !== 'object' || !Object.hasOwn(TIPOS, c.tipo) || !RE_REFERENCIA.test(String(c.referencia || ''))) return null;
  return { tipo: c.tipo, referencia: c.referencia, pendente: c.pendente !== false };
}

// O que a linha passa a ser depois da resposta. Devolve { folha, local, bloco, observacao }.
export function aplicarResposta(item, tipo, resposta) {
  const t = TIPOS[tipo];
  const obs = item.observacao || '';
  if (t.bloco) {
    const r = tipoDoBloco(item) === tipo ? t.bloco(item, resposta) : {};
    return {
      folha: r.folha || item.folha, local: r.local || item.local, bloco: r.bloco || item.bloco,
      observacao: r.nota ? [obs, r.nota].filter(Boolean).join(' · ').slice(0, 400) : (item.observacao ?? null),
    };
  }
  const m = t.padrao.exec(obs);
  if (!m) return { folha: item.folha, local: item.local, bloco: item.bloco, observacao: item.observacao ?? null };
  const r = t.aplicar(item, m[1], resposta);
  return {
    folha: r.folha || item.folha,
    local: r.local || item.local,
    bloco: r.bloco || item.bloco,
    observacao: obs.replace(m[0], r.texto).slice(0, 400),
  };
}

// Dinheiro a receber não pode ficar calado: "não houve depósito" e "segue sem pagamento" valem 30 dias.
// Passado o prazo, a resposta sai de vigor e a pergunta volta na varredura seguinte.
export const TIPOS_COM_VALIDADE = Object.entries(TIPOS).filter(([, t]) => t.validadeDias).map(([tipo]) => tipo);
export const VALIDADE_DIAS = 30;
export async function expirarConferencias(conexao, auditar = registrarAuditoria) {
  const r = await conexao.execute(
    `UPDATE despachos_conferencias SET desfeito_em = NOW(), desfeito_por_nome = 'validade de 30 dias'
      WHERE desfeito_em IS NULL AND resposta = 'confirmado' AND tipo = ANY($1) AND respondido_em < NOW() - make_interval(days => $2)`,
    [TIPOS_COM_VALIDADE, VALIDADE_DIAS],
  );
  const n = r?.rowCount || 0;
  if (n) await auditar({ acao: 'expirar_conferencias_despacho', entidade: 'despachos_conferencia', valorDepois: { expiradas: n, validade_dias: VALIDADE_DIAS } }, conexao);
  return n;
}

// Na gravação da varredura: marca o pedido em cada item e reaplica as respostas em vigor.
export async function aplicarConferencias(tx, itens, base) {
  const marcados = itens.map(i => ({ i, c: i.conferencia || detectarConferencia(i.observacao, base, i) }));
  for (const { i } of marcados) delete i.conferencia;
  const comPedido = marcados.filter(x => x.c);
  if (!comPedido.length) return itens;
  const respostas = await tx.query(
    `SELECT id, processo_id, tipo, referencia, resposta FROM despachos_conferencias
      WHERE desfeito_em IS NULL AND processo_id = ANY($1::uuid[])`,
    [[...new Set(comPedido.map(x => x.i.processo_id))]],
  );
  const porChave = new Map(respostas.map(r => [`${r.processo_id}|${r.tipo}|${r.referencia}`, r]));
  for (const { i, c } of comPedido) {
    const r = porChave.get(`${i.processo_id}|${c.tipo}|${c.referencia}`);
    // A rotina já aplicou uma resposta que não está mais em vigor: a linha segue sem botões até a próxima varredura.
    if (!r && !c.pendente) continue;
    i.conferencia_tipo = c.tipo;
    i.conferencia_ref = c.referencia;
    if (!r) continue;
    i.conferencia_id = r.id;
    if (c.pendente) Object.assign(i, aplicarResposta(i, c.tipo, r.resposta));
  }
  return itens;
}

// Para a tela: pedido pendente (com os rótulos dos botões) ou resposta já dada, em cada linha.
export function conferenciaDoItem(item, respostasPorId, base) {
  const c = item.conferencia_tipo && Object.hasOwn(TIPOS, item.conferencia_tipo)
    ? { tipo: item.conferencia_tipo, referencia: item.conferencia_ref }
    : detectarConferencia(item.observacao, base, item);
  if (!c) return null;
  const r = item.conferencia_id ? respostasPorId.get(item.conferencia_id) : null;
  if (item.conferencia_id && !r) return null;
  const t = TIPOS[c.tipo];
  return {
    tipo: c.tipo, referencia: c.referencia, confirmar: t.confirmar, descartar: t.descartar,
    resposta: r ? { id: r.id, resposta: r.resposta, por: r.usuario_nome, em: r.respondido_em } : null,
  };
}

const descricao = r => `${TIPOS[r.tipo]?.assunto || 'Documento de'}${String(r.referencia).startsWith('t:') ? '' : ` ${r.referencia}`}: ${r.resposta === 'confirmado' ? TIPOS[r.tipo]?.confirmar : TIPOS[r.tipo]?.descartar}`;

export async function listarRespondidas(conexao, user) {
  const linhas = await conexao.query(
    `SELECT c.id, c.processo_id, p.numero, c.tipo, c.referencia, c.resposta, c.usuario_nome, c.respondido_em, c.estado_anterior, c.resultado
       FROM despachos_conferencias c JOIN processos p ON p.id = c.processo_id
      WHERE c.desfeito_em IS NULL ${filtroVisibilidade(user, 'p')}
      ORDER BY c.respondido_em DESC LIMIT 200`,
  );
  return linhas.filter(r => Object.hasOwn(TIPOS, r.tipo));
}

export const paraTela = r => ({
  id: r.id, processo_id: r.processo_id, numero: r.numero, tipo: r.tipo, referencia: r.referencia, resposta: r.resposta,
  por: r.usuario_nome, em: r.respondido_em, descricao: descricao(r),
  de: { folha: r.estado_anterior?.folha, bloco: r.estado_anterior?.bloco },
  para: { folha: r.resultado?.folha, bloco: r.resultado?.bloco },
});

const ultimaVarredura = tx => tx.queryOne('SELECT id, executada_em FROM despachos_varreduras ORDER BY executada_em DESC, criado_em DESC LIMIT 1');

// POST /api/despachos/conferencias { processo_id, tipo, referencia, resposta }
export function criarRespostaConferencia(conexao, auditar = registrarAuditoria) {
  return async (req, res) => {
    const { processo_id: processoId, tipo, referencia, resposta } = req.body || {};
    if (!UUID.test(String(processoId || '')) || !Object.hasOwn(TIPOS, String(tipo)) || !RE_REFERENCIA.test(String(referencia || '')) || !['confirmado', 'descartado'].includes(resposta)) {
      return res.status(400).json({ ok: false, erro: 'Resposta inválida.' });
    }
    try {
      const saida = await conexao.transaction(async (tx) => {
        const varredura = await ultimaVarredura(tx);
        if (!varredura) return { status: 404, erro: 'Ainda não há varredura registrada.' };
        const itens = await tx.query(
          `SELECT d.id, d.folha, d.local, d.bloco, d.observacao, d.concluso, d.conferencia_tipo, d.conferencia_ref, d.conferencia_id,
                  d.acervo, d.dias_parado, d.ultimo_andamento, d.lido_no_pje
             FROM despachos_itens d JOIN processos p ON p.id = d.processo_id
            WHERE d.varredura_id = $1 AND d.processo_id = $2 ${filtroVisibilidade(req.user, 'p')}
            FOR UPDATE OF d`,
          [varredura.id, processoId],
        );
        const item = itens.find((i) => {
          if (i.conferencia_id) return false;
          const c = i.conferencia_tipo ? { tipo: i.conferencia_tipo, referencia: i.conferencia_ref } : detectarConferencia(i.observacao, varredura.executada_em, i);
          return c && c.tipo === tipo && c.referencia === referencia;
        });
        if (!item) return { status: 404, erro: 'Este pedido de conferência não está mais na folha. Atualize a tela.' };
        const ja = await tx.queryOne(
          'SELECT id FROM despachos_conferencias WHERE processo_id = $1 AND tipo = $2 AND referencia = $3 AND desfeito_em IS NULL',
          [processoId, tipo, referencia],
        );
        if (ja) return { status: 409, erro: 'Esta conferência já foi respondida. Atualize a tela.' };
        // O estado anterior guarda a linha inteira: se ela sair da lista, a reabertura a recria.
        const anterior = { folha: item.folha, local: item.local, bloco: item.bloco, observacao: item.observacao,
          acervo: item.acervo ?? null, dias_parado: item.dias_parado ?? null, concluso: item.concluso ?? null, ultimo_andamento: item.ultimo_andamento ?? null, lido_no_pje: item.lido_no_pje !== false };
        const resultado = aplicarResposta(item, tipo, resposta);
        const nova = await tx.queryOne(
          `INSERT INTO despachos_conferencias (processo_id, tipo, referencia, resposta, usuario_id, usuario_nome, estado_anterior, resultado)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb) RETURNING id, respondido_em`,
          [processoId, tipo, referencia, resposta, req.user?.id || null, req.user?.nome || null, JSON.stringify(anterior), JSON.stringify(resultado)],
        );
        if (resultado.folha === 'sai') await tx.execute('DELETE FROM despachos_itens WHERE id = $1', [item.id]);
        else await tx.execute(
          `UPDATE despachos_itens SET folha = $2, local = $3, bloco = $4, observacao = $5,
                  conferencia_tipo = $6, conferencia_ref = $7, conferencia_id = $8 WHERE id = $1`,
          [item.id, resultado.folha, resultado.local, resultado.bloco, resultado.observacao, tipo, referencia, nova.id],
        );
        await auditar({
          usuarioId: req.user?.id, acao: 'responder_conferencia_despacho', entidade: 'despachos_conferencia', entidadeId: nova.id,
          valorAntes: anterior, valorDepois: { processo_id: processoId, tipo, referencia, resposta, ...resultado }, ip: req._ip,
        }, tx);
        return { id: nova.id, resultado };
      });
      if (saida.erro) return res.status(saida.status).json({ ok: false, erro: saida.erro });
      return res.json({ ok: true, ...saida });
    } catch (err) {
      console.error('[Despachos] Falha ao responder conferência:', err.message);
      return res.status(500).json({ ok: false, erro: 'Não foi possível gravar a resposta.' });
    }
  };
}

// DELETE /api/despachos/conferencias/:id — reabre a pergunta e devolve a linha ao que era.
export function criarReaberturaConferencia(conexao, auditar = registrarAuditoria) {
  return async (req, res) => {
    const id = String(req.params?.id || '');
    if (!UUID.test(id)) return res.status(400).json({ ok: false, erro: 'Conferência inválida.' });
    try {
      const saida = await conexao.transaction(async (tx) => {
        const c = await tx.queryOne(
          `SELECT c.id, c.processo_id, c.tipo, c.referencia, c.resposta, c.estado_anterior, c.resultado
             FROM despachos_conferencias c JOIN processos p ON p.id = c.processo_id
            WHERE c.id = $1 AND c.desfeito_em IS NULL ${filtroVisibilidade(req.user, 'p')}
            FOR UPDATE OF c`,
          [id],
        );
        if (!c) return { status: 404, erro: 'Conferência não encontrada ou já reaberta.' };
        await tx.execute(
          'UPDATE despachos_conferencias SET desfeito_em = NOW(), desfeito_por = $2, desfeito_por_nome = $3 WHERE id = $1',
          [id, req.user?.id || null, req.user?.nome || null],
        );
        const varredura = await ultimaVarredura(tx);
        const a = c.estado_anterior || {};
        const r = varredura && a.folha ? await tx.execute(
          `UPDATE despachos_itens SET folha = $3, local = $4, bloco = $5, observacao = $6, conferencia_id = NULL
            WHERE varredura_id = $1 AND conferencia_id = $2`,
          [varredura.id, id, a.folha, a.local, a.bloco, a.observacao ?? null],
        ) : { rowCount: 0 };
        // A resposta tinha tirado o item da lista: ele volta para a folha atual, como estava.
        if (varredura && a.folha && !r.rowCount && c.resultado?.folha === 'sai') {
          const n = await tx.execute(
            `INSERT INTO despachos_itens (varredura_id, processo_id, folha, local, acervo, bloco, observacao, dias_parado, concluso, ultimo_andamento, lido_no_pje, conferencia_tipo, conferencia_ref)
             SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
              WHERE NOT EXISTS (SELECT 1 FROM despachos_itens WHERE varredura_id = $1 AND processo_id = $2 AND folha = $3 AND bloco = $6)`,
            [varredura.id, c.processo_id, a.folha, a.local, a.acervo ?? null, a.bloco, a.observacao ?? null, a.dias_parado ?? null,
              a.concluso ?? null, a.ultimo_andamento ?? null, a.lido_no_pje !== false, c.tipo, c.referencia],
          );
          r.rowCount = n.rowCount || 0;
        }
        await auditar({
          usuarioId: req.user?.id, acao: 'reabrir_conferencia_despacho', entidade: 'despachos_conferencia', entidadeId: id,
          valorAntes: { tipo: c.tipo, referencia: c.referencia, resposta: c.resposta },
          valorDepois: { processo_id: c.processo_id, itens_restaurados: r.rowCount || 0 }, ip: req._ip,
        }, tx);
        return { id, itens_restaurados: r.rowCount || 0 };
      });
      if (saida.erro) return res.status(saida.status).json({ ok: false, erro: saida.erro });
      return res.json({ ok: true, ...saida });
    } catch (err) {
      console.error('[Despachos] Falha ao reabrir conferência:', err.message);
      return res.status(500).json({ ok: false, erro: 'Não foi possível reabrir a conferência.' });
    }
  };
}

// GET /api/integracoes/v1/despachos/conferencias — a rotina busca as respostas em vigor antes de montar as folhas.
export function criarListaConferenciasExterna(conexao) {
  return async (_req, res) => {
    try {
      await expirarConferencias(conexao);
      const linhas = await conexao.query(
        `SELECT p.numero, c.tipo, c.referencia, c.resposta, c.usuario_nome AS por, c.respondido_em AS em, c.resultado
           FROM despachos_conferencias c JOIN processos p ON p.id = c.processo_id
          WHERE c.desfeito_em IS NULL ORDER BY c.respondido_em`,
      );
      return res.json({ ok: true, respostas: linhas });
    } catch (err) {
      console.error('[Despachos] Falha ao listar conferências:', err.message);
      return res.status(500).json({ ok: false, erro: 'Não foi possível listar as conferências.' });
    }
  };
}
