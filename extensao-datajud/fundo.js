// Faz as consultas ao DataJud (a página do AM não pode: o DataJud não libera chamadas de outros sites).
// Só aceita pedidos da página do AM e só chama o endereço do DataJud que o AM indicou.
const BASE_PERMITIDA = 'https://api-publica.datajud.cnj.jus.br';
const ORIGEM_AM = 'https://am-plataforma-web-production.up.railway.app';
const esperar = ms => new Promise(r => setTimeout(r, ms));

async function consultar(base, chave, { indice, corpo }) {
  if (!/^api_publica_[a-z0-9]+$/.test(String(indice))) return { indice, status: null, data: null };
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      const r = await fetch(`${base}/${indice}/_search`, {
        method: 'POST',
        headers: { Authorization: `APIKey ${chave}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
      });
      if (r.ok) return { indice, status: r.status, data: await r.json() };
      if (r.status !== 429 && r.status < 500) return { indice, status: r.status, data: null };
      if (tentativa === 3) return { indice, status: r.status, data: null };
    } catch {
      if (tentativa === 3) return { indice, status: null, data: null };
    }
    await esperar(tentativa * 5000);
  }
}

chrome.runtime.onMessage.addListener((msg, remetente, responder) => {
  if (msg?.tipo !== 'consultar-datajud') return false;
  if (!String(remetente?.url || '').startsWith(ORIGEM_AM)) { responder(null); return false; }
  const { base, chave, consultas } = msg.tarefa || {};
  if (base !== BASE_PERMITIDA || !chave || !Array.isArray(consultas)) { responder(null); return false; }
  (async () => {
    const respostas = [];
    for (const c of consultas) respostas.push(await consultar(base, chave, c));
    responder(respostas);
  })();
  return true; // resposta assíncrona
});
