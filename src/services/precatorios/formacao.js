// 27/11/2026 — Precatórios em formação e alvarás a receber.
// As duas faixas da tela Precatórios saem da última varredura do PJe (folhas de despacho): cada
// passo é um conjunto de "blocos" que a rotina /varredura-despachos já classifica. Nada é digitado.
// Quando a rotina informa que o juiz assinou ("ofício requisitório de precatório juntado"), a ficha
// do precatório nasce sozinha, ligada ao processo de origem, ainda sem o número do tribunal.
import { registrarAuditoria } from '../../middleware/auditoria.js';
import { filtroVisibilidade } from '../../utils/visibilidade.js';

const NUMERO_CNJ = /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/;
// Precatório do TJPB corre no 2º grau: o número termina em 8.15.0000.
const NUMERO_PRECATORIO_TJPB = /^\d{7}-\d{2}\.\d{4}\.8\.15\.0000$/;
export const numeroPrecatorioValido = v => typeof v === 'string' && NUMERO_PRECATORIO_TJPB.test(v.trim());

export const BLOCO_INTIMACAO_ALVARA = 'Cumprir intimação pessoal para o alvará';

// `folhas` restringe o passo a certas folhas (o mesmo bloco "Expedir alvará" está com o juiz no
// gabinete e com o cartório quando falta a conclusão).
export const PASSOS_PRECATORIO = [
  { chave: 'formulario', nome: 'Fazer o formulário', quem: 'Escritório', blocos: ['Fazer formulário de precatório/RPV', 'Fazer minuta de precatório'] },
  { chave: 'falta_minuta', nome: 'Falta a minuta', quem: 'Cartório', blocos: ['Formulário juntado: falta a minuta do precatório'] },
  { chave: 'concordancia', nome: 'Juntar concordância', quem: 'Escritório', blocos: ['Juntar concordância', 'Confirmar minuta de precatório'] },
  { chave: 'certidao_sapre', nome: 'Certificar envio ao SAPRE', quem: 'Cartório', blocos: ['Certificar o envio ao SAPRE'] },
  { chave: 'assinar', nome: 'Assinar no SAPRE', quem: 'Juiz', blocos: ['Assinar precatório no SAPRE'] },
];
export const PASSOS_ALVARA = [
  { chave: 'pedir_conclusao', nome: 'Pedir conclusão', quem: 'Cartório', blocos: ['Pedir conclusão para expedir alvará', 'Expedir alvará'], folhas: ['cartorio', 'outros'] },
  { chave: 'concluso', nome: 'Concluso para deferir', quem: 'Juiz', blocos: ['Expedir alvará'], folhas: ['gabinete'] },
  { chave: 'intimacao_pessoal', nome: 'Intimação pessoal exigida', quem: 'Escritório', blocos: [BLOCO_INTIMACAO_ALVARA] },
  { chave: 'assinar', nome: 'Assinar no BRBJus', quem: 'Juiz', blocos: ['Assinar alvará no BRBJus'] },
];
// RPV: paga no próprio processo. O bloco antigo "RPV ou precatório sem pagamento" é misto: entra aqui
// só o processo que não é origem de um precatório cadastrado (esse já é acompanhado pela ficha).
export const BLOCO_MISTO_SEM_PAGAMENTO = 'Conferir RPV ou precatório sem pagamento';
export const PASSOS_RPV = [
  { chave: 'expedir', nome: 'Expedir RPV', quem: 'Cartório', blocos: ['Expedir RPV'], folhas: ['cartorio', 'outros'] },
  { chave: 'concluso', nome: 'Concluso para expedir', quem: 'Juiz', blocos: ['Expedir RPV'], folhas: ['gabinete'] },
  { chave: 'sem_pagamento', nome: 'Expedida, sem pagamento', quem: 'Fazenda', blocos: ['Conferir RPV sem pagamento', BLOCO_MISTO_SEM_PAGAMENTO] },
  { chave: 'vencida', nome: 'Depósito vencido', quem: 'Escritório', blocos: ['Conferir depósito de RPV vencida'] },
];
export const itensDeRpv = itens => itens.filter(i => !(i.bloco === BLOCO_MISTO_SEM_PAGAMENTO && i.tem_precatorio));
export const BLOCOS_DAS_FAIXAS = [...new Set([...PASSOS_PRECATORIO, ...PASSOS_ALVARA, ...PASSOS_RPV].flatMap(p => p.blocos))];

