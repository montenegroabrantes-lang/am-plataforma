import { db } from '../db/index.js';
import { cpfValido } from '../utils/cpf.js';
import { uuidValido } from '../utils/validacao.js';
import { somarDiasUteis } from '../utils/diasUteis.js';
import { criarPastaCliente, criarSubpasta } from './drive/index.js';
import { registrarAuditoria } from '../middleware/auditoria.js';

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

function dataCalendarioValida(valor) {
  if (!DATA_RE.test(String(valor || ''))) return false;
  const [ano, mes, dia] = String(valor).split('-').map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia;
}

function numeroPercentual(valor, padrao = 20) {
  const n = Number(valor);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : padrao;
}

async function sincronizarDriveCliente(cliente, onboardingId) {
  try {
    if (cliente.drive_pasta_id) {
      await db.execute(
        `UPDATE onboardings_contrato SET drive_sync_status='sincronizado',drive_sync_erro=NULL WHERE id=$1`,
        [onboardingId]
      );
      return;
    }
    const { id: pastaId, url } = await criarPastaCliente(cliente.cpf, cliente.nome);
    await db.execute(`UPDATE clientes SET drive_pasta_id=$1, drive_pasta_url=$2 WHERE id=$3`, [pastaId, url, cliente.id]);
    await Promise.all([
      criarSubpasta(pastaId, 'Documentos Pessoais'), criarSubpasta(pastaId, 'Vínculo Funcional'),
      criarSubpasta(pastaId, 'Procurações'), criarSubpasta(pastaId, 'Contratos'), criarSubpasta(pastaId, 'Petições'),
    ]);
    await db.execute(
      `UPDATE onboardings_contrato SET drive_sync_status='sincronizado',drive_sync_erro=NULL WHERE id=$1`,
      [onboardingId]
    );
  } catch (err) {
    console.error('[Onboarding/Drive] Falha ao preparar pasta:', err.message);
    await db.execute(
      `UPDATE onboardings_contrato SET drive_sync_status='erro', drive_sync_erro=$1 WHERE id=$2`,
      [String(err.message || 'Falha no Google Drive').slice(0, 500), onboardingId]
    ).catch(() => {});
  }
}

export function validarDadosFechamento(onboarding = {}) {
  const erros = [];
  const produtos = Array.isArray(onboarding.produtos) ? onboarding.produtos : [];

  if (onboarding.contrato_assinado !== true) erros.push('Confirme que o contrato foi assinado.');
  if (!dataCalendarioValida(onboarding.contrato_data)) erros.push('Informe uma data de assinatura válida.');
  if (produtos.length === 0) erros.push('Selecione ao menos um produto contratado.');
  if (!uuidValido(onboarding.responsavel_protocolo_id)) erros.push('Selecione o responsável pelo protocolo.');
  if (!onboarding.cliente_id && !uuidValido(onboarding.responsavel_cadastro_id)) erros.push('Selecione o responsável pelo cadastro.');
  if (onboarding.cliente_id && !uuidValido(onboarding.cliente_id)) erros.push('Cliente existente inválido.');
  if (onboarding.prazo_cadastro && !dataCalendarioValida(onboarding.prazo_cadastro)) erros.push('Prazo de cadastro inválido.');
  if (onboarding.prazo_protocolo && !dataCalendarioValida(onboarding.prazo_protocolo)) erros.push('Prazo de protocolo inválido.');

  const idsProdutos = produtos.map(p => p?.produto_id).filter(Boolean);
  if (new Set(idsProdutos).size !== idsProdutos.length) erros.push('Um produto contratado foi selecionado mais de uma vez.');

  for (const produto of produtos) {
    if (!uuidValido(produto?.produto_id)) erros.push('Há um produto contratado inválido.');
    const percentual = Number(produto?.honorarios_pct);
    if (!Number.isFinite(percentual) || percentual < 0 || percentual > 100) {
      erros.push('Os honorários devem estar entre 0% e 100%.');
    }
  }

  return [...new Set(erros)];
}

export async function buscarOnboardingPorContato(contactId) {
  return db.queryOne(
    `SELECT o.*, uc.nome AS responsavel_cadastro_nome, up.nome AS responsavel_protocolo_nome
       FROM onboardings_contrato o
       LEFT JOIN usuarios uc ON uc.id = o.responsavel_cadastro_id
       LEFT JOIN usuarios up ON up.id = o.responsavel_protocolo_id
      WHERE o.camila_contact_id = $1`,
    [String(contactId)]
  );
}

