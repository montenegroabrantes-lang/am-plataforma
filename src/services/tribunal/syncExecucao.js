/**
 * Fechamento das execuções do sync (tabela sync_execucoes) — R-14.
 *
 * Regra: toda linha aberta por sincronizarTodos() precisa ser fechada (concluido_em): no fim
 * normal, num erro fatal, ou no boot seguinte quando o processo morreu no meio (deploy).
 *
 * `erro` preenchido = execução ABORTADA. Ela não conta como "último sync concluído" na janela
 * incremental de sincronizarTodos(); senão uma falha faria o sync seguinte pular o que ficou
 * sem ser consultado. Nesses casos `falhas` é sempre >= 1 (nunca fica "0 falhas" com aparência
 * de sucesso).
 *
 * Sem imports de db/redis de propósito: recebe o banco por parâmetro (testável sem Redis).
 */

const MAX_ERRO = 300;
export const ERRO_INTERROMPIDA = 'Interrompida por reinício do servidor antes de concluir.';

// Mensagem que vai para sync_execucoes.erro: uma linha, tamanho limitado e sem dado pessoal
// (e-mail, CPF, número de processo ou qualquer sequência longa de dígitos, como telefone).
export function mensagemErroSync(err) {
  const bruta = String(err?.message ?? err ?? '').split('\n')[0].trim() || 'Erro sem mensagem';
  return bruta
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[e-mail]')
    .replace(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/g, '[processo]')
    .replace(/\d{3}\.\d{3}\.\d{3}-\d{2}/g, '[cpf]')
    .replace(/\d{8,}/g, '[número]')
    .slice(0, MAX_ERRO);
}

// Fecha a execução `execucaoId`. Nunca lança: o fechamento roda dentro do catch do sync e não
// pode esconder o erro real de quem o chamou. Devolve true se a linha foi fechada.
export async function fecharExecucaoSync(banco, execucaoId, { viaDatajud = 0, falhas = 0, novasMovimentacoes = 0, erro = null } = {}) {
  if (!execucaoId) return false;
  try {
    await banco.execute(
      `UPDATE sync_execucoes
          SET concluido_em = NOW(), via_datajud = $1, falhas = $2, novas_movimentacoes = $3, erro = $4
        WHERE id = $5`,
      [viaDatajud, falhas, novasMovimentacoes, erro, execucaoId]
    );
    return true;
  } catch (err) {
    console.error(`[Sync] Falha ao fechar a execução ${execucaoId}:`, err.message);
  }
  // Coluna `erro` ainda ausente (migração pendente): fecha sem ela, para a linha não ficar aberta.
  try {
    await banco.execute(
      `UPDATE sync_execucoes
          SET concluido_em = NOW(), via_datajud = $1, falhas = $2, novas_movimentacoes = $3
        WHERE id = $4`,
      [viaDatajud, falhas, novasMovimentacoes, execucaoId]
    );
    return true;
  } catch (err) {
    console.error(`[Sync] Execução ${execucaoId} continua aberta:`, err.message);
    return false;
  }
}

// Boot: fecha TODAS as execuções abertas há mais de `minutos` (o restart mata o sync em andamento
// e limpa o lock). Devolve quantas fechou; quem chama reagenda um sync só se for > 0.
export async function fecharExecucoesAbertas(banco, { minutos = 10 } = {}) {
  const fechadas = await banco.query(
    `UPDATE sync_execucoes
        SET concluido_em = NOW(), falhas = GREATEST(COALESCE(falhas, 0), 1), erro = $1
      WHERE concluido_em IS NULL AND iniciado_em < NOW() - make_interval(mins => $2::int)
      RETURNING id`,
    [ERRO_INTERROMPIDA, minutos]
  );
  return fechadas.length;
}
