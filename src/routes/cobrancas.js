// /api/cobrancas — despesa do processo que o CLIENTE paga a um terceiro depois de receber (hoje: o
// contador judicial, após a RPV/precatório). Master only. O envio da cobrança pelo WhatsApp NÃO é
// feito aqui: a tela chama /api/comunicacao/enviar e depois marca "cobrado" neste módulo.
import { Router } from 'express';
import { db } from '../db/index.js';
import { apenasMaster } from '../middleware/auth.js';
import { registrarAuditoria } from '../middleware/auditoria.js';
import { uuidValido } from '../utils/validacao.js';
import { usuarioVeVisibilidade } from '../utils/visibilidade.js';
import {
  TIPOS_COBRANCA, STATUS_COBRANCA, montarMensagemCobranca, prontaParaCobrar, valorCobrancaValido,
} from '../services/cobrancas/mensagem.js';

export const SQL_COBRANCAS = (extra = '') => `
  SELECT cb.id, cb.processo_id, cb.cliente_id, cb.tipo, cb.valor, cb.status, cb.observacao,
         cb.cobrado_em, cb.pago_em, cb.valor_pago, cb.criado_em,
         p.numero AS processo_numero, p.status_rpv, p.status_precatorio, p.visibilidade,
         c.nome AS cliente_nome, c.whatsapp IS NOT NULL AND c.whatsapp <> '' AS tem_whatsapp,
         c.digisac_contact_id IS NOT NULL AND c.digisac_contact_id <> '' AS tem_contato_digisac,
         b.id AS beneficiario_id, b.nome AS beneficiario_nome, b.chave_pix
    FROM cobrancas_cliente cb
    JOIN processos p ON p.id = cb.processo_id
    LEFT JOIN clientes c ON c.id = cb.cliente_id
    LEFT JOIN beneficiarios_cobranca b ON b.id = cb.beneficiario_id
   WHERE 1=1 ${extra}
   ORDER BY (cb.status = 'a_cobrar') DESC, cb.criado_em DESC
   LIMIT 500`;

