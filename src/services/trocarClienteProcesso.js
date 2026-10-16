// Troca o cliente vinculado a um processo já cadastrado (Master). Antes só dava para vincular quando o
// processo não tinha cliente; o campo "Polo Ativo / Cliente" da ficha é só o TEXTO do tribunal e não troca
// a cliente — caso real de 16/10/2026 (processo 0819569, autora Maria do Socorro, vinculado à Nadja).
//
// Regras: cliente de destino ativo e diferente do atual; recusa se o processo tem tarefas presas ao
// contrato (cliente_produtos) do cliente atual — essas precisam ser tratadas à parte; leva junto as
// cobranças ao cliente do processo e as tarefas sem contrato; não cria contrato de tese por conta própria
// (avisa se o destino não tem a tese do processo). Tudo numa transação, com auditoria antes e depois.

import { db as dbPadrao } from '../db/index.js';
import { registrarAuditoria } from '../middleware/auditoria.js';

export class ErroTroca extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}

export async function trocarClienteDoProcesso({ processoId, clienteId, usuarioId, ip }, { db = dbPadrao, auditar = registrarAuditoria } = {}) {
  return db.transaction(async tx => {
    const p = await tx.queryOne(
      `SELECT p.id, p.numero, p.cliente_id, p.produto_id, c.nome AS cliente_nome
         FROM processos p LEFT JOIN clientes c ON c.id = p.cliente_id WHERE p.id = $1 FOR UPDATE OF p`, [processoId]);
    if (!p) throw new ErroTroca(404, 'Processo não encontrado.');
    const novo = await tx.queryOne(`SELECT id, nome FROM clientes WHERE id = $1 AND ativo IS NOT FALSE`, [clienteId]);
    if (!novo) throw new ErroTroca(404, 'Cliente de destino não encontrado ou inativo.');
    if (p.cliente_id === novo.id) throw new ErroTroca(400, 'O processo já está vinculado a este cliente.');

    const presas = await tx.queryOne(`SELECT COUNT(*) AS n FROM tarefas WHERE processo_id = $1 AND cliente_produto_id IS NOT NULL`, [processoId]);
    if (Number(presas?.n) > 0) {
      throw new ErroTroca(409, `Este processo tem ${presas.n} tarefa(s) ligada(s) ao contrato do cliente atual. Cancele ou transfira essas tarefas antes de trocar o cliente.`);
    }

    await tx.execute(`UPDATE processos SET cliente_id = $1, atualizado_em = NOW() WHERE id = $2`, [novo.id, processoId]);
    await tx.execute(`UPDATE tarefas SET cliente_id = $1 WHERE processo_id = $2`, [novo.id, processoId]);
    await tx.execute(`UPDATE cobrancas_cliente SET cliente_id = $1, atualizado_em = NOW() WHERE processo_id = $2 AND status IN ('a_cobrar','cobrado')`, [novo.id, processoId]);

    let teseSemVinculo = false;
    if (p.produto_id) {
      const tem = await tx.queryOne(`SELECT 1 AS ok FROM cliente_produtos WHERE cliente_id = $1 AND produto_id = $2`, [novo.id, p.produto_id]);
      teseSemVinculo = !tem;
    }

    await auditar({
      usuarioId, acao: 'trocar_cliente_processo', entidade: 'processo', entidadeId: processoId,
      valorAntes: { cliente_id: p.cliente_id, cliente_nome: p.cliente_nome },
      valorDepois: { cliente_id: novo.id, cliente_nome: novo.nome, tese_sem_vinculo_no_destino: teseSemVinculo },
      ip,
    }, tx);
    return { cliente: { id: novo.id, nome: novo.nome }, numero: p.numero, tese_sem_vinculo: teseSemVinculo };
  });
}
