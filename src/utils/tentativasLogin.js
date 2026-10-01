// Contadores de tentativas de login erradas (S-02), em memória — o backend roda em 1 instância só;
// reiniciar o processo (deploy) zera tudo, e isso é aceitável para um limite de 15 minutos.
//
// Dois contadores, compartilhados entre POST /api/auth/login e POST /oauth/authorize (conector):
// - e-mail + IP: 10 falhas a cada 15 min. Quem erra a senha 10 vezes do mesmo lugar espera.
//   A chave leva o IP de propósito: um contador só por e-mail deixaria qualquer pessoa na
//   internet trancar para fora um Master (há um único Master 01) errando a senha dele de longe.
// - só e-mail (teto): 50 falhas por hora, de qualquer IP. Bloqueia APENAS o /oauth/authorize
//   (quem pede o teto é o próprio OAuth); o login do AM nunca é bloqueado por ele.
//
// Cada tentativa é contada na CHEGADA e devolvida (desfazer) se não terminar em falha de
// credencial — assim uma rajada de tentativas em paralelo não escapa do limite, e os acertos
// não consomem o contador (mesma semântica do skipSuccessfulRequests do express-rate-limit).
import { ipKeyGenerator } from 'express-rate-limit';

const MINUTO = 60 * 1000;
const MAX_CHAVES = 5000; // teto de memória: as chaves vêm de texto digitado por qualquer um

// E-mail como aparece no log e nas chaves: minúsculo, sem espaços nas pontas, no máximo 254
// caracteres (limite do endereço). Sempre string.
export function normalizarEmailTentado(email) {
  return String(email ?? '').toLowerCase().trim().slice(0, 254);
}

// Janela fixa por chave, começando na primeira tentativa da chave.
function criarJanela({ max, janelaMs, agora }) {
  const mapa = new Map(); // chave -> { n, expira, avisado }

  const vivo = (chave) => {
    const e = mapa.get(chave);
    if (!e) return null;
    if (e.expira <= agora()) { mapa.delete(chave); return null; }
    return e;
  };
  const podar = () => {
    for (const [k, e] of mapa) if (e.expira <= agora()) mapa.delete(k);
    while (mapa.size >= MAX_CHAVES) mapa.delete(mapa.keys().next().value); // o mais antigo
  };

  return {
    // Entrada vigente da chave se ela já estourou o limite; senão null.
    estourou(chave) {
      const e = vivo(chave);
      return e && e.n >= max ? e : null;
    },
    // Conta uma tentativa; devolve a função que a desconta (sem passar de zero).
    contar(chave) {
      let e = vivo(chave);
      if (!e) {
        if (mapa.size >= MAX_CHAVES) podar();
        e = { n: 0, expira: agora() + janelaMs, avisado: false };
        mapa.set(chave, e);
      }
      e.n += 1;
      return () => { if (e.n > 0) e.n -= 1; };
    },
    restanteMs: (e) => Math.max(0, e.expira - agora()),
  };
}

export function criarTentativasLogin({
  agora = Date.now,
  maxEmailIp = 10, janelaEmailIpMs = 15 * MINUTO,
  maxEmail = 50, janelaEmailMs = 60 * MINUTO,
} = {}) {
  const porEmailIp = criarJanela({ max: maxEmailIp, janelaMs: janelaEmailIpMs, agora });
  const porEmail = criarJanela({ max: maxEmail, janelaMs: janelaEmailMs, agora });

  // IPv6 entra pelo prefixo /56 (como no express-rate-limit), senão um único cliente trocaria de
  // endereço dentro do próprio bloco para escapar do limite.
  const ipDaChave = (ip) => {
    if (!ip) return '';
    try { return ipKeyGenerator(String(ip)); } catch { return String(ip); }
  };
  const chaveEmailIp = (email, ip) => `${email}|${ipDaChave(ip)}`;

  return {
    // Chamar na chegada de cada tentativa de senha.
    // - bloqueio: null (segue), 'email_ip' (some com `porIp: false`) ou 'email' (só com `comTeto`),
    //   com `retryAposMs`; `primeiroAviso` é true uma única vez por janela do teto (para auditar
    //   sem inundar o log).
    // - desfazer(): descontar a tentativa quando ela NÃO foi uma falha de credencial.
    // E-mail vazio não conta (a limitação por IP do express-rate-limit já cobre esse caso).
    iniciar(emailBruto, ip, { comTeto = false, porIp = true } = {}) {
      const email = normalizarEmailTentado(emailBruto);
      if (!email) return { bloqueio: null, desfazer() {} };

      const chave = chaveEmailIp(email, ip);
      const estourouEmailIp = porIp ? porEmailIp.estourou(chave) : null;
      if (estourouEmailIp) {
        return { bloqueio: 'email_ip', retryAposMs: porEmailIp.restanteMs(estourouEmailIp), desfazer() {} };
      }
      if (comTeto) {
        const estourouEmail = porEmail.estourou(email);
        if (estourouEmail) {
          const primeiroAviso = !estourouEmail.avisado;
          estourouEmail.avisado = true;
          return { bloqueio: 'email', primeiroAviso, retryAposMs: porEmail.restanteMs(estourouEmail), desfazer() {} };
        }
      }
      const desfazerEmailIp = porEmailIp.contar(chave);
      const desfazerEmail = porEmail.contar(email);
      return { bloqueio: null, desfazer() { desfazerEmailIp(); desfazerEmail(); } };
    },
  };
}

// Instância única do processo: login do AM e conector OAuth dividem os mesmos contadores.
export const tentativasLogin = criarTentativasLogin();

// Os limites que dependem do IP só valem se o `req.ip` do Express for o do cliente de verdade.
// Com `trust proxy` errado (mais saltos do que o configurado), todo mundo cairia no mesmo IP.
// LIMITES_POR_IP=desligado desliga os limites por IP (fica só o teto por e-mail no OAuth) sem
// mudar código; ver TRUST_PROXY_SALTOS em src/index.js.
export const limitesPorIpAtivos = () => String(process.env.LIMITES_POR_IP || '').toLowerCase() !== 'desligado';