const passoDe = (passos, item) => passos.find(p => p.blocos.includes(item.bloco) && (!p.folhas || p.folhas.includes(item.folha)));

// Distribui os itens da varredura nos passos. Um processo aparece uma vez por passo.
export function montarFaixa(passos, itens) {
  const saida = passos.map(({ chave, nome, quem }) => ({ chave, nome, quem, total: 0, itens: [] }));
  const porChave = new Map(saida.map(p => [p.chave, p]));
  const vistos = new Set();
  for (const item of itens) {
    const passo = passoDe(passos, item);
    if (!passo) continue;
    const marca = `${passo.chave}|${item.processo_id}`;
    if (vistos.has(marca)) continue;
    vistos.add(marca);
    const alvo = porChave.get(passo.chave);
    alvo.itens.push({ processo_id: item.processo_id, numero: item.numero, cliente_nome: item.cliente_nome || null, local: item.local || null,
      observacao: item.observacao || null, concluso: item.concluso || null, dias_parado: item.dias_parado ?? null });
    alvo.total += 1;
  }
  for (const p of saida) p.itens.sort((a, b) => (b.dias_parado ?? -1) - (a.dias_parado ?? -1) || String(a.numero).localeCompare(String(b.numero)));
  return saida;
}

// Saída da folha que significa "o juiz assinou o precatório".
export const ehAssinaturaDePrecatorio = saida => /of[ií]cio requisit[óo]rio de precat[óo]rio/i.test(String(saida?.motivo || ''));
export const ehAlvaraPago = saida => /^alvar[áa] pago/i.test(String(saida?.motivo || ''));