export function criarCobrancasRouter({ banco = db, auditar = registrarAuditoria } = {}) {
  const router = Router();
  router.use(apenasMaster);

  const enriquecer = l => ({ ...l, pronta: prontaParaCobrar(l) });

  // ── Beneficiários (contador, perito...) ────────────────────────────────────
  router.get('/beneficiarios', async (_req, res) => {
    const itens = await banco.query(`SELECT id, nome, funcao, chave_pix, ativo FROM beneficiarios_cobranca ORDER BY ativo DESC, nome`);
    res.json({ ok: true, beneficiarios: itens });
  });

  router.post('/beneficiarios', async (req, res) => {
    const nome = String(req.body?.nome ?? '').trim().slice(0, 200);
    const funcao = TIPOS_COBRANCA.includes(req.body?.funcao) ? req.body.funcao : 'contador';
    const chavePix = String(req.body?.chave_pix ?? '').trim().slice(0, 200);
    if (!nome || !chavePix) return res.status(400).json({ ok: false, erro: 'Informe o nome e a chave Pix.' });
    const [novo] = await banco.query(
      `INSERT INTO beneficiarios_cobranca (nome, funcao, chave_pix, criado_por) VALUES ($1,$2,$3,$4)
       RETURNING id, nome, funcao, chave_pix, ativo`, [nome, funcao, chavePix, req.user.id]);
    await auditar({ usuarioId: req.user.id, acao: 'criar', entidade: 'beneficiario_cobranca', entidadeId: novo.id, valorDepois: { nome, funcao }, ip: req._ip });
    res.status(201).json({ ok: true, beneficiario: novo });
  });

  router.patch('/beneficiarios/:id', async (req, res) => {
    if (!uuidValido(req.params.id)) return res.status(400).json({ ok: false, erro: 'Id inválido.' });
    const antes = await banco.queryOne(`SELECT nome, funcao, chave_pix, ativo FROM beneficiarios_cobranca WHERE id = $1`, [req.params.id]);
    if (!antes) return res.status(404).json({ ok: false, erro: 'Favorecido não encontrado.' });
    const nome = req.body?.nome !== undefined ? String(req.body.nome).trim().slice(0, 200) : antes.nome;
    const chavePix = req.body?.chave_pix !== undefined ? String(req.body.chave_pix).trim().slice(0, 200) : antes.chave_pix;
    const ativo = req.body?.ativo !== undefined ? req.body.ativo === true : antes.ativo;
    if (!nome || !chavePix) return res.status(400).json({ ok: false, erro: 'Nome e chave Pix não podem ficar vazios.' });
    await banco.execute(`UPDATE beneficiarios_cobranca SET nome = $1, chave_pix = $2, ativo = $3 WHERE id = $4`, [nome, chavePix, ativo, req.params.id]);
    await auditar({ usuarioId: req.user.id, acao: 'editar', entidade: 'beneficiario_cobranca', entidadeId: req.params.id,
      valorAntes: { nome: antes.nome, chave_pix: '***', ativo: antes.ativo }, valorDepois: { nome, chave_pix: '***', ativo }, ip: req._ip });
    res.json({ ok: true });
  });

  // ── Cobranças ──────────────────────────────────────────────────────────────
  // ?status=a_cobrar|cobrado|pago|cancelado  ?processo_id=…  ?prontas=1 (só as que já podem ser cobradas)
  router.get('/', async (req, res) => {
    const params = [];
    let extra = '';
    if (STATUS_COBRANCA.includes(req.query.status)) { params.push(req.query.status); extra += ` AND cb.status = $${params.length}`; }
    if (req.query.processo_id) {
      if (!uuidValido(req.query.processo_id)) return res.status(400).json({ ok: false, erro: 'processo_id inválido.' });
      params.push(req.query.processo_id); extra += ` AND cb.processo_id = $${params.length}`;
    }
    let linhas = (await banco.query(SQL_COBRANCAS(extra), params)).map(enriquecer);
    // Processo restrito só aparece para quem pode vê-lo (S-21).
    linhas = linhas.filter(l => usuarioVeVisibilidade(req.user, l.visibilidade));
    if (req.query.prontas === '1') linhas = linhas.filter(l => l.status === 'a_cobrar' && l.pronta);
    res.json({ ok: true, cobrancas: linhas.map(({ visibilidade, ...resto }) => resto) });
  });

  router.post('/', async (req, res) => {
    const { processo_id: processoId, beneficiario_id: beneficiarioId } = req.body ?? {};
    const tipo = TIPOS_COBRANCA.includes(req.body?.tipo) ? req.body.tipo : 'contador';
    const valor = valorCobrancaValido(req.body?.valor);
    if (!uuidValido(processoId)) return res.status(400).json({ ok: false, erro: 'Informe o processo.' });
    if (valor === null) return res.status(400).json({ ok: false, erro: 'Informe um valor válido (maior que zero).' });
    if (beneficiarioId && !uuidValido(beneficiarioId)) return res.status(400).json({ ok: false, erro: 'Favorecido inválido.' });
    const proc = await banco.queryOne(`SELECT id, cliente_id, visibilidade FROM processos WHERE id = $1`, [processoId]);
    if (!proc || !usuarioVeVisibilidade(req.user, proc.visibilidade)) return res.status(404).json({ ok: false, erro: 'Processo não encontrado.' });
    if (beneficiarioId && !(await banco.queryOne(`SELECT id FROM beneficiarios_cobranca WHERE id = $1 AND ativo = true`, [beneficiarioId]))) {
      return res.status(422).json({ ok: false, erro: 'Favorecido não encontrado ou inativo.' });
    }
    const jaTem = await banco.queryOne(
      `SELECT id FROM cobrancas_cliente WHERE processo_id = $1 AND tipo = $2 AND status IN ('a_cobrar','cobrado') LIMIT 1`, [processoId, tipo]);
    if (jaTem) return res.status(409).json({ ok: false, erro: 'Este processo já tem uma cobrança em aberto desse tipo. Edite a existente.' });
    const observacao = String(req.body?.observacao ?? '').trim().slice(0, 500) || null;
    const [nova] = await banco.query(
      `INSERT INTO cobrancas_cliente (processo_id, cliente_id, tipo, valor, beneficiario_id, observacao, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [processoId, proc.cliente_id, tipo, valor, beneficiarioId || null, observacao, req.user.id]);
    await auditar({ usuarioId: req.user.id, acao: 'criar', entidade: 'cobranca_cliente', entidadeId: nova.id,
      valorDepois: { processo_id: processoId, tipo, valor }, ip: req._ip });
    res.status(201).json({ ok: true, id: nova.id });
  });

  router.patch('/:id', async (req, res) => {
    if (!uuidValido(req.params.id)) return res.status(400).json({ ok: false, erro: 'Id inválido.' });
    const antes = await banco.queryOne(`SELECT tipo, valor, beneficiario_id, observacao, status FROM cobrancas_cliente WHERE id = $1`, [req.params.id]);
    if (!antes) return res.status(404).json({ ok: false, erro: 'Cobrança não encontrada.' });
    if (!['a_cobrar', 'cobrado'].includes(antes.status)) return res.status(409).json({ ok: false, erro: 'Cobrança já encerrada.' });
    const valor = req.body?.valor !== undefined ? valorCobrancaValido(req.body.valor) : Number(antes.valor);
    if (valor === null) return res.status(400).json({ ok: false, erro: 'Informe um valor válido (maior que zero).' });
    const benef = req.body?.beneficiario_id !== undefined ? (req.body.beneficiario_id || null) : antes.beneficiario_id;
    if (benef && !uuidValido(benef)) return res.status(400).json({ ok: false, erro: 'Favorecido inválido.' });
    const obs = req.body?.observacao !== undefined ? (String(req.body.observacao).trim().slice(0, 500) || null) : antes.observacao;
    await banco.execute(`UPDATE cobrancas_cliente SET valor = $1, beneficiario_id = $2, observacao = $3, atualizado_em = NOW() WHERE id = $4`,
      [valor, benef, obs, req.params.id]);
    await auditar({ usuarioId: req.user.id, acao: 'editar', entidade: 'cobranca_cliente', entidadeId: req.params.id,
      valorAntes: { valor: Number(antes.valor), beneficiario_id: antes.beneficiario_id }, valorDepois: { valor, beneficiario_id: benef }, ip: req._ip });
    res.json({ ok: true });
  });

  // Transições: a_cobrar → cobrado → pago; cancelar de qualquer aberta. Cada uma só a partir do estado certo.
  const TRANSICOES = {
    cobrado:   { de: ['a_cobrar', 'cobrado'], sql: `status = 'cobrado', cobrado_em = NOW()` },
    pago:      { de: ['a_cobrar', 'cobrado'], sql: `status = 'pago', pago_em = NOW(), valor_pago = COALESCE($2::numeric, valor)` },
    cancelado: { de: ['a_cobrar', 'cobrado'], sql: `status = 'cancelado'` },
  };
  for (const [destino, cfg] of Object.entries(TRANSICOES)) {
    const rota = destino === 'cancelado' ? 'cancelar' : destino;
    router.post(`/:id/${rota}`, async (req, res) => {
      if (!uuidValido(req.params.id)) return res.status(400).json({ ok: false, erro: 'Id inválido.' });
      const antes = await banco.queryOne(`SELECT status, valor FROM cobrancas_cliente WHERE id = $1`, [req.params.id]);
      if (!antes) return res.status(404).json({ ok: false, erro: 'Cobrança não encontrada.' });
      if (!cfg.de.includes(antes.status)) return res.status(409).json({ ok: false, erro: `Não dá para passar de “${antes.status}” para “${destino}”.` });
      let valorPago = null;
      if (destino === 'pago' && req.body?.valor_pago !== undefined) {
        valorPago = valorCobrancaValido(req.body.valor_pago);
        if (valorPago === null) return res.status(400).json({ ok: false, erro: 'Valor pago inválido.' });
      }
      await banco.execute(`UPDATE cobrancas_cliente SET ${cfg.sql}, atualizado_em = NOW() WHERE id = $1`, destino === 'pago' ? [req.params.id, valorPago] : [req.params.id]);
      await auditar({ usuarioId: req.user.id, acao: `cobranca_${destino}`, entidade: 'cobranca_cliente', entidadeId: req.params.id,
        valorAntes: { status: antes.status }, valorDepois: { status: destino, ...(valorPago ? { valor_pago: valorPago } : {}) }, ip: req._ip });
      res.json({ ok: true });
    });
  }

  // Texto pronto (editável na tela) + dados para enviar pelo /api/comunicacao/enviar.
  router.get('/:id/mensagem', async (req, res) => {
    if (!uuidValido(req.params.id)) return res.status(400).json({ ok: false, erro: 'Id inválido.' });
    const l = (await banco.query(SQL_COBRANCAS(' AND cb.id = $1'), [req.params.id]))[0];
    if (!l || !usuarioVeVisibilidade(req.user, l.visibilidade)) return res.status(404).json({ ok: false, erro: 'Cobrança não encontrada.' });
    res.json({
      ok: true,
      cliente_id: l.cliente_id, processo_id: l.processo_id,
      tem_whatsapp: l.tem_whatsapp, tem_contato_digisac: l.tem_contato_digisac,
      texto: montarMensagemCobranca({
        clienteNome: l.cliente_nome, tipo: l.tipo, valor: l.valor,
        beneficiarioNome: l.beneficiario_nome, chavePix: l.chave_pix, numeroProcesso: l.processo_numero,
      }),
    });
  });

  return router;
}

export const cobrancasRouter = criarCobrancasRouter();
