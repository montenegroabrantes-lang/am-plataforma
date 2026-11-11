// Roda dentro da página do AM, com a sessão de quem está logado (cookie do AM).
// Pergunta ao AM se há consulta a fazer; se houver, pede ao fundo.js que consulte o DataJud por esta
// máquina e devolve as respostas ao AM. Sem login, sem tarefa ou com outra máquina já fazendo: não faz nada.
const API = 'https://am-plataforma-production.up.railway.app/api/datajud-navegador';
const INTERVALO_MS = 30 * 60 * 1000;
let ocupado = false;

async function verificar() {
  if (ocupado) return;
  ocupado = true;
  try {
    const r = await fetch(`${API}/tarefa`, { credentials: 'include' });
    if (!r.ok) return; // sem login (401) ou AM fora do ar
    const { tarefa } = await r.json();
    if (!tarefa) return;
    const respostas = await chrome.runtime.sendMessage({ tipo: 'consultar-datajud', tarefa });
    if (!Array.isArray(respostas)) return;
    await fetch(`${API}/resultado`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: tarefa.token, respostas }),
    });
    console.info(`[AM DataJud] ${respostas.length} consulta(s) enviada(s) ao AM.`);
  } catch (e) {
    console.info('[AM DataJud] não foi possível concluir agora:', e?.message || e);
  } finally {
    ocupado = false;
  }
}

// Espera aleatória: com várias máquinas abrindo o AM ao mesmo tempo, não chegam juntas.
setTimeout(verificar, 10_000 + Math.random() * 50_000);
setInterval(verificar, INTERVALO_MS);