// Mesmo credor: nome igual sem acento/caixa, ou primeiro e último nomes iguais (fichas antigas abreviam o meio).
const normal = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
export function mesmoCredor(a, b) {
  const x = normal(a), y = normal(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const px = x.split(' '), py = y.split(' ');
  return px.length > 1 && py.length > 1 && px[0] === py[0] && px.at(-1) === py.at(-1);
}

const curto = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// Cria a ficha dos precatórios assinados que ainda não têm ficha, e completa o número do tribunal
// das que estavam sem. `saidas` vem da varredura já validada. Devolve o que fez.
export async function registrarAssinados(tx, saidas, { auditar = registrarAuditoria, ip = null } = {}) {
  const assinadas = saidas.filter(ehAssinaturaDePrecatorio);
  const feito = { fichas_criadas: 0, numeros_preenchidos: 0, origens_vinculadas: 0 };
  if (!assinadas.length) return feito;
  const processos = await tx.query(
    `SELECT p.id, p.numero, p.cliente_id, p.polo_ativo, p.polo_passivo, c.nome AS cliente_nome
       FROM processos p LEFT JOIN clientes c ON c.id = p.cliente_id WHERE p.numero = ANY($1)`, [[...new Set(assinadas.map(s => s.numero))]]);
  const porNumero = new Map(processos.map(p => [p.numero, p]));
  for (const s of assinadas) {
    const proc = porNumero.get(s.numero);
    if (!proc) continue;
    const numeroTribunal = numeroPrecatorioValido(s.precatorio_numero) ? s.precatorio_numero.trim() : null;
    if (numeroTribunal) {
      // Veio o número do tribunal (lido no 2º grau). A chave é o número: um processo de origem pode
      // gerar mais de um precatório (o do credor e o dos honorários).
      const emUso = await tx.queryOne(`SELECT id FROM precatorios WHERE numero = $1`, [numeroTribunal]);
      if (emUso) {
        // Já tem ficha (cadastrada à mão, sem a origem): só liga a origem.
        const r = await tx.execute(`UPDATE precatorios SET processo_origem_id = $2, numero_origem = $3, cliente_id = COALESCE(cliente_id, $4), atualizado_em = NOW() WHERE id = $1 AND processo_origem_id IS NULL`,
          [emUso.id, proc.id, proc.numero, proc.cliente_id]);
        if (r?.rowCount) {
          await auditar({ acao: 'vincular_origem_precatorio', entidade: 'precatorio', entidadeId: emUso.id, valorDepois: { numero_origem: proc.numero, motivo: 'processo de referência lido no 2º grau' }, ip }, tx);
          feito.origens_vinculadas += 1;
        }
        continue;
      }
      const aguardando = await tx.queryOne(
        `SELECT id, numero FROM precatorios WHERE (processo_origem_id = $1 OR numero_origem = $2) AND numero IS NULL ORDER BY criado_em LIMIT 1`, [proc.id, proc.numero]);
      if (aguardando) {
        await tx.execute(`UPDATE precatorios SET numero = $2, etapa = CASE WHEN etapa IN ('minuta_juntada','enviado_sapre','assinado','remetido') THEN 'autuado' ELSE etapa END, atualizado_em = NOW() WHERE id = $1`, [aguardando.id, numeroTribunal]);
        await tx.execute(`INSERT INTO precatorio_eventos (precatorio_id, campo, de, para) VALUES ($1, 'numero', NULL, $2)`, [aguardando.id, numeroTribunal]);
        await auditar({ acao: 'preencher_numero_precatorio', entidade: 'precatorio', entidadeId: aguardando.id, valorDepois: { numero: numeroTribunal }, ip }, tx);
        feito.numeros_preenchidos += 1;
        continue;
      }
    } else {
      // Sem número: o juiz assinou no 1º grau. Se o processo já tem ficha, não cria outra.
      const ficha = await tx.queryOne(
        `SELECT id, numero FROM precatorios WHERE processo_origem_id = $1 OR numero_origem = $2 ORDER BY criado_em LIMIT 1`, [proc.id, proc.numero]);
      if (ficha) continue;
    }
    const nomeCredor = proc.cliente_nome || proc.polo_ativo;
    if (!numeroTribunal) {
    // Ficha antiga cadastrada à mão, sem origem, do mesmo credor: é o mesmo precatório. Liga a origem
    // em vez de criar outra (só quando há exatamente uma candidata; na dúvida, cria e a equipe decide).
    const soltas = await tx.query(`SELECT id, credor_nome FROM precatorios WHERE processo_origem_id IS NULL AND numero_origem IS NULL AND numero IS NOT NULL`, []);
    const iguais = soltas.filter(f => mesmoCredor(f.credor_nome, nomeCredor));
    if (iguais.length === 1) {
      await tx.execute(`UPDATE precatorios SET processo_origem_id = $2, numero_origem = $3, cliente_id = COALESCE(cliente_id, $4), atualizado_em = NOW() WHERE id = $1 AND processo_origem_id IS NULL`,
        [iguais[0].id, proc.id, proc.numero, proc.cliente_id]);
      await auditar({ acao: 'vincular_origem_precatorio', entidade: 'precatorio', entidadeId: iguais[0].id, valorDepois: { numero_origem: proc.numero, motivo: 'mesmo credor, juiz assinou o ofício' }, ip }, tx);
      feito.origens_vinculadas += 1;
      continue;
    }
    }
    const etapa = numeroTribunal ? 'autuado' : 'assinado';
    const nova = await tx.queryOne(
      `INSERT INTO precatorios (numero, credor_nome, devedor, cliente_id, processo_origem_id, numero_origem, etapa, observacao)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [numeroTribunal, curto(nomeCredor, 200) || 'A conferir', curto(proc.polo_passivo, 200) || 'A conferir',
        proc.cliente_id, proc.id, proc.numero, etapa, curto(`Ficha criada pela varredura do PJe: ${s.motivo}.`.replace(/\.\.$/, '.'), 400)]);
    await tx.execute(`INSERT INTO precatorio_eventos (precatorio_id, campo, de, para) VALUES ($1, 'etapa', NULL, $2)`, [nova.id, etapa]);
    await auditar({ acao: 'criar_ficha_precatorio_assinado', entidade: 'precatorio', entidadeId: nova.id,
      valorDepois: { numero_origem: proc.numero, numero: numeroTribunal, etapa }, ip }, tx);
    feito.fichas_criadas += 1;
  }
  return feito;
}

// GET /api/precatorios/formacao — as duas faixas, a partir da última varredura.
export function criarConsultaFormacao(conexao) {
  return async (req, res) => {
    try {
      const varredura = await conexao.queryOne(`SELECT id, executada_em FROM despachos_varreduras ORDER BY executada_em DESC, criado_em DESC LIMIT 1`);
      const itens = varredura ? await conexao.query(
        `SELECT p.id AS processo_id, p.numero, c.nome AS cliente_nome, d.folha, d.local, d.bloco, d.observacao, d.concluso, d.dias_parado,
                EXISTS (SELECT 1 FROM precatorios pr WHERE pr.processo_origem_id = p.id) AS tem_precatorio
           FROM despachos_itens d JOIN processos p ON p.id = d.processo_id LEFT JOIN clientes c ON c.id = p.cliente_id
          WHERE d.varredura_id = $1 AND d.bloco = ANY($2) ${filtroVisibilidade(req.user, 'p')}`, [varredura.id, BLOCOS_DAS_FAIXAS]) : [];
      // Assinados à espera do número do tribunal: fichas criadas pela varredura.
      const semNumero = await conexao.query(
        `SELECT pr.id AS precatorio_id, pr.numero_origem AS numero, pr.credor_nome AS cliente_nome, pr.processo_origem_id AS processo_id, pr.criado_em
           FROM precatorios pr LEFT JOIN processos p ON p.id = pr.processo_origem_id
          WHERE pr.numero IS NULL ${req.user?.pode_marcar_restrito ? '' : "AND (p.id IS NULL OR p.visibilidade = 'normal')"}
          ORDER BY pr.criado_em`);
      // Alvarás pagos nos últimos 30 dias (saíram da folha com o comprovante).
      const pagos = await conexao.queryOne(
        `SELECT COUNT(DISTINCT s->>'numero')::int AS total
           FROM despachos_varreduras v, jsonb_array_elements(v.saidas) s
          WHERE v.executada_em >= NOW() - INTERVAL '30 days' AND s->>'motivo' ILIKE 'alvará pago%'`);
      const precatorios = montarFaixa(PASSOS_PRECATORIO, itens);
      precatorios.push({ chave: 'aguardando_numero', nome: 'Assinado, sem número', quem: 'Tribunal', total: semNumero.length,
        itens: semNumero.map(f => ({ precatorio_id: f.precatorio_id, processo_id: f.processo_id, numero: f.numero, cliente_nome: f.cliente_nome, local: null, observacao: null, concluso: null, dias_parado: null })) });
      return res.json({ ok: true, lida_em: varredura?.executada_em || null, precatorios, rpv: montarFaixa(PASSOS_RPV, itensDeRpv(itens)), alvaras: montarFaixa(PASSOS_ALVARA, itens), alvaras_pagos_30d: pagos?.total || 0 });
    } catch (err) {
      console.error('[Precatórios] Falha ao montar as faixas:', err.message);
      return res.status(500).json({ ok: false, erro: 'Não foi possível carregar os precatórios em formação.' });
    }
  };
}

// Rotina: quais processos de origem têm ficha sem o número do tribunal (para procurar no ofício).
export function criarListaSemNumero(conexao) {
  return async (_req, res) => {
    const linhas = await conexao.query(`SELECT numero_origem FROM precatorios WHERE numero IS NULL AND numero_origem IS NOT NULL ORDER BY criado_em`);
    res.json({ ok: true, processos: linhas.map(l => l.numero_origem) });
  };
}

// Rotina: informa o número do tribunal achado no ofício. Corpo: { numeros: [{ numero_origem, numero }] }.
export function criarGravacaoNumeros(conexao, { auditar = registrarAuditoria } = {}) {
  return async (req, res) => {
    const lista = Array.isArray(req.body?.numeros) ? req.body.numeros.slice(0, 200) : null;
    if (!lista) return res.status(400).json({ ok: false, erro: 'numeros deve ser uma lista.' });
    for (const [i, n] of lista.entries()) {
      if (!NUMERO_CNJ.test(String(n?.numero_origem || '').trim())) return res.status(400).json({ ok: false, erro: `Item ${i + 1}: número de origem inválido.` });
      if (!numeroPrecatorioValido(n?.numero)) return res.status(400).json({ ok: false, erro: `Item ${i + 1}: número de precatório do TJPB inválido.` });
    }
    try {
      const feito = await conexao.transaction(tx => registrarAssinados(tx,
        lista.map(n => ({ numero: n.numero_origem.trim(), precatorio_numero: n.numero.trim(), motivo: 'ofício requisitório de precatório (número lido no ofício)' })),
        { auditar, ip: req._ip }));
      return res.json({ ok: true, ...feito });
    } catch (err) {
      console.error('[Precatórios] Falha ao gravar números:', err.message);
      return res.status(500).json({ ok: false, erro: 'Não foi possível gravar os números.' });
    }
  };
}