export async function criarOnboardingContrato({ contactId, lead = {}, onboarding, usuarioId, ip }) {
  const erros = validarDadosFechamento(onboarding);
  if (erros.length) {
    const erro = new Error(erros[0]);
    erro.status = 400;
    erro.detalhes = erros;
    throw erro;
  }
  if (!onboarding.cliente_id && !String(lead.nome || '').trim()) {
    const erro = new Error('Informe o nome do cliente para iniciar o cadastro.');
    erro.status = 400;
    throw erro;
  }

  // Repetir o fechamento (por exemplo, após falha da Camila) não recria nem altera o
  // fluxo local. A mesma chamada pode então ser usada com segurança para nova tentativa.
  const existente = await buscarOnboardingPorContato(contactId);
  if (existente && existente.status !== 'cancelado') return existente;

  const prazoCadastro = onboarding.prazo_cadastro || somarDiasUteis(new Date(), 1);
  const prazoProtocolo = onboarding.prazo_protocolo || somarDiasUteis(new Date(), 3);
  const idsProdutos = [...new Set(onboarding.produtos.map(p => p.produto_id))];
  const pg = await db.pool.connect();
  let registro;

  try {
    await pg.query('BEGIN');

    const produtosResult = await pg.query(
      `SELECT id, nome, COALESCE(honorarios_padrao, 20) AS honorarios_padrao
         FROM produtos WHERE ativo = true AND id = ANY($1::uuid[])`,
      [idsProdutos]
    );
    if (produtosResult.rows.length !== idsProdutos.length) {
      const erro = new Error('Um dos produtos selecionados não existe ou está inativo.');
      erro.status = 400;
      throw erro;
    }

    const responsaveis = [onboarding.responsavel_protocolo_id, onboarding.responsavel_cadastro_id]
      .filter(Boolean);
    const usuariosResult = await pg.query(
      `SELECT id FROM usuarios WHERE ativo = true AND id = ANY($1::uuid[])`,
      [responsaveis]
    );
    if (new Set(usuariosResult.rows.map(u => u.id)).size !== new Set(responsaveis).size) {
      const erro = new Error('Um dos responsáveis selecionados não está ativo.');
      erro.status = 400;
      throw erro;
    }

    let cliente = null;
    if (onboarding.cliente_id) {
      const clienteResult = await pg.query(
        `SELECT id, nome, cpf, drive_pasta_id, drive_pasta_url FROM clientes WHERE id = $1 AND ativo = true`,
        [onboarding.cliente_id]
      );
      cliente = clienteResult.rows[0];
      if (!cliente) {
        const erro = new Error('O cliente selecionado não foi encontrado.');
        erro.status = 400;
        throw erro;
      }
    }

    const status = cliente ? 'protocolo_pendente' : 'cadastro_pendente';
    const onboardingResult = await pg.query(
      `INSERT INTO onboardings_contrato
         (camila_contact_id, estimativa_id, cliente_id, nome, whatsapp, cargo, orgao,
          valor_fechado, contrato_assinado, contrato_data, status,
          responsavel_cadastro_id, responsavel_protocolo_id, prazo_cadastro, prazo_protocolo,
          registrado_por, fechado_em, atualizado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW())
       ON CONFLICT (camila_contact_id) DO UPDATE SET
         estimativa_id = COALESCE(EXCLUDED.estimativa_id, onboardings_contrato.estimativa_id),
         cliente_id = COALESCE(EXCLUDED.cliente_id, onboardings_contrato.cliente_id),
         nome = EXCLUDED.nome, whatsapp = EXCLUDED.whatsapp, cargo = EXCLUDED.cargo,
         orgao = EXCLUDED.orgao, valor_fechado = EXCLUDED.valor_fechado,
         contrato_assinado = true, contrato_data = EXCLUDED.contrato_data,
         status = CASE WHEN onboardings_contrato.status = 'concluido' THEN 'concluido' ELSE EXCLUDED.status END,
         responsavel_cadastro_id = EXCLUDED.responsavel_cadastro_id,
         responsavel_protocolo_id = EXCLUDED.responsavel_protocolo_id,
         prazo_cadastro = EXCLUDED.prazo_cadastro, prazo_protocolo = EXCLUDED.prazo_protocolo,
         registrado_por = EXCLUDED.registrado_por, atualizado_em = NOW()
       RETURNING *`,
      [
        String(contactId), lead.estimativa_id ? String(lead.estimativa_id) : null,
        cliente?.id || null, String(lead.nome || '').trim() || null,
        lead.telefone || lead.telefone_real || null, lead.cargo || null, lead.orgao || null,
        Number(lead.valor_fechado || lead.valor || 0) || null,
        onboarding.contrato_data, status,
        onboarding.responsavel_cadastro_id || null, onboarding.responsavel_protocolo_id,
        prazoCadastro, prazoProtocolo, usuarioId,
      ]
    );
    registro = onboardingResult.rows[0];

    const selecionados = new Set(idsProdutos);
    const antigosResult = await pg.query(
      `SELECT id, produto_id FROM onboarding_produtos WHERE onboarding_id = $1`,
      [registro.id]
    );
    for (const antigo of antigosResult.rows) {
      if (selecionados.has(antigo.produto_id)) continue;
      await pg.query(
        `UPDATE tarefas SET status='cancelada', justificativa_cancelamento='Produto removido do fechamento'
          WHERE onboarding_produto_id=$1 AND status NOT IN ('concluida','cancelada')`,
        [antigo.id]
      );
      await pg.query(`DELETE FROM onboarding_produtos WHERE id=$1`, [antigo.id]);
    }

    for (const produto of produtosResult.rows) {
      const enviado = onboarding.produtos.find(p => p.produto_id === produto.id);
      const honorarios = numeroPercentual(enviado?.honorarios_pct, Number(produto.honorarios_padrao));
      const opResult = await pg.query(
        `INSERT INTO onboarding_produtos (onboarding_id, produto_id, honorarios_pct)
         VALUES ($1,$2,$3)
         ON CONFLICT (onboarding_id, produto_id) DO UPDATE SET honorarios_pct=EXCLUDED.honorarios_pct
         RETURNING *`,
        [registro.id, produto.id, honorarios]
      );
      const op = opResult.rows[0];
      let clienteProdutoId = null;

      if (cliente) {
        const cpResult = await pg.query(
          `INSERT INTO cliente_produtos (cliente_id, produto_id, honorarios_pct)
           VALUES ($1,$2,$3)
           ON CONFLICT (cliente_id, produto_id) DO UPDATE SET honorarios_pct=EXCLUDED.honorarios_pct
           RETURNING id`,
          [cliente.id, produto.id, honorarios]
        );
        clienteProdutoId = cpResult.rows[0].id;
        await pg.query(`UPDATE onboarding_produtos SET cliente_produto_id=$1 WHERE id=$2`, [clienteProdutoId, op.id]);
      }

      const descricaoProtocolo = `Protocolar processo — ${produto.nome} — ${cliente?.nome || lead.nome || 'novo cliente'}`;
      let tarefaAdotada = null;
      if (clienteProdutoId) {
        const existenteResult = await pg.query(
          `SELECT id FROM tarefas WHERE cliente_produto_id=$1 AND tipo='protocolar'
            AND status NOT IN ('concluida','cancelada') LIMIT 1`,
          [clienteProdutoId]
        );
        tarefaAdotada = existenteResult.rows[0];
      }
      if (tarefaAdotada) {
        await pg.query(
          `UPDATE tarefas SET cliente_id=$1,onboarding_id=$2,onboarding_produto_id=$3,
             descricao=$4,instrucao=$5,atribuido_a=$6,validado_por=$7,urgencia='ALTO',
             prazo_data=$8,status='pendente',precisa_triagem=false WHERE id=$9`,
          [cliente.id,registro.id,op.id,descricaoProtocolo,
           'Confirmar documentos e protocolar a ação contratada. Ao concluir, informe o número CNJ.',
           onboarding.responsavel_protocolo_id,usuarioId,prazoProtocolo,tarefaAdotada.id]
        );
      } else {
        await pg.query(
          `INSERT INTO tarefas
             (cliente_id, cliente_produto_id, onboarding_id, onboarding_produto_id, tipo,
              descricao, instrucao, atribuido_a, validado_por, urgencia, prazo_data, status, precisa_triagem)
           VALUES ($1,$2,$3,$4,'protocolar',$5,$6,$7,$8,'ALTO',$9,$10,false)
           ON CONFLICT DO NOTHING`,
          [
            cliente?.id || null, clienteProdutoId, registro.id, op.id, descricaoProtocolo,
            'Confirmar documentos e protocolar a ação contratada. Ao concluir, informe o número CNJ.',
            onboarding.responsavel_protocolo_id, usuarioId, prazoProtocolo,
            cliente ? 'pendente' : 'bloqueada',
          ]
        );
      }
      await pg.query(
        `UPDATE tarefas SET atribuido_a=$1, prazo_data=$2,
             cliente_id=COALESCE($3,cliente_id), cliente_produto_id=COALESCE($4,cliente_produto_id),
             status=CASE WHEN $3::uuid IS NOT NULL AND status='bloqueada' THEN 'pendente' ELSE status END,
             precisa_triagem=false
          WHERE onboarding_produto_id=$5 AND tipo='protocolar'
            AND status NOT IN ('concluida','cancelada')`,
        [onboarding.responsavel_protocolo_id, prazoProtocolo, cliente?.id || null, clienteProdutoId, op.id]
      );
    }

    if (!cliente) {
      await pg.query(
        `INSERT INTO tarefas
           (onboarding_id, tipo, descricao, instrucao, atribuido_a, validado_por, urgencia, prazo_data, status, precisa_triagem)
         VALUES ($1,'cadastro_cliente',$2,$3,$4,$5,'ALTO',$6,'pendente',false)
         ON CONFLICT DO NOTHING`,
        [
          registro.id, `Completar cadastro — ${lead.nome || 'novo cliente'}`,
          'Preencher CPF, contatos, consentimento LGPD e vínculos funcionais. A conclusão libera automaticamente o protocolo.',
          onboarding.responsavel_cadastro_id, usuarioId, prazoCadastro,
        ]
      );
    }

    await pg.query('COMMIT');
  } catch (erro) {
    await pg.query('ROLLBACK');
    throw erro;
  } finally {
    pg.release();
  }

  await registrarAuditoria({
    usuarioId, acao: 'iniciar_onboarding', entidade: 'onboarding_contrato',
    entidadeId: registro.id,
    valorDepois: { contact_id: String(contactId), status: registro.status, produtos: idsProdutos },
    ip,
  });

  // O trabalho jurídico não espera o Drive, mas a sincronização fica observável no
  // onboarding e também repara clientes antigos que ainda não tinham pasta.
  if (cliente) void sincronizarDriveCliente(cliente, registro.id);

  return buscarOnboardingPorContato(contactId);
}

