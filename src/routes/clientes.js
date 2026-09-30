import { Router }   from 'express';
import { db }        from '../db/index.js';
import { apenasMaster } from '../middleware/auth.js';
import { registrarAuditoria } from '../middleware/auditoria.js';
import { ehMaster, protegerDadosDoJunior, condicaoBuscaCpf, MSG_CAMPOS_DO_CLIENTE } from '../middleware/perfilJunior.js';
import { criarPastaCliente, criarSubpasta } from '../services/drive/index.js';
import { documentosRouter } from './clientes.documentos.js';
import { criarOuBuscarContato } from '../services/digisac/index.js';
import { verificarElegibilidadeCliente } from '../services/elegibilidade.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import { cpfValido } from '../utils/cpf.js';
import { uuidValido, paginacaoSegura } from '../utils/validacao.js';
import { diferenca, resumirTelefone, resumirEmail } from '../utils/auditoriaCampos.js';
import { somarDiasUteis } from '../utils/diasUteis.js';
import { filtroVisibilidade } from '../utils/visibilidade.js';

export const clientesRouter = Router();

// S-27: júnior recebe o CPF mascarado em qualquer resposta deste router.
clientesRouter.use(protegerDadosDoJunior);

// Rejeita :id malformado antes de bater no banco (evita 500 cru do Postgres)
clientesRouter.param('id', (req, res, next, id) => {
  if (!uuidValido(id)) return res.status(400).json({ ok: false, erro: 'ID inválido.' });
  next();
});

// GET /api/clientes
clientesRouter.get('/', async (req, res) => {
  const { busca, page, limite } = req.query;
  const { limite: limiteSeguro, offset } = paginacaoSegura(page, limite);
  const params = [];
  const condicoes = ['c.ativo = true'];

  if (busca) {
    params.push(`%${busca}%`);
    const iNome = params.length;
    // CPF é salvo só com dígitos — normaliza a busca (REGEXP_REPLACE no lado da coluna
    // também, por segurança) para casar mesmo digitando com pontos/traço. Segue o mesmo
    // padrão já usado em processos.js.
    // S-27: o júnior só busca por CPF inteiro (senão a busca parcial desmascara o CPF).
    const cpfCond = condicaoBuscaCpf(req, busca.replace(/\D/g, ''), params);
    condicoes.push(`(c.nome ILIKE $${iNome}${cpfCond})`);
  }

  // COUNT antes do LIMIT/OFFSET — sem isso a tela exibia o tamanho da página
  // como se fosse o total e o contador travava em 30 por mais que se cadastrasse.
  const [{ total }] = await db.query(
    `SELECT COUNT(*) AS total FROM clientes c WHERE ${condicoes.join(' AND ')}`,
    params
  );

  params.push(limiteSeguro, offset);

  const rows = await db.query(
    `SELECT c.id, c.nome, c.cpf, c.whatsapp, c.email, c.cargo, c.orgao,
            c.drive_pasta_url, c.master_responsavel_id, c.criado_em,
            u.nome AS master_nome,
            COUNT(p.id) AS total_processos
     FROM clientes c
     LEFT JOIN usuarios u ON u.id = c.master_responsavel_id
     LEFT JOIN processos p ON p.cliente_id = c.id ${filtroVisibilidade(req.user)}
     WHERE ${condicoes.join(' AND ')}
     GROUP BY c.id, u.id, u.nome
     ORDER BY c.nome
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({ ok: true, clientes: rows, total: Number(total), pagina: Number(page) || 1, limite: limiteSeguro });
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

  // Anotações ficam cifradas em repouso (podem conter credenciais de portais do servidor) —
  // decifra para exibir e nunca devolve o blob cifrado ao cliente.
  const anotacoesEnc = cliente.anotacoes_enc;
  delete cliente.anotacoes_enc;
  cliente.anotacoes = null;
  // S-27: o júnior não lê as anotações (podem guardar senhas de portais) — nem chega a decifrar.
  if (anotacoesEnc && ehMaster(req)) {
    try { cliente.anotacoes = decrypt(anotacoesEnc); }
    catch (e) { console.warn(`[Clientes] Falha ao decifrar anotações ${req.params.id}:`, e.message); }
  }

  const [processos, documentos, teses, vinculos, demandas] = await Promise.all([
    db.query(
      `SELECT id, numero, tribunal, status, produto_id FROM processos WHERE cliente_id = $1 ${filtroVisibilidade(req.user, 'processos')}`,
      [req.params.id]
    ),
    db.query(
      `SELECT id, categoria, nome, drive_url, criado_em FROM documentos WHERE cliente_id = $1 AND deletado = false`,
      [req.params.id]
    ),
    db.query(
      `SELECT cp.id, cp.honorarios_pct, cp.criado_em,
              pr.id AS produto_id, pr.nome AS produto_nome, pr.polo_passivo_padrao, pr.documentos_exigidos
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
    // Fase 5 (ficha única) — 1 linha por demanda (cliente+produto+vínculo+período, Fase 4),
    // com a tarefa mais recente ligada a ela. LATERAL porque uma demanda pode, em tese, ter
    // mais de uma tarefa ao longo do tempo (histórico); só a mais recente importa pra ficha.
    db.query(
      `SELECT d.id, d.produto_id, d.cliente_vinculo_id, d.periodo_inicio, d.periodo_fim, d.status,
              cv.cargo AS vinculo_cargo, cv.orgao AS vinculo_orgao, cv.polo_passivo AS vinculo_polo_passivo,
              t.id AS tarefa_id, t.status AS tarefa_status, t.urgencia AS tarefa_urgencia,
              t.descricao AS tarefa_descricao, t.prazo_data AS tarefa_prazo_data
         FROM demandas d
         LEFT JOIN cliente_vinculos cv ON cv.id = d.cliente_vinculo_id
         LEFT JOIN LATERAL (
           SELECT id, status, urgencia, descricao, prazo_data FROM tarefas
            WHERE demanda_id = d.id ORDER BY criado_em DESC LIMIT 1
         ) t ON true
        WHERE d.cliente_id = $1
        ORDER BY d.criado_em DESC`,
      [req.params.id]
    ),
  ]);

  res.json({ ok: true, cliente, processos, documentos, teses, vinculos, demandas });
});

