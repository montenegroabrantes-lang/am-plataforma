import { Router }   from 'express';
import multer        from 'multer';
import { Readable }  from 'stream';
import { db }        from '../db/index.js';
import { apenasMaster } from '../middleware/auth.js';
import { registrarAuditoria } from '../middleware/auditoria.js';
import { criarPastaCliente, criarSubpasta, uploadPdf } from '../services/drive/index.js';
import { verificarElegibilidadeCliente } from '../services/elegibilidade.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

export const clientesRouter = Router();

// GET /api/clientes
clientesRouter.get('/', async (req, res) => {
  const { busca, page = 1, limite = 30 } = req.query;
  const offset = (Number(page) - 1) * Number(limite);
  const params = [];
  const condicoes = ['c.ativo = true'];

  if (busca) {
    params.push(`%${busca}%`);
    condicoes.push(`(c.nome ILIKE $${params.length} OR c.cpf ILIKE $${params.length})`);
  }

  params.push(Number(limite), offset);

  const rows = await db.query(
    `SELECT c.id, c.nome, c.cpf, c.whatsapp, c.email, c.cargo, c.orgao,
            c.drive_pasta_url, c.master_responsavel_id, c.criado_em,
            u.nome AS master_nome,
            COUNT(p.id) AS total_processos
     FROM clientes c
     LEFT JOIN usuarios u ON u.id = c.master_responsavel_id
     LEFT JOIN processos p ON p.cliente_id = c.id
     WHERE ${condicoes.join(' AND ')}
     GROUP BY c.id, u.nome
     ORDER BY c.nome
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({ ok: true, clientes: rows });
});

// GET /api/clientes/:id
clientesRouter.get('/:id', async (req, res) => {
  const cliente = await db.queryOne(
    `SELECT c.*, u.nome AS master_nome
     FROM clientes c
     LEFT JOIN usuarios u ON u.id = c.master_responsavel_id
     WHERE c.id = $1`,
    [req.params.id]
  );
  if (!cliente) return res.status(404).json({ ok: false, erro: 'Cliente não encontrado.' });

  const [processos, documentos, teses, vinculos] = await Promise.all([
    db.query(
      `SELECT id, numero, tribunal, status, produto_id FROM processos WHERE cliente_id = $1`,
      [req.params.id]
    ),
    db.query(
      `SELECT id, categoria, nome, drive_url, criado_em FROM documentos WHERE cliente_id = $1 AND deletado = false`,
      [req.params.id]
    ),
    db.query(
      `SELECT cp.id, cp.honorarios_pct, cp.criado_em,
              pr.id AS produto_id, pr.nome AS produto_nome, pr.polo_passivo_padrao
       FROM cliente_produtos cp
       JOIN produtos pr ON pr.id = cp.produto_id
       WHERE cp.cliente_id = $1
       ORDER BY pr.nome`,
      [req.params.id]
    ),
    db.query(
      `SELECT * FROM cliente_vinculos WHERE cliente_id = $1 ORDER BY ordem`,
      [req.params.id]
    ),
  ]);

  res.json({ ok: true, cliente, processos, documentos, teses, vinculos });
});

// POST /api/clientes/:id/criar-tarefas-protocolo
clientesRouter.post('/:id/criar-tarefas-protocolo', apenasMaster, async (req, res) => {
  const clienteId = req.params.id;

  const cliente = await db.queryOne('SELECT id, nome FROM clientes WHERE id = $1', [clienteId]);
  if (!cliente) return res.status(404).json({ ok: false, erro: 'Cliente não encontrado.' });

  const teses = await db.query(
    `SELECT cp.id AS cliente_produto_id, pr.nome AS produto_nome
     FROM cliente_produtos cp
     JOIN produtos pr ON pr.id = cp.produto_id
     WHERE cp.cliente_id = $1`,
    [clienteId]
  );

  if (teses.length === 0) {
    return res.status(400).json({ ok: false, erro: 'Cliente não possui teses jurídicas vinculadas.' });
  }

  const criadas = [];
  const existentes = [];

  // Busca todas as tarefas ativas de uma vez (evita N+1)
  const cpIds = teses.map(t => t.cliente_produto_id);
  const tarefasAtivas = await db.query(
    `SELECT cliente_produto_id FROM tarefas
     WHERE cliente_produto_id = ANY($1) AND tipo = 'protocolar'
     AND status NOT IN ('concluida', 'cancelada')`,
    [cpIds]
  );
  const cpComTarefa = new Set(tarefasAtivas.map(t => t.cliente_produto_id));

  for (const tese of teses) {
    if (cpComTarefa.has(tese.cliente_produto_id)) {
      existentes.push(tese.produto_nome);
      continue;
    }
    const [nova] = await db.query(
      `INSERT INTO tarefas (cliente_produto_id, tipo, descricao, urgencia, validado_por, status)
       VALUES ($1, 'protocolar', $2, 'MEDIO', $3, 'pendente')
       RETURNING id`,
      [
        tese.cliente_produto_id,
        `Protocolar processo — ${tese.produto_nome} — ${cliente.nome}`,
        req.user.id,
      ]
    );
    criadas.push({ id: nova.id, produto: tese.produto_nome });
  }

  res.json({ ok: true, criadas: criadas.length, existentes: existentes.length, tarefas: criadas });
});

// GET /api/clientes/:id/vinculos — lista vínculos funcionais
clientesRouter.get('/:id/vinculos', async (req, res) => {
  const vinculos = await db.query(
    `SELECT * FROM cliente_vinculos WHERE cliente_id = $1 ORDER BY ordem`,
    [req.params.id]
  );
  res.json({ ok: true, vinculos });
});

// POST /api/clientes/:id/vinculos — adiciona vínculo funcional
clientesRouter.post('/:id/vinculos', async (req, res) => {
  const { cargo, orgao, vinculo_inicio, vinculo_fim, polo_passivo, vinculo_ativo } = req.body;
  const count = await db.queryOne(`SELECT COUNT(*) FROM cliente_vinculos WHERE cliente_id = $1`, [req.params.id]);
  if (Number(count.count) >= 2) return res.status(400).json({ ok: false, erro: 'Máximo de 2 vínculos por cliente.' });
  const ordem = Number(count.count) + 1;
  const [novo] = await db.query(
    `INSERT INTO cliente_vinculos (cliente_id, ordem, cargo, orgao, vinculo_inicio, vinculo_fim, polo_passivo, vinculo_ativo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.params.id, ordem, cargo||null, orgao||null, vinculo_inicio||null, vinculo_fim||null, polo_passivo||null, vinculo_ativo !== false]
  );
  res.status(201).json({ ok: true, vinculo: novo });
});