export async function marcarSincronizacaoCamila(onboardingId, ok, mensagem = null) {
  await db.execute(
    `UPDATE onboardings_contrato
        SET camila_sync_status=$1, camila_sync_erro=$2, atualizado_em=NOW()
      WHERE id=$3`,
    [ok ? 'sincronizado' : 'erro', ok ? null : String(mensagem || 'Falha desconhecida').slice(0, 500), onboardingId]
  );
}

export async function cancelarOnboardingPendente(contactId, usuarioId, ip) {
  const onboarding = await buscarOnboardingPorContato(contactId);
  if (!onboarding) return null;
  if (onboarding.status !== 'cadastro_pendente' || onboarding.cliente_id) {
    const erro = new Error('O onboarding já avançou. Cancele as tarefas e vínculos pelo fluxo operacional antes de desfazer o fechamento.');
    erro.status = 409;
    throw erro;
  }
  await db.execute(
    `UPDATE onboardings_contrato SET status='cancelado', atualizado_em=NOW() WHERE id=$1`,
    [onboarding.id]
  );
  await db.execute(
    `UPDATE tarefas SET status='cancelada', justificativa_cancelamento='Fechamento desfeito'
      WHERE onboarding_id=$1 AND status NOT IN ('concluida','cancelada')`,
    [onboarding.id]
  );
  await registrarAuditoria({
    usuarioId, acao: 'cancelar', entidade: 'onboarding_contrato', entidadeId: onboarding.id,
    valorAntes: { status: onboarding.status }, valorDepois: { status: 'cancelado' }, ip,
  });
  return onboarding;
}

