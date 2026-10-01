// Healthcheck do Railway = PRONTIDÃO (R-12).
//
// Só responde 200 depois de o boot terminar (migrações e esquema prontos, `pronto()` verdadeiro)
// e enquanto o banco responder. Antes disso devolve 503: o Railway só promove o deploy novo
// quando ele passa, então uma migração quebrada não derruba a versão que está no ar (o processo
// sai com exit(1), o healthcheck nunca passa e o deploy anterior continua servindo).
//
// Pela documentação do Railway, o healthcheck só vale no momento do deploy (não é monitor
// contínuo) e o restart policy (ON_FAILURE) depende de o processo sair, não deste retorno: um 503
// aqui só reprova o deploy, não gera laço de reinício. Prazo para passar: `healthcheckTimeout` do
// railway.json (tem que cobrir o boot inteiro; o tempo real sai no log "[BOOT] Esquema pronto em").
export function criarHealth({ pronto, banco, env = process.env.NODE_ENV }) {
  return async (_req, res) => {
    if (!pronto()) return res.status(503).json({ ok: false, db: false, iniciando: true, env });
    try {
      await banco.query('SELECT 1');
      res.json({ ok: true, db: true, env });
    } catch {
      res.status(503).json({ ok: false, db: false, env });
    }
  };
}
