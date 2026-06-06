/**
 * Consulta processual pública do TJPB — sem login, sem MNI.
 * Limitação: protegida por Cloudflare. Precisa de browser real (Puppeteer + Stealth).
 *
 * Estratégia: navegar para a página, preencher o campo de pesquisa com o número
 * do processo via eventos reais de teclado (Puppeteer type()), clicar em "Consultar"
 * e aguardar a tabela de resultados aparecer via AJAX.
 * O param ?npu= pré-preenche o campo mas NÃO dispara o AJAX no modo headless —
 * por isso o clique explícito é sempre a ação primária.
 */
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin   from 'puppeteer-extra-plugin-stealth';

puppeteerExtra.use(StealthPlugin());

const BASE_URL = 'https://www.tjpb.jus.br/consulta-processual';

function browserArgs() {
  return [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--window-size=1280,900',
  ];
}

export async function abrirBrowser() {
  return puppeteerExtra.launch({
    headless: true,
    args: browserArgs(),
    executablePath: process.env.CHROMIUM_PATH || undefined,
    defaultViewport: { width: 1280, height: 900 },
    protocolTimeout: 120_000,
  });
}

// ─────────────────────────────────────────────
//  CONSULTAR UM PROCESSO (sessão própria)
// ─────────────────────────────────────────────
export async function consultarProcesso(numero) {
  const browser = await abrirBrowser();
  try {
    return await consultarComSessao(browser, numero);
  } finally {
    await browser.close().catch(() => {});
  }
}

// ─────────────────────────────────────────────
//  CONSULTAR REUTILIZANDO BROWSER (lote)
// ─────────────────────────────────────────────
export async function consultarComSessao(browser, numero) {
  const page = await browser.newPage();
  page.setDefaultTimeout(90_000);
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  );

  // Captura qualquer resposta JSON substancial — pode vir do domínio tjpb ou de CDN/API separada
  let xhrPayload = null;
  page.on('response', async (resp) => {
    try {
      if (xhrPayload) return; // já capturou
      const ct = resp.headers()['content-type'] || '';
      if (!ct.includes('json')) return;
      if (resp.status() !== 200) return;
      const u = resp.url();
      // Ignora manifests, chunks de framework e assets estáticos
      if (/\.(js|css|png|svg|ico|woff|map)(\?|$)/i.test(u)) return;
      const json = await resp.json().catch(() => null);
      if (json && JSON.stringify(json).length > 100) {
        xhrPayload = { url: u, body: json };
      }
    } catch { /* ignora */ }
  });

  try {
    const url = `${BASE_URL}?npu=${encodeURIComponent(numero)}`;

    // 1. Navega e aguarda networkidle2 para o Angular inicializar E o ?npu= disparar a busca.
    //    Race com 25s: se o Angular tiver polling em background, networkidle2 nunca settle.
    const gotoPromise = page.goto(url, { waitUntil: 'networkidle2', timeout: 30_000 });
    await Promise.race([gotoPromise, new Promise(r => setTimeout(r, 25_000))]).catch(() => {});

    const [pUrl, pTitle] = await Promise.all([page.url(), page.title()]);
    console.log(`[ConsultaPublica] ${numero} — url="${pUrl}" title="${pTitle}"`);

    // 2. Verifica se a busca automática (via ?npu=) já retornou resultados
    const jaTemResultados = await page.evaluate(() => {
      const ths = Array.from(document.querySelectorAll('th, thead td'))
        .map(e => e.textContent.trim().toLowerCase());
      return ths.some(h => h.includes('parte')) ||
             /Resultados para/i.test(document.body?.innerText || '');
    });

    if (!jaTemResultados) {
      // 3. Busca automática não disparou. Tentamos em sequência:
      //    A) page.focus() (Puppeteer nativo — rastreado antes do keypress) + Enter
      //    B) Despachar eventos de teclado diretamente no input (Angular ouve keydown)
      //    C) form.requestSubmit() — dispara o evento "submit" que (ngSubmit) escuta

      const INP_SEL = 'input[placeholder*="Número do Processo"]';

      // Lê o valor do FormControl para diagnóstico
      const valInput = await page.evaluate((sel) => {
        return document.querySelector(sel)?.value || '';
      }, INP_SEL).catch(() => '');
      console.log(`[ConsultaPublica] ${numero} — input="${valInput}", tentando submeter`);

      // A) page.focus() garante que o Puppeteer rastreia o foco ANTES do keypress
      const focusei = await page.focus(INP_SEL).then(() => true).catch(() => false);
      if (focusei) {
        await page.keyboard.press('Enter');
        console.log(`[ConsultaPublica] ${numero} — Enter via page.focus()`);
      }

      // Aguarda 3s para ver se o AJAX disparou
      await new Promise(r => setTimeout(r, 3_000));

      // Verifica se já tem resultado; se não, tenta B e C
      const temResultadoIntermedio = await page.evaluate(() =>
        document.querySelectorAll('th, thead td').length > 0
      ).catch(() => false);

      if (!temResultadoIntermedio) {
        // B) Despacha keydown/keyup Enter diretamente no input via eventos sintéticos
        await page.evaluate((sel) => {
          const inp = document.querySelector(sel);
          if (!inp) return;
          ['keydown', 'keypress', 'keyup'].forEach(type => {
            inp.dispatchEvent(new KeyboardEvent(type, {
              key: 'Enter', code: 'Enter', keyCode: 13,
              which: 13, bubbles: true, cancelable: true,
            }));
          });
        }, INP_SEL).catch(() => {});

        // C) form.requestSubmit() — mais correto que form.submit() (dispara validação + ngSubmit)
        await page.evaluate((sel) => {
          const inp = document.querySelector(sel);
          if (!inp) return;
          let el = inp;
          while (el && el.tagName !== 'FORM') el = el.parentElement;
          if (el?.tagName === 'FORM') {
            try { el.requestSubmit(); } catch { el.dispatchEvent(new Event('submit', { bubbles: true })); }
          }
        }, INP_SEL).catch(() => {});

        console.log(`[ConsultaPublica] ${numero} — tentativas B+C concluídas`);
      }

      // Aguarda o AJAX completar
      await page.waitForNetworkIdle({ idleTime: 1_000, timeout: 20_000 }).catch(() => {});
    } else {
      console.log(`[ConsultaPublica] ${numero} — busca auto disparou`);
    }

    // 4. Aguarda tabela de resultados aparecer
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('th, thead td'))
        .map(e => e.textContent.trim().toLowerCase())
        .some(h => h.includes('parte')),
      { timeout: 15_000 }
    ).catch(() => {});

    // 6. Espera AJAX estabilizar
    await new Promise(r => setTimeout(r, 1_500));

    const dados = await page.evaluate(extrairDoDom);

    // Loga diagnóstico sempre (ajuda a depurar se ainda falhar)
    const xhrInfo = xhrPayload ? xhrPayload.url : 'nenhuma';
    console.log(
      `[ConsultaPublica] ${numero} — polo_ativo="${dados.polo_ativo}" polo_passivo="${dados.polo_passivo}"` +
      ` textoLen=${dados._diag.textoLen} tabelas=${dados._diag.tabelas} xhr=${xhrInfo}`
    );

    // Se capturou XHR JSON, tenta extrair polo de lá (pode ter mais dados)
    if (xhrPayload?.body) {
      const extraidoXhr = extrairDeJson(xhrPayload.body);
      return {
        polo_ativo:       extraidoXhr.polo_ativo       || dados.polo_ativo,
        polo_passivo:     extraidoXhr.polo_passivo     || dados.polo_passivo,
        vara:             extraidoXhr.vara             || dados.vara,
        acao:             extraidoXhr.acao             || dados.acao,
        data_ajuizamento: extraidoXhr.data_ajuizamento || dados.data_ajuizamento,
        _diag: { ...dados._diag, xhrUrl: xhrPayload.url, fonte: 'xhr+dom' },
      };
    }

    return dados;
  } finally {
    await page.close().catch(() => {});
  }
}

