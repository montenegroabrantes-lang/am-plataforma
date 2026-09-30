// S-10 (Onda 4) — a senha e o segredo 2FA do PJe guardados em credenciais_tribunal não são usados
// por nenhum código: o sync só lê o CPF (services/tribunal/sync.js, separação de sócios). A rota
// /api/credenciais, que gravava esses segredos, foi removida junto com esta migração.
//
// Duas migrações, de propósito separadas:
//  1. NÃO destrutiva, sempre roda: senha_enc deixa de ser obrigatória (o schema antigo tinha NOT NULL).
//  2. DESTRUTIVA, DESLIGADA por padrão: só roda com APAGAR_CREDENCIAL_PJE_ATIVO=true no ambiente
//     (decisão D5 do plano — apagar a senha/2FA do PJe, mantendo CPF, OAB e ativo). Quando a variável
//     está ausente, a migração nem é chamada, então não fica registrada em schema_migrations e ainda
//     pode rodar mais tarde, num deploy com a variável ligada. Roda uma única vez e grava auditoria
//     (`apagar_credencial_tribunal`) só com a contagem, nunca com valores.
//     O que for apagado NÃO volta pelo sistema (só pelos backups/PITR até saírem da rotação).
import { registrarAuditoria } from '../middleware/auditoria.js';

export const FLAG_APAGAR_CREDENCIAL_PJE = 'APAGAR_CREDENCIAL_PJE_ATIVO';

export function apagarCredencialPjeLigado(env = process.env) {
  return String(env[FLAG_APAGAR_CREDENCIAL_PJE] || '').trim().toLowerCase() === 'true';
}

export async function aplicarMigracoesS10({ db, migrar, env = process.env }) {
  await migrar('2026_10_S10_senha_pje_opcional', async () => {
    await db.execute(`ALTER TABLE credenciais_tribunal ALTER COLUMN senha_enc DROP NOT NULL`);
  });

  if (!apagarCredencialPjeLigado(env)) return;

  await migrar('2026_10_S10_apagar_credencial_pje', () => db.transaction(async (tx) => {
    const r = await tx.execute(
      `UPDATE credenciais_tribunal
          SET senha_enc = NULL, totp_secret = NULL, sessao_cookie = NULL
        WHERE senha_enc IS NOT NULL OR totp_secret IS NOT NULL OR sessao_cookie IS NOT NULL`
    );
    await registrarAuditoria({
      acao: 'apagar_credencial_tribunal',
      entidade: 'credenciais_tribunal',
      valorDepois: { linhas_limpas: r?.rowCount ?? null },
    }, tx);
  }));
}