// POST /api/clientes/:id/criar-tarefas-protocolo
clientesRouter.post('/:id/criar-tarefas-protocolo', apenasMaster, async (req, res) => {
  const clienteId = req.params.id;
  const { atribuido_a, prazo_data } = req.body || {};
  const responsavel = atribuido_a || req.user.id;
  const prazo = prazo_data || somarDiasUteis(new Date(), 3);

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
      `INSERT INTO tarefas (cliente_id, cliente_produto_id, tipo, descricao, urgencia, validado_por, atribuido_a, prazo_data, status, precisa_triagem)
       VALUES ($1, $2, 'protocolar', $3, 'ALTO', $4, $5, $6, 'pendente', false)
       RETURNING id`,
      [
        clienteId,
        tese.cliente_produto_id,
        `Protocolar processo — ${tese.produto_nome} — ${cliente.nome}`,
        req.user.id,
        responsavel,
        prazo,
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
  await registrarAuditoria({
    usuarioId: req.user.id, acao: 'criar_vinculo', entidade: 'cliente', entidadeId: req.params.id,
    valorDepois: { vinculo_id: novo.id, ordem, cargo: cargo||null, orgao: orgao||null, vinculo_inicio: vinculo_inicio||null, vinculo_fim: vinculo_fim||null, polo_passivo: polo_passivo||null, vinculo_ativo: vinculo_ativo !== false },
    ip: req._ip,
  });
  res.status(201).json({ ok: true, vinculo: novo });
});

// PATCH /api/clientes/:id/vinculos/:vid — edita vínculo funcional
clientesRouter.patch('/:id/vinculos/:vid', async (req, res) => {
  const { cargo, orgao, vinculo_inicio, vinculo_fim, polo_passivo, vinculo_ativo } = req.body;
  const antesVinculo = await db.queryOne(
    `SELECT cargo, orgao, vinculo_inicio, vinculo_fim, polo_passivo, vinculo_ativo FROM cliente_vinculos WHERE id=$1 AND cliente_id=$2`,
    [req.params.vid, req.params.id]
  );
  await db.execute(
    `UPDATE cliente_vinculos SET cargo=$1, orgao=$2, vinculo_inicio=$3, vinculo_fim=$4,
     polo_passivo=$5, vinculo_ativo=$6 WHERE id=$7 AND cliente_id=$8`,
    [cargo||null, orgao||null, vinculo_inicio||null, vinculo_fim||null, polo_passivo||null, vinculo_ativo !== false, req.params.vid, req.params.id]
  );
  if (antesVinculo) {
    // Esta rota grava os 6 campos de uma vez (ausente = vazio): o log traz só o que de fato mudou.
    const mudancas = diferenca(antesVinculo,
      { cargo: cargo||null, orgao: orgao||null, vinculo_inicio: vinculo_inicio||null, vinculo_fim: vinculo_fim||null, polo_passivo: polo_passivo||null, vinculo_ativo: vinculo_ativo !== false },
      ['cargo', 'orgao', 'vinculo_inicio', 'vinculo_fim', 'polo_passivo', 'vinculo_ativo']);
    if (mudancas.mudou) {
      await registrarAuditoria({
        usuarioId: req.user.id, acao: 'editar_vinculo', entidade: 'cliente', entidadeId: req.params.id,
        valorAntes: { vinculo_id: req.params.vid, ...mudancas.antes }, valorDepois: { vinculo_id: req.params.vid, ...mudancas.depois }, ip: req._ip,
      });
    }
  }
  res.json({ ok: true });
});

// DELETE /api/clientes/:id/vinculos/:vid — remove vínculo funcional
clientesRouter.delete('/:id/vinculos/:vid', async (req, res) => {
  const r = await db.execute(`DELETE FROM cliente_vinculos WHERE id=$1 AND cliente_id=$2 RETURNING cargo, orgao, vinculo_inicio, vinculo_fim, polo_passivo, vinculo_ativo`, [req.params.vid, req.params.id]);
  if (r.rowCount === 0) return res.status(404).json({ ok: false, erro: 'Vínculo não encontrado.' });
  await registrarAuditoria({
    usuarioId: req.user.id, acao: 'excluir_vinculo', entidade: 'cliente', entidadeId: req.params.id,
    valorAntes: { vinculo_id: req.params.vid, ...(r.rows?.[0] || {}) }, ip: req._ip,
  });
  res.json({ ok: true });
});

// POST /api/clientes
clientesRouter.post('/', async (req, res) => {
  const { nome, cpf, whatsapp, email, lgpd_consentimento, vinculos } = req.body;

  if (!nome || !cpf) return res.status(400).json({ ok: false, erro: 'nome e cpf são obrigatórios.' });
  if (!cpfValido(cpf)) return res.status(400).json({ ok: false, erro: 'CPF inválido.' });
  if (!lgpd_consentimento) return res.status(400).json({ ok: false, erro: 'É necessário registrar o consentimento LGPD do titular para cadastrar o cliente.' });

  const masterId = req.user.perfil === 'master' ? req.user.id : req.user.master_id;
  const v1 = vinculos?.[0] || {};

  try {
    const [novo] = await db.query(
      `INSERT INTO clientes (nome, cpf, whatsapp, email, cargo, orgao,
              vinculo_inicio, vinculo_fim, polo_passivo, lgpd_consentimento, lgpd_data, vinculo_ativo,
              master_responsavel_id, cadastrado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id, nome, cpf, whatsapp`,
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
        // Subpastas padrão — mesmo conjunto de 5 usado no fluxo de onboarding
        // (src/services/onboarding.js); faltava "Contratos" aqui.
        await Promise.all([
          criarSubpasta(pastaId, 'Documentos Pessoais'),
          criarSubpasta(pastaId, 'Vínculo Funcional'),
          criarSubpasta(pastaId, 'Procurações'),
          criarSubpasta(pastaId, 'Contratos'),
          criarSubpasta(pastaId, 'Petições'),
        ]);
      })
      .catch(err => console.error('[Drive] Falha ao criar pasta:', err.message));

    // Cria (ou reaproveita) o contato correspondente no Digisac, em background — mesmo
    // padrão do Drive acima: nunca bloqueia nem falha o cadastro do cliente.
    if (novo.whatsapp) {
      criarOuBuscarContato(novo.whatsapp, novo.nome)
        .then(async contatoId => {
          if (contatoId) await db.execute('UPDATE clientes SET digisac_contact_id = $1 WHERE id = $2', [contatoId, novo.id]);
        })
        .catch(err => console.error('[Digisac] Falha ao criar/buscar contato:', err.message));
    }

    await registrarAuditoria({
      usuarioId: req.user.id, acao: 'criar', entidade: 'cliente',
      entidadeId: novo.id, valorDepois: novo, ip: req._ip,
    });

    // Compatibilidade é apresentada ao humano como sugestão; nunca vira contratação sozinha.
    const { sugestoes } = await verificarElegibilidadeCliente(novo.id)
      .catch(err => {
        console.warn('[Elegibilidade] Não foi possível gerar sugestões:', err.message);
        return { sugestoes: [] };
      });
    res.status(201).json({ ok: true, cliente: novo, sugestoes });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ ok: false, erro: 'CPF já cadastrado.' });
    throw e;
  }
});