// PATCH /api/clientes/:id/vinculos/:vid — edita vínculo funcional
clientesRouter.patch('/:id/vinculos/:vid', async (req, res) => {
  const { cargo, orgao, vinculo_inicio, vinculo_fim, polo_passivo, vinculo_ativo } = req.body;
  await db.execute(
    `UPDATE cliente_vinculos SET cargo=$1, orgao=$2, vinculo_inicio=$3, vinculo_fim=$4,
     polo_passivo=$5, vinculo_ativo=$6 WHERE id=$7 AND cliente_id=$8`,
    [cargo||null, orgao||null, vinculo_inicio||null, vinculo_fim||null, polo_passivo||null, vinculo_ativo !== false, req.params.vid, req.params.id]
  );
  res.json({ ok: true });
});

// DELETE /api/clientes/:id/vinculos/:vid — remove vínculo funcional
clientesRouter.delete('/:id/vinculos/:vid', async (req, res) => {
  await db.execute(`DELETE FROM cliente_vinculos WHERE id=$1 AND cliente_id=$2`, [req.params.vid, req.params.id]);
  res.json({ ok: true });
});

// POST /api/clientes
clientesRouter.post('/', async (req, res) => {
  const { nome, cpf, whatsapp, email, lgpd_consentimento, vinculos } = req.body;

  if (!nome || !cpf) return res.status(400).json({ ok: false, erro: 'nome e cpf são obrigatórios.' });

  const masterId = req.user.perfil === 'master' ? req.user.id : req.user.master_id;
  const v1 = vinculos?.[0] || {};

  try {
    const [novo] = await db.query(
      `INSERT INTO clientes (nome, cpf, whatsapp, email, cargo, orgao,
              vinculo_inicio, vinculo_fim, polo_passivo, lgpd_consentimento, lgpd_data, vinculo_ativo,
              master_responsavel_id, cadastrado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id, nome, cpf`,
      [
        nome.trim(), cpf.replace(/\D/g, ''), whatsapp || null, email || null,
        v1.cargo || null, v1.orgao || null,
        v1.vinculo_inicio || null, v1.vinculo_fim || null,
        v1.polo_passivo || null,
        lgpd_consentimento ?? false,
        lgpd_consentimento ? new Date() : null,
        v1.vinculo_ativo !== false,
        masterId, req.user.id,
      ]
    );

    // Insere vínculos na nova tabela
    if (vinculos?.length) {
      for (let i = 0; i < Math.min(vinculos.length, 2); i++) {
        const v = vinculos[i];
        if (!v.cargo && !v.orgao && !v.polo_passivo) continue;
        await db.query(
          `INSERT INTO cliente_vinculos (cliente_id, ordem, cargo, orgao, vinculo_inicio, vinculo_fim, polo_passivo, vinculo_ativo)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [novo.id, i+1, v.cargo||null, v.orgao||null, v.vinculo_inicio||null, v.vinculo_fim||null, v.polo_passivo||null, v.vinculo_ativo !== false]
        );
      }
    }

    // Cria pasta no Google Drive em background (não bloqueia o retorno)
    criarPastaCliente(novo.cpf, novo.nome)
      .then(async ({ id: pastaId, url }) => {
        await db.execute(
          'UPDATE clientes SET drive_pasta_id = $1, drive_pasta_url = $2 WHERE id = $3',
          [pastaId, url, novo.id]
        );
        // Subpastas padrão
        await Promise.all([
          criarSubpasta(pastaId, 'Documentos Pessoais'),
          criarSubpasta(pastaId, 'Vínculo Funcional'),
          criarSubpasta(pastaId, 'Procurações'),
          criarSubpasta(pastaId, 'Petições'),
        ]);
      })
      .catch(err => console.error('[Drive] Falha ao criar pasta:', err.message));

    await registrarAuditoria({
      usuarioId: req.user.id, acao: 'criar', entidade: 'cliente',
      entidadeId: novo.id, valorDepois: novo, ip: req._ip,
    });

    // Verificar elegibilidade e criar tarefas automaticamente em background
    verificarElegibilidadeCliente(novo.id, req.user.id)
      .then(({ vinculados, tarefas }) => {
        if (tarefas > 0) console.log(`[Elegibilidade] ${novo.nome}: ${vinculados} teses vinculadas, ${tarefas} tarefas criadas.`);
      })
      .catch(err => console.warn('[Elegibilidade] Erro:', err.message));

    res.status(201).json({ ok: true, cliente: novo });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ ok: false, erro: 'CPF já cadastrado.' });
    throw e;
  }
});

// PATCH /api/clientes/:id
clientesRouter.patch('/:id', async (req, res) => {
  const campos      = ['nome','whatsapp','email','cargo','orgao','periodo_vinculo','vinculo_inicio','vinculo_fim','polo_passivo','ativo','vinculo_ativo'];
  const camposData  = new Set(['vinculo_inicio','vinculo_fim']);
  const updates = [];
  const params  = [];

  for (const campo of campos) {
    if (req.body[campo] !== undefined) {
      const valor = camposData.has(campo) ? (req.body[campo] || null) : req.body[campo];
      params.push(valor);
      updates.push(`${campo} = $${params.length}`);
    }
  }

  if (!updates.length) return res.status(400).json({ ok: false, erro: 'Nenhum campo para atualizar.' });

  params.push(req.params.id);
  updates.push('atualizado_em = NOW()');

  await db.execute(`UPDATE clientes SET ${updates.join(', ')} WHERE id = $${params.length}`, params);

  // Se atualizou cargo ou órgão, re-verificar elegibilidade
  if (req.body.cargo !== undefined || req.body.orgao !== undefined) {
    verificarElegibilidadeCliente(req.params.id, req.user.id)
      .catch(err => console.warn('[Elegibilidade] Erro no PATCH:', err.message));
  }

  res.json({ ok: true });
});

// ─── DOCUMENTOS ───────────────────────────────────────────────────────────────

const CATS_VALIDAS = ['pessoais', 'vinculo', 'procuracao', 'outro'];

// GET /api/clientes/:id/documentos
clientesRouter.get('/:id/documentos', async (req, res) => {
  const rows = await db.query(
    `SELECT id, nome, categoria, drive_url, criado_em
     FROM documentos WHERE cliente_id = $1 AND deletado = false
     ORDER BY categoria, criado_em DESC`,
    [req.params.id]
  );
  res.json({ ok: true, documentos: rows });
});

// POST /api/clientes/:id/documentos — upload PDF para o Drive
clientesRouter.post('/:id/documentos', upload.single('arquivo'), async (req, res) => {
  const clienteId = req.params.id;
  const { categoria = 'outro', nome } = req.body;

  if (!CATS_VALIDAS.includes(categoria)) {
    return res.status(400).json({ ok: false, erro: 'Categoria inválida.' });
  }
  if (!req.file) {
    return res.status(400).json({ ok: false, erro: 'Nenhum arquivo enviado.' });
  }

  const cliente = await db.queryOne(
    `SELECT id, nome, cpf, drive_pasta_id FROM clientes WHERE id = $1`, [clienteId]
  );
  if (!cliente) return res.status(404).json({ ok: false, erro: 'Cliente não encontrado.' });

  let pastaId = cliente.drive_pasta_id;
  if (!pastaId) {
    try {
      const { id, url } = await criarPastaCliente(cliente.cpf || clienteId, cliente.nome);
      pastaId = id;
      await db.execute(`UPDATE clientes SET drive_pasta_id=$1, drive_pasta_url=$2 WHERE id=$3`, [id, url, clienteId]);
    } catch (err) {
      return res.status(500).json({ ok: false, erro: 'Criação de pasta falhou: ' + err.message });
    }
  }

  const nomeArquivo = (nome || `${categoria}_${Date.now()}`).replace(/[^\w\-. ]/g, '_') + '.pdf';
  let driveUrl = null, driveFileId = null;
  try {
    const stream    = Readable.from(req.file.buffer);
    const uploaded  = await uploadPdf(pastaId, nomeArquivo, stream);
    driveUrl        = uploaded.url;
    driveFileId     = uploaded.id;
  } catch (err) {
    return res.status(500).json({ ok: false, erro: 'Upload falhou: ' + err.message });
  }

  const [doc] = await db.query(
    `INSERT INTO documentos (cliente_id, nome, categoria, drive_file_id, drive_url)
     VALUES ($1,$2,$3,$4,$5) RETURNING id, nome, categoria, drive_url, criado_em`,
    [clienteId, nome || nomeArquivo, categoria, driveFileId, driveUrl]
  );

  res.status(201).json({ ok: true, documento: doc });
});

// DELETE /api/clientes/:id/documentos/:docId
clientesRouter.delete('/:id/documentos/:docId', async (req, res) => {
  await db.execute(
    `UPDATE documentos SET deletado = true WHERE id = $1 AND cliente_id = $2`,
    [req.params.docId, req.params.id]
  );
  res.json({ ok: true });
});
