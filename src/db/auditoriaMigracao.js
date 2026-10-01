import { db } from './index.js';

// S-13 (30/09/2026) — auditoria com o autor preservado e sem apagar.
//
// Migração 1 (`2026_10_S13_auditoria_autor`): só aditiva.
//  - `usuario_nome` e `usuario_email`: retrato do autor no momento da ação. Assim o log continua
//    dizendo quem fez mesmo se a conta for renomeada, desativada ou (contas sem histórico) excluída;
//  - preenche o retrato das linhas antigas a partir do cadastro atual (só onde ainda está vazio);
//  - índices para a tela de consulta (por data e por ação).
//
// Migração 2 (`2026_10_S13_auditoria_imutavel`): trigger que recusa DELETE, TRUNCATE e qualquer
// UPDATE, exceto o preenchimento inicial do retrato do autor numa linha que ainda não o tinha
// (nenhuma outra coluna pode mudar). Não apaga nem altera nenhum dado.
//
// Limite conhecido: quem é dono da tabela (o usuário do banco que a aplicação usa) consegue dar
// DROP TRIGGER. A trava barra bug e uso indevido pela aplicação, não um administrador do banco;
// contra esse caso valem o backup e o PITR.

export const SQL_AUDITORIA_AUTOR = [
  `ALTER TABLE logs_auditoria ADD COLUMN IF NOT EXISTS usuario_nome TEXT`,
  `ALTER TABLE logs_auditoria ADD COLUMN IF NOT EXISTS usuario_email TEXT`,
  `UPDATE logs_auditoria l SET usuario_nome = u.nome, usuario_email = u.email
     FROM usuarios u WHERE u.id = l.usuario_id AND l.usuario_nome IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_logs_auditoria_criado ON logs_auditoria (criado_em DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_logs_auditoria_acao ON logs_auditoria (acao, criado_em DESC)`,
];

export const SQL_AUDITORIA_IMUTAVEL = [
  `CREATE OR REPLACE FUNCTION logs_auditoria_somente_insercao() RETURNS trigger
   LANGUAGE plpgsql AS $fn$
   BEGIN
     IF TG_OP = 'UPDATE' THEN
       IF OLD.usuario_nome IS NULL AND OLD.usuario_email IS NULL
          AND ROW(NEW.id, NEW.usuario_id, NEW.acao, NEW.entidade, NEW.entidade_id, NEW.valor_antes, NEW.valor_depois, NEW.ip, NEW.criado_em)
              IS NOT DISTINCT FROM
              ROW(OLD.id, OLD.usuario_id, OLD.acao, OLD.entidade, OLD.entidade_id, OLD.valor_antes, OLD.valor_depois, OLD.ip, OLD.criado_em)
       THEN
         RETURN NEW;
       END IF;
     END IF;
     RAISE EXCEPTION 'logs_auditoria é somente de inserção (% bloqueado)', TG_OP
       USING ERRCODE = 'insufficient_privilege';
   END;
   $fn$`,
  `DROP TRIGGER IF EXISTS trg_logs_auditoria_imutavel ON logs_auditoria`,
  `CREATE TRIGGER trg_logs_auditoria_imutavel BEFORE UPDATE OR DELETE ON logs_auditoria
     FOR EACH ROW EXECUTE FUNCTION logs_auditoria_somente_insercao()`,
  `DROP TRIGGER IF EXISTS trg_logs_auditoria_sem_truncate ON logs_auditoria`,
  `CREATE TRIGGER trg_logs_auditoria_sem_truncate BEFORE TRUNCATE ON logs_auditoria
     FOR EACH STATEMENT EXECUTE FUNCTION logs_auditoria_somente_insercao()`,
];

async function rodarEmTransacao(banco, comandos) {
  await banco.transaction(async (tx) => {
    for (const sql of comandos) await tx.execute(sql);
  });
}

export const migrarAuditoriaAutor = (banco = db) => rodarEmTransacao(banco, SQL_AUDITORIA_AUTOR);
export const protegerAuditoria = (banco = db) => rodarEmTransacao(banco, SQL_AUDITORIA_IMUTAVEL);
