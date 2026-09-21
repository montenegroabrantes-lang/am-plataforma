import { Router } from 'express';
import { db }      from '../db/index.js';
import { apenasMaster } from '../middleware/auth.js';
import { uuidValido } from '../utils/validacao.js';
import { registrarAuditoria } from '../middleware/auditoria.js';

export const produtosRouter = Router();

// GET /api/produtos — catálogo completo
produtosRouter.get('/', async (req, res) => {
  const { ativo = 'true' } = req.query;
  const rows = await db.query(
    `SELECT * FROM produtos WHERE ativo = $1 ORDER BY nome`,
    [ativo === 'true']
  );
  res.json({ ok: true, produtos: rows });
});

// POST /api/produtos — criar produto
produtosRouter.post('/', apenasMaster, async (req, res) => {
  const { nome, polos_passivos_padrao, codigo_assunto_pje,
          tribunais_padrao, cargos_elegiveis, orgaos_elegiveis, intervalo_meses,
          honorarios_padrao, descricao } = req.body;

  if (!nome) return res.status(400).json({ ok: false, erro: 'nome é obrigatório.' });

  const [novo] = await db.query(
    `INSERT INTO produtos (nome, polos_passivos_padrao, codigo_assunto_pje,
                           tribunais_padrao, cargos_elegiveis, orgaos_elegiveis, intervalo_meses,
                           honorarios_padrao, descricao)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      nome.trim(),
      polos_passivos_padrao || null,
      codigo_assunto_pje    || null,
      tribunais_padrao      || null,
      cargos_elegiveis      || null,
      orgaos_elegiveis      || null,
      intervalo_meses       || null,
      honorarios_padrao != null && honorarios_padrao !== '' ? Number(honorarios_padrao) : null,
      descricao             || null,
    ]
  );
  res.status(201).json({ ok: true, produto: novo });
});

// Categorias de documento reconhecidas pelo checklist por tese — mesmo vocabulário que a
// Camila já usa em ContinuidadeCamila.jsx (campos), pra não inventar um segundo dicionário.
const CATEGORIAS_DOCUMENTO_VALIDAS = ['identidade', 'cpf', 'residencia', 'contracheque'];

// PATCH /api/produtos/:id — atualizar produto
produtosRouter.patch('/:id', apenasMaster, async (req, res) => {
  const campos = ['nome', 'polos_passivos_padrao', 'codigo_assunto_pje',
                  'tribunais_padrao', 'cargos_elegiveis', 'orgaos_elegiveis', 'ativo', 'intervalo_meses',
                  'honorarios_padrao', 'descricao', 'responsavel_reprotocolo_id', 'prazo_reprotocolo_dias_uteis',
                  'documentos_exigidos'];
  if (req.body.documentos_exigidos !== undefined && req.body.documentos_exigidos !== null) {
    if (!Array.isArray(req.body.documentos_exigidos) || req.body.documentos_exigidos.some(c => !CATEGORIAS_DOCUMENTO_VALIDAS.includes(c))) {
      return res.status(400).json({ ok: false, erro: `documentos_exigidos deve ser uma lista com valores entre: ${CATEGORIAS_DOCUMENTO_VALIDAS.join(', ')}.` });
    }
    // [] e null significam a mesma coisa ("sem checklist configurado") — normaliza aqui pra
    // nunca gravar os dois valores como se fossem estados diferentes (achado do revisor da
    // Fase 5, fatia 1).
    const dedup = [...new Set(req.body.documentos_exigidos)];
    req.body.documentos_exigidos = dedup.length > 0 ? dedup : null;
  }
  if (req.body.responsavel_reprotocolo_id) {
    if (!uuidValido(req.body.responsavel_reprotocolo_id)) {
      return res.status(400).json({ ok: false, erro: 'Responsável de re-protocolo inválido.' });
    }
    const ativo = await db.queryOne(`SELECT id FROM usuarios WHERE id=$1 AND ativo=true`, [req.body.responsavel_reprotocolo_id]);
    if (!ativo) return res.status(400).json({ ok: false, erro: 'O responsável de re-protocolo selecionado não está ativo.' });
  }
  if (req.body.prazo_reprotocolo_dias_uteis !== undefined) {
    const dias = Number(req.body.prazo_reprotocolo_dias_uteis);
    if (!Number.isInteger(dias) || dias < 1 || dias > 90) {
      return res.status(400).json({ ok: false, erro: 'Prazo de re-protocolo deve ser um número inteiro entre 1 e 90 dias úteis.' });
    }
  }

  const updates = [];
  const params  = [];

  for (const campo of campos) {
    if (req.body[campo] !== undefined) {
      // Só o responsável de re-protocolo é opcional o suficiente pra aceitar string vazia
      // como "limpar seleção"; nome/ativo/etc. são NOT NULL e não podem virar null aqui.
      const valor = campo === 'responsavel_reprotocolo_id' && req.body[campo] === '' ? null : req.body[campo];
      // documentos_exigidos é JSONB: o driver serializa array/objeto JS como literal de ARRAY
      // do Postgres (ex.: {a,b}), não como JSON — precisa de JSON.stringify + cast explícito,
      // diferente das colunas TEXT[] deste mesmo loop (essas sim querem o array cru).
      if (campo === 'documentos_exigidos') {
        params.push(valor === null ? null : JSON.stringify(valor));
        updates.push(`${campo} = $${params.length}::jsonb`);
      } else {
        params.push(valor);
        updates.push(`${campo} = $${params.length}`);
      }
    }
  }

  if (!updates.length) return res.status(400).json({ ok: false, erro: 'Nenhum campo para atualizar.' });

  params.push(req.params.id);
  await db.execute(
    `UPDATE produtos SET ${updates.join(', ')} WHERE id = $${params.length}`,
    params
  );

  res.json({ ok: true });
});

// DELETE /api/produtos/:id — desativa (soft delete)
produtosRouter.delete('/:id', apenasMaster, async (req, res) => {
  await db.execute(`UPDATE produtos SET ativo = false WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

// POST /api/produtos/clientes/:clienteId — vincular produto ao cliente
produtosRouter.post('/clientes/:clienteId', apenasMaster, async (req, res) => {
  let { produto_id, honorarios_pct } = req.body;
  if (!produto_id) {
    return res.status(400).json({ ok: false, erro: 'produto_id é obrigatório.' });
  }

  if (!uuidValido(req.params.clienteId) || !uuidValido(produto_id)) {
    return res.status(400).json({ ok: false, erro: 'Cliente ou tese jurídica inválidos.' });
  }

  const [cliente, produto] = await Promise.all([
    db.queryOne(`SELECT id FROM clientes WHERE id = $1 AND ativo = true`, [req.params.clienteId]),
    db.queryOne(`SELECT id, nome, honorarios_padrao FROM produtos WHERE id = $1 AND ativo = true`, [produto_id]),
  ]);
  if (!cliente) return res.status(404).json({ ok: false, erro: 'Cliente não encontrado ou inativo.' });
  if (!produto) return res.status(404).json({ ok: false, erro: 'Tese jurídica não encontrada ou inativa.' });

  // Se não informou honorarios_pct, busca o padrão do produto
  if (honorarios_pct === undefined || honorarios_pct === null || honorarios_pct === '') {
    honorarios_pct = produto.honorarios_padrao ?? 0;
  }

  const percentual = Number(honorarios_pct);
  if (!Number.isFinite(percentual) || percentual < 0 || percentual > 100) {
    return res.status(400).json({ ok: false, erro: 'Honorários devem ser um percentual entre 0 e 100.' });
  }

  try {
    const [novo] = await db.query(
      `INSERT INTO cliente_produtos (cliente_id, produto_id, honorarios_pct)
       VALUES ($1,$2,$3)
       RETURNING *`,
      [req.params.clienteId, produto_id, percentual]
    );
    res.status(201).json({ ok: true, vinculo: { ...novo, produto_nome: produto.nome } });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ ok: false, erro: 'Produto já vinculado a este cliente.' });
    throw e;
  }
});

// PATCH /api/produtos/clientes/:clienteId/:cpId — atualizar honorários do contrato
produtosRouter.patch('/clientes/:clienteId/:cpId', apenasMaster, async (req, res) => {
  if (!uuidValido(req.params.clienteId) || !uuidValido(req.params.cpId)) {
    return res.status(400).json({ ok: false, erro: 'Cliente ou vínculo de tese inválidos.' });
  }

  const honorariosInformados = req.body.honorarios_pct;
  const percentual = Number(honorariosInformados);
  if (honorariosInformados == null || String(honorariosInformados).trim() === ''
      || !Number.isFinite(percentual) || percentual < 0 || percentual > 100) {
    return res.status(400).json({ ok: false, erro: 'Honorários devem ser um percentual entre 0 e 100.' });
  }

  const vinculoAtual = await db.queryOne(
    `SELECT cp.id, cp.cliente_id, cp.produto_id, cp.honorarios_pct, pr.nome AS produto_nome
     FROM cliente_produtos cp
     JOIN produtos pr ON pr.id = cp.produto_id
     WHERE cp.id = $1 AND cp.cliente_id = $2`,
    [req.params.cpId, req.params.clienteId]
  );
  if (!vinculoAtual) {
    return res.status(404).json({ ok: false, erro: 'Vínculo da tese com este cliente não encontrado.' });
  }

  const [vinculo] = await db.query(
    `UPDATE cliente_produtos SET honorarios_pct = $1
     WHERE id = $2 AND cliente_id = $3
     RETURNING *`,
    [percentual, req.params.cpId, req.params.clienteId]
  );

  await registrarAuditoria({
    usuarioId: req.user.id,
    acao: 'alterar_honorarios_contrato',
    entidade: 'cliente_produto',
    entidadeId: req.params.cpId,
    valorAntes: { honorarios_pct: vinculoAtual.honorarios_pct, produto_id: vinculoAtual.produto_id },
    valorDepois: { honorarios_pct: percentual, produto_id: vinculoAtual.produto_id },
    ip: req._ip,
  });

  res.json({ ok: true, vinculo: { ...vinculo, produto_nome: vinculoAtual.produto_nome } });
});

// DELETE /api/produtos/clientes/:clienteId/:cpId — remover vínculo
produtosRouter.delete('/clientes/:clienteId/:cpId', apenasMaster, async (req, res) => {
  // Impede remoção se houver tarefa de protocolo ativa para esse vínculo
  const tarefaAtiva = await db.queryOne(
    `SELECT id FROM tarefas WHERE cliente_produto_id = $1 AND status NOT IN ('concluida','cancelada')`,
    [req.params.cpId]
  );
  if (tarefaAtiva) {
    return res.status(409).json({ ok: false, erro: 'Existe tarefa de protocolo ativa para esta tese. Conclua ou cancele antes de remover.' });
  }

  await db.execute(`DELETE FROM cliente_produtos WHERE id = $1`, [req.params.cpId]);
  res.json({ ok: true });
});