// ─────────────────────────────────────────────
//  EXTRATOR DE JSON DA API — percorre objeto arbitrário procurando campos de polo
// ─────────────────────────────────────────────
function extrairDeJson(obj) {
  const result = { polo_ativo: null, polo_passivo: null, vara: null, acao: null, data_ajuizamento: null };

  function caminhar(o) {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(caminhar); return; }

    for (const [k, v] of Object.entries(o)) {
      const kLow = k.toLowerCase();

      if (typeof v === 'string' && v.length > 2) {
        if (!result.polo_ativo   && /poloativo|polo_ativo|requerente|autor|reclamante/i.test(kLow))    result.polo_ativo   = v;
        if (!result.polo_passivo && /polopassivo|polo_passivo|requerido|reu|réu|reclamado/i.test(kLow)) result.polo_passivo = v;
        if (!result.vara         && /(orgao|órgão|vara|julgador)/i.test(kLow))                           result.vara         = v;
        if (!result.acao         && /(classe|tipoAcao|tipo_acao|assunto)/i.test(kLow))                   result.acao         = v;
        if (!result.data_ajuizamento && /(ajuizamento|distribui|autuacao|autuação)/i.test(kLow))         result.data_ajuizamento = v;
      }

      // Arrays de partes — [{ polo: 'ATIVO'/'PASSIVO', nome: '...' }]
      if (kLow.includes('parte') && Array.isArray(v)) {
        for (const p of v) {
          if (!p || typeof p !== 'object') continue;
          const polo = (p.polo || p.tipoPolo || p.tipo || '').toString().toUpperCase();
          const nome  = p.nome || p.nomeParte || p.razaoSocial || '';
          if (!nome) continue;
          if (polo === 'ATIVO'   && !result.polo_ativo)   result.polo_ativo   = nome;
          if (polo === 'PASSIVO' && !result.polo_passivo) result.polo_passivo = nome;
        }
      }

      if (typeof v === 'object') caminhar(v);
    }
  }

  caminhar(obj);
  return result;
}