// PATCH /api/clientes/:id
clientesRouter.patch('/:id', async (req, res) => {
  // S-27: anotações e `ativo` (desativar cliente) são do Master.
  if (!ehMaster(req) && (req.body?.anotacoes !== undefined || req.body?.ativo !== undefined)) {
    return res.status(403).json({ ok: false, erro: MSG_CAMPOS_DO_CLIENTE });
  }
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

  // Anotações são cifradas antes de gravar — nunca ficam em texto puro no banco
  if (req.body.anotacoes !== undefined) {
    params.push(req.body.anotacoes ? encrypt(req.body.anotacoes) : null);
    updates.push(`anotacoes_enc = $${params.length}`);
  }

  if (!updates.length) return res.status(400).json({ ok: false, erro: 'Nenhum campo para atualizar.' });

  // S-13: retrato dos campos enviados antes de gravar, para o log trazer só o antes e o depois deles.
  // (`camposEnviados` sai da lista fixa `campos`: nada vindo do cliente entra no SQL.)
  const camposEnviados = campos.filter(c => req.body[c] !== undefined);
  const antes = camposEnviados.length
    ? await db.queryOne(`SELECT ${camposEnviados.join(', ')} FROM clientes WHERE id = $1`, [req.params.id])
    : null;

  params.push(req.params.id);
  updates.push('atualizado_em = NOW()');

  await db.execute(`UPDATE clientes SET ${updates.join(', ')} WHERE id = $${params.length}`, params);

  if (antes || req.body.anotacoes !== undefined) {
    const mudancas = diferenca(antes, req.body, camposEnviados, { resumir: { whatsapp: resumirTelefone, email: resumirEmail } });
    // As anotações são cifradas (podem ter senha de portal do servidor): o log só marca que mudaram.
    if (req.body.anotacoes !== undefined) mudancas.depois.anotacoes = '[alteradas]';
    if (mudancas.mudou || req.body.anotacoes !== undefined) {
      await registrarAuditoria({
        usuarioId: req.user.id, acao: 'editar', entidade: 'cliente', entidadeId: req.params.id,
        valorAntes: mudancas.antes, valorDepois: mudancas.depois, ip: req._ip,
      });
    }
  }

  // Se atualizou cargo ou órgão, re-verificar elegibilidade
  if (req.body.cargo !== undefined || req.body.orgao !== undefined) {
    verificarElegibilidadeCliente(req.params.id, req.user.id)
      .catch(err => console.warn('[Elegibilidade] Erro no PATCH:', err.message));
  }

  res.json({ ok: true });
});

// ─── DOCUMENTOS ───────────────────────────────────────────────────────────────
// Upload, listagem e exclusão de PDFs do cliente (S-24): ver clientes.documentos.js.
clientesRouter.use('/:id/documentos', documentosRouter);