export async function concluirCadastroOnboarding({ onboardingId, dados, usuario, ip }) {
  const { nome, cpf, whatsapp, email, lgpd_consentimento, vinculos } = dados || {};
  if (!nome || !cpf) {
    const erro = new Error('Nome e CPF são obrigatórios.'); erro.status = 400; throw erro;
  }
  if (!cpfValido(cpf)) {
    const erro = new Error('CPF inválido.'); erro.status = 400; throw erro;
  }
  if (lgpd_consentimento !== true) {
    const erro = new Error('É necessário registrar o consentimento LGPD.'); erro.status = 400; throw erro;
  }

  const cpfLimpo = cpf.replace(/\D/g, '');
  const pg = await db.pool.connect();
  let cliente;
  let criouCliente = false;

  try {
    await pg.query('BEGIN');
    const onboardingResult = await pg.query(
      `SELECT * FROM onboardings_contrato WHERE id=$1 FOR UPDATE`,
      [onboardingId]
    );
    const onboarding = onboardingResult.rows[0];
    if (!onboarding) { const erro = new Error('Onboarding não encontrado.'); erro.status = 404; throw erro; }
    if (onboarding.status === 'cancelado') { const erro = new Error('Este onboarding foi cancelado.'); erro.status = 409; throw erro; }
    if (onboarding.status !== 'cadastro_pendente' || onboarding.cliente_id) {
      const erro = new Error('O cadastro deste onboarding já foi concluído ou vinculado.');
      erro.status = 409;
      throw erro;
    }
    if (usuario.perfil !== 'master' && onboarding.responsavel_cadastro_id !== usuario.id) {
      const erro = new Error('Você não é o responsável por este cadastro.'); erro.status = 403; throw erro;
    }

    const masterId = usuario.perfil === 'master' ? usuario.id : usuario.master_id;
    const existenteResult = await pg.query(`SELECT * FROM clientes WHERE cpf=$1`, [cpfLimpo]);
    cliente = existenteResult.rows[0];
    if (cliente && usuario.perfil !== 'master' && cliente.master_responsavel_id !== masterId) {
      const erro = new Error('Este CPF já pertence a um cliente de outro responsável. Solicite a revisão de um Master.');
      erro.status = 409;
      throw erro;
    }
    if (!cliente) {
      const v1 = vinculos?.[0] || {};
      const novoResult = await pg.query(
        `INSERT INTO clientes
           (nome,cpf,whatsapp,email,cargo,orgao,vinculo_inicio,vinculo_fim,polo_passivo,
            lgpd_consentimento,lgpd_data,vinculo_ativo,master_responsavel_id,cadastrado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,NOW(),$10,$11,$12)
         RETURNING *`,
        [
          nome.trim(), cpfLimpo, whatsapp || null, email || null,
          v1.cargo || null, v1.orgao || null, v1.vinculo_inicio || null, v1.vinculo_fim || null,
          v1.polo_passivo || null, v1.vinculo_ativo !== false, masterId, usuario.id,
        ]
      );
      cliente = novoResult.rows[0];
      criouCliente = true;
    } else {
      const atualizadoResult = await pg.query(
        `UPDATE clientes SET nome=$1, whatsapp=COALESCE($2,whatsapp), email=COALESCE($3,email),
            lgpd_consentimento=true, lgpd_data=COALESCE(lgpd_data,NOW()), atualizado_em=NOW()
          WHERE id=$4 RETURNING *`,
        [nome.trim(), whatsapp || null, email || null, cliente.id]
      );
      cliente = atualizadoResult.rows[0];
    }

    if (Array.isArray(vinculos) && vinculos.length) {
      const countResult = await pg.query(`SELECT COUNT(*)::int total FROM cliente_vinculos WHERE cliente_id=$1`, [cliente.id]);
      if (countResult.rows[0].total === 0) {
        for (let i = 0; i < Math.min(vinculos.length, 2); i++) {
          const v = vinculos[i];
          if (!v.cargo && !v.orgao && !v.polo_passivo) continue;
          await pg.query(
            `INSERT INTO cliente_vinculos
               (cliente_id,ordem,cargo,orgao,vinculo_inicio,vinculo_fim,polo_passivo,vinculo_ativo)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [cliente.id, i + 1, v.cargo || null, v.orgao || null, v.vinculo_inicio || null,
             v.vinculo_fim || null, v.polo_passivo || null, v.vinculo_ativo !== false]
          );
        }
      }
    }

    const opsResult = await pg.query(
      `SELECT op.*, p.nome AS produto_nome
         FROM onboarding_produtos op JOIN produtos p ON p.id=op.produto_id
        WHERE op.onboarding_id=$1`,
      [onboarding.id]
    );
    for (const op of opsResult.rows) {
      const cpResult = await pg.query(
        `INSERT INTO cliente_produtos (cliente_id,produto_id,honorarios_pct)
         VALUES ($1,$2,$3)
         ON CONFLICT (cliente_id,produto_id) DO UPDATE SET honorarios_pct=EXCLUDED.honorarios_pct
         RETURNING id`,
        [cliente.id, op.produto_id, op.honorarios_pct]
      );
      const cpId = cpResult.rows[0].id;
      await pg.query(`UPDATE onboarding_produtos SET cliente_produto_id=$1 WHERE id=$2`, [cpId, op.id]);
      const onboardingTaskResult = await pg.query(
        `SELECT id FROM tarefas WHERE onboarding_produto_id=$1 AND tipo='protocolar'
          AND status NOT IN ('concluida','cancelada') LIMIT 1`,
        [op.id]
      );
      const onboardingTask = onboardingTaskResult.rows[0];
      const legadoResult = await pg.query(
        `SELECT id FROM tarefas WHERE cliente_produto_id=$1 AND tipo='protocolar'
          AND status NOT IN ('concluida','cancelada') AND id<>COALESCE($2::uuid,'00000000-0000-0000-0000-000000000000')
          LIMIT 1`,
        [cpId, onboardingTask?.id || null]
      );
      const legado = legadoResult.rows[0];
      if (legado) {
        if (onboardingTask) {
          await pg.query(
            `UPDATE tarefas SET status='cancelada', justificativa_cancelamento='Unificada com tarefa já existente após confirmação do contrato'
              WHERE id=$1`,
            [onboardingTask.id]
          );
        }
        await pg.query(
          `UPDATE tarefas SET cliente_id=$1,onboarding_id=$2,onboarding_produto_id=$3,
             descricao=$4,atribuido_a=$5,prazo_data=$6,status='pendente',precisa_triagem=false
            WHERE id=$7`,
          [cliente.id,onboarding.id,op.id,`Protocolar processo — ${op.produto_nome} — ${cliente.nome}`,
           onboarding.responsavel_protocolo_id,onboarding.prazo_protocolo,legado.id]
        );
      } else if (onboardingTask) {
        await pg.query(
          `UPDATE tarefas SET cliente_id=$1, cliente_produto_id=$2,
               descricao=$3, status=CASE WHEN status='bloqueada' THEN 'pendente' ELSE status END,
               precisa_triagem=false
            WHERE id=$4`,
          [cliente.id, cpId, `Protocolar processo — ${op.produto_nome} — ${cliente.nome}`, onboardingTask.id]
        );
      }
    }

    await pg.query(
      `UPDATE tarefas SET cliente_id=$1, status='concluida', concluida_em=NOW()
        WHERE onboarding_id=$2 AND tipo='cadastro_cliente' AND status NOT IN ('concluida','cancelada')`,
      [cliente.id, onboarding.id]
    );
    await pg.query(
      `UPDATE onboardings_contrato
          SET cliente_id=$1, status='protocolo_pendente', atualizado_em=NOW()
        WHERE id=$2`,
      [cliente.id, onboarding.id]
    );
    await pg.query('COMMIT');
  } catch (erro) {
    await pg.query('ROLLBACK');
    throw erro;
  } finally {
    pg.release();
  }

  void sincronizarDriveCliente(cliente, onboardingId);

  await registrarAuditoria({
    usuarioId: usuario.id, acao: 'concluir_cadastro', entidade: 'onboarding_contrato',
    entidadeId: onboardingId, valorDepois: { cliente_id: cliente.id }, ip,
  });
  return { cliente, criou_cliente: criouCliente };
}