// ─────────────────────────────────────────────
//  EXTRATOR DOM — roda no contexto do browser
// ─────────────────────────────────────────────
function extrairDoDom() {
  const normalizar = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const limparNome = (txt) =>
    normalizar(txt).replace(/\s*[-–]\s*(CPF|CNPJ)[:\s].*$/i, '').trim() || null;

  let polo_ativo = null, polo_passivo = null, vara = null, acao = null, data_ajuizamento = null;

  // ── ESTRATÉGIA 1: tabela de resultados ──
  for (const table of document.querySelectorAll('table')) {
    const headers = Array.from(table.querySelectorAll('th, thead td'))
      .map(th => normalizar(th.textContent).toLowerCase());
    if (headers.length < 2) continue;

    const idxPartes = headers.findIndex(h => h.includes('parte'));
    const idxClasse = headers.findIndex(h => h.includes('classe'));
    const idxOrgao  = headers.findIndex(h => h.includes('órgão') || h.includes('orgao') || h.includes('vara'));
    const idxUltMov = headers.findIndex(h => h.includes('última') || h.includes('ultima') || h.includes('movimenta'));

    if (idxPartes < 0) continue;

    const rows = Array.from(table.querySelectorAll('tbody tr'));
    if (rows.length === 0) continue;

    const cells = Array.from(rows[0].querySelectorAll('td'));
    if (cells.length === 0) continue;

    const partesText = normalizar(cells[idxPartes]?.textContent);
    const m = partesText.match(/^(.+?)\s+x\s+(.+)$/i);
    if (m) {
      polo_ativo   = limparNome(m[1]);
      polo_passivo = limparNome(m[2]);
    } else if (partesText) {
      polo_ativo = limparNome(partesText);
    }

    if (idxClasse >= 0) acao = limparNome(cells[idxClasse]?.textContent);
    if (idxOrgao  >= 0) vara = limparNome(cells[idxOrgao]?.textContent);
    if (idxUltMov >= 0) {
      const mData = normalizar(cells[idxUltMov]?.textContent).match(/(\d{2}\/\d{2}\/\d{4})/);
      if (mData) data_ajuizamento = mData[1];
    }

    if (polo_ativo || polo_passivo) break;
  }

  // ── ESTRATÉGIA 2: texto bruto "NOME x NOME" ──
  const texto = normalizar(document.body?.innerText || '');
  if (!polo_ativo && !polo_passivo) {
    const m = texto.match(/([A-Za-zÀ-ÿ][^\n]{2,80}?)\s+x\s+([A-Za-zÀ-ÿ][^\n]{2,80}?)(?:\s{2,}|\s+\d{4,}|$)/);
    if (m) {
      polo_ativo   = limparNome(m[1]);
      polo_passivo = limparNome(m[2]);
    }
  }

  // ── ESTRATÉGIA 3: elementos com label "Polo Ativo" / "Polo Passivo" ──
  if (!polo_ativo) {
    document.querySelectorAll('*').forEach(el => {
      const txt = el.textContent.trim();
      if (/^polo ativo[:\s]/i.test(txt) && el.children.length === 0) {
        polo_ativo = limparNome(txt.replace(/^polo ativo[:\s]*/i, ''));
      }
      if (/^polo passivo[:\s]/i.test(txt) && el.children.length === 0) {
        polo_passivo = limparNome(txt.replace(/^polo passivo[:\s]*/i, ''));
      }
    });
  }

  // Diagnóstico — logado no Node, não exposto ao usuário final
  const allInputs = Array.from(document.querySelectorAll('input')).map(i =>
    `${i.type}|${i.name}|${i.id}|${i.placeholder?.slice(0, 30)}`
  ).join('; ');
  const allBtns = Array.from(document.querySelectorAll('button, input[type="submit"]')).map(b =>
    (b.textContent || b.value || '').trim().slice(0, 40)
  ).join('; ');

  return {
    polo_ativo, polo_passivo, vara, acao, data_ajuizamento,
    _diag: {
      textoLen: texto.length,
      snippet: texto.slice(0, 600),
      tail: texto.slice(-300),
      tabelas: document.querySelectorAll('table').length,
      inputs: allInputs,
      botoes: allBtns,
    },
  };
}

// ─────────────────────────────────────────────
//  COMPLETAR POLOS EM LOTE — 1 browser, páginas sequenciais
// ─────────────────────────────────────────────
export async function completarPolosLote(numeros, onItem) {
  const browser = await abrirBrowser();
  const resultados = [];
  try {
    for (const numero of numeros) {
      try {
        const dados = await consultarComSessao(browser, numero);
        resultados.push({ numero, ok: true, ...dados });
        onItem?.({ numero, ok: true, ...dados });
      } catch (err) {
        resultados.push({ numero, ok: false, erro: err.message });
        onItem?.({ numero, ok: false, erro: err.message });
      }
      // Throttle — evita rate limit do Cloudflare
      await new Promise(r => setTimeout(r, 1_000));
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return resultados;
}
