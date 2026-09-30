/**
 * Lock do sync de andamentos (R-06): garante UMA execução de sincronizarTodos() por vez.
 *
 * O lock antigo era um SET NX com validade fixa de 30 min, e três furos deixavam dois syncs rodarem juntos:
 *  1. uma execução mais longa que 30 min perdia o lock sem saber, e outra começava;
 *  2. o `finally` apagava a chave incondicionalmente, inclusive a de OUTRA execução que já a tinha assumido;
 *  3. o "forçar" da tela apagava o lock de quem estava rodando.
 *
 * Agora: a chave guarda um token só desta execução; um batimento renova a validade enquanto a execução vive
 * (validade curta: uma execução morta libera sozinha em minutos, sem esperar 30); renovar e liberar só valem
 * se o token ainda é o nosso (script Lua, atômico no Redis); e quem perde o lock fica sabendo (`perdido`) e
 * para no próximo ponto seguro, em vez de disputar com a execução nova.
 *
 * Sem imports de redis/db de propósito: recebe o cliente por parâmetro (testável sem Redis).
 */

export const CHAVE_LOCK_SYNC   = 'sync:global:lock';
export const LOCK_TTL_S        = 300;      // sem renovação por 5 min = execução morta
export const LOCK_BATIMENTO_MS = 60_000;   // renova a cada 1 min (5 batimentos cabem no prazo)
const LIBERAR_ESPERA_MAX_MS    = 5_000;    // Redis fora do ar não pode travar o fim do sync (o cliente enfileira comandos sem limite)

// Exportados: o dublê de Redis dos testes reconhece os scripts por igualdade de texto.
export const SCRIPT_RENOVAR = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], ARGV[2]) else return 0 end`;
export const SCRIPT_LIBERAR = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

// Tenta pegar o lock. Devolve null se outra execução já o tem; senão { token, perdido, liberar() }.
// `perdido` vira true se o batimento descobrir que a chave não é mais nossa (expirou ou foi apagada).
export async function adquirirLock(redis, chave = CHAVE_LOCK_SYNC, { ttl = LOCK_TTL_S, batimentoMs = LOCK_BATIMENTO_MS, esperaLiberarMs = LIBERAR_ESPERA_MAX_MS } = {}) {
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const obtido = await redis.set(chave, token, 'NX', 'EX', ttl);
  if (!obtido) return null;

  const lock = { token, perdido: false, liberar: null };

  let renovando = false;   // não empilha renovações se o Redis estiver lento
  const timer = setInterval(async () => {
    if (renovando) return;
    renovando = true;
    try {
      const renovou = await redis.eval(SCRIPT_RENOVAR, 1, chave, token, ttl);
      if (Number(renovou) !== 1) {
        lock.perdido = true;
        clearInterval(timer);
        console.warn('[Sync] Lock perdido: a chave expirou ou foi assumida por outra execução — esta para no próximo ponto seguro.');
      }
    } catch (err) {
      // Redis fora por um instante: tenta de novo no próximo batimento. Se passar do prazo, o batimento
      // seguinte acusa a perda (a renovação devolve 0 quando a chave já não é nossa).
      console.warn('[Sync] Batimento do lock falhou:', err.message);
    } finally {
      renovando = false;
    }
  }, batimentoMs);
  timer.unref?.();   // o batimento nunca segura o processo vivo

  lock.liberar = async () => {
    clearInterval(timer);
    let espera;
    try {
      await Promise.race([
        redis.eval(SCRIPT_LIBERAR, 1, chave, token),   // só apaga se ainda for o nosso
        new Promise((_, rejeitar) => { espera = setTimeout(() => rejeitar(new Error('Redis não respondeu')), esperaLiberarMs); }),
      ]);
    } catch (err) {
      console.warn('[Sync] Não foi possível liberar o lock (expira sozinho):', err.message);
    } finally {
      clearTimeout(espera);
    }
  };
  return lock;
}

// Para o botão "forçar" da tela: apaga o lock SÓ se ele estiver parado (sem batimento há mais de 2 ciclos).
// Um lock vivo é renovado a cada `batimentoMs`, então nunca fica com menos de (ttl - 2 batimentos) de validade.
// Devolve true se apagou. Nunca lança.
export async function liberarLockSeInativo(redis, chave = CHAVE_LOCK_SYNC, { ttl = LOCK_TTL_S, batimentoMs = LOCK_BATIMENTO_MS } = {}) {
  try {
    const restanteMs = await redis.pttl(chave);   // -2 = não existe, -1 = sem validade
    if (restanteMs === -2) return false;
    const limiteMs = ttl * 1000 - 2 * batimentoMs;
    if (restanteMs === -1 || restanteMs < limiteMs) {
      await redis.del(chave);
      return true;
    }
    return false;
  } catch (err) {
    console.warn('[Sync] Não foi possível verificar o lock:', err.message);
    return false;
  }
}
