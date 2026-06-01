import puppeteerExtra     from 'puppeteer-extra';
import StealthPlugin      from 'puppeteer-extra-plugin-stealth';
import { authenticator }  from 'otplib';
import path               from 'path';
import fs                 from 'fs';

puppeteerExtra.use(StealthPlugin());

const TIMEOUT     = 90_000; // 90s — PJe pode ser lento, especialmente em Railway
const AJAX_WAIT   = 3_000;   // tempo para AJAX do RichFaces estabilizar
const DEBUG_SHOTS = process.env.PJE_DEBUG_SCREENSHOTS === 'true';

// Envolve uma promise com timeout explícito — evita que extrações pendurem indefinidamente
function comTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: timeout após ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function browserArgs() {
  return [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--window-size=1280,900',
  ];
}

async function abrirBrowser() {
  return puppeteerExtra.launch({
    headless: true,
    args: browserArgs(),
    executablePath: process.env.CHROMIUM_PATH || undefined,
    defaultViewport: { width: 1280, height: 900 },
    protocolTimeout: 300_000,
  });
}

// Salva screenshot para diagnóstico — ativa com PJE_DEBUG_SCREENSHOTS=true
async function screenshot(page, nome) {
  if (!DEBUG_SHOTS) return;
  try {
    const dir = '/tmp/pje-debug';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, `${Date.now()}-${nome}.png`), fullPage: true });
  } catch { /* ignora erro de screenshot */ }
}

// Aguarda AJAX do RichFaces estabilizar (sem navegação de página)
async function aguardarAjax(page, seletor, timeout = TIMEOUT) {
  await page.waitForSelector(seletor, { timeout });
  // Pausa extra para o RichFaces terminar de atualizar o DOM
  await new Promise(r => setTimeout(r, AJAX_WAIT));
}

// ─────────────────────────────────────────────
//  LOGIN
// ─────────────────────────────────────────────
async function login(url, cpf, senha, totpSecret) {
  const browser = await abrirBrowser();
  const page    = await browser.newPage();
  page.setDefaultTimeout(TIMEOUT);

  try {
    console.log(`[PJe] Acessando login: ${url}`);

    // domcontentloaded evita bug do Puppeteer v22 onde eventos CDP de teclado
    // chegam com text=undefined durante networkidle2, causando "text is not iterable"
    await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(async (err) => {
      if (err.message?.includes('not iterable') || err.message?.includes('Navigation')) {
        console.warn('[PJe] Aviso na navegação (continuando):', err.message);
      } else { throw err; }
    });
    await page.waitForNetworkIdle({ timeout: 10_000, idleTime: 400 }).catch(() => {});
    await screenshot(page, 'login');

    // Aguarda campo CPF/username
    await page.waitForSelector('#username, input[name="username"]', { timeout: TIMEOUT });

    // Usa evaluate + keyboard.type para evitar o bug do LifecycleWatcher no page.type()
    await page.evaluate(() => {
      const el = document.querySelector('#username, input[name="username"]');
      if (el) { el.focus(); el.value = ''; }
    });
    await page.keyboard.type(cpf.replace(/\D/g, ''));
    await screenshot(page, 'pos-cpf');

    // Keycloak TJPB pode usar fluxo em 2 passos: CPF → Avançar → aparece campo senha
    let senhaEl = await page.$('#password, input[name="password"], input[type="password"]');

    if (!senhaEl) {
      // Senha não visível ainda — clica em Avançar
      const btnNext = await page.$('#kc-login, button[type="submit"], input[type="submit"]');
      if (btnNext) {
        await btnNext.click();
        await page.waitForNetworkIdle({ timeout: 10_000, idleTime: 400 }).catch(() => {});
      }
      senhaEl = await page.waitForSelector(
        '#password, input[name="password"], input[type="password"]',
        { timeout: 15_000 }
      ).catch(() => null);
    }

    if (senhaEl) {
      await page.evaluate(() => {
        const el = document.querySelector('#password, input[name="password"], input[type="password"]');
        if (el) { el.focus(); el.value = ''; }
      });
      await page.keyboard.type(senha);
    } else {
      console.warn('[PJe] Campo senha não encontrado — possível SSO automático.');
    }

    const btnSubmit = await page.$('#kc-login, button[type="submit"], input[type="submit"]');
    if (btnSubmit) await btnSubmit.click();
    await page.waitForNetworkIdle({ timeout: 20_000, idleTime: 500 }).catch(() => {});
    await screenshot(page, 'pos-senha');

    // Keycloak OTP — PJe TJPB exige 2FA após a senha
    const textoOtp = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
    const precisaOtp = /autenticação|código|aplicativo/i.test(textoOtp);

    if (precisaOtp && totpSecret) {
      const secret = totpSecret.replace(/\s/g, '');

      // Aguarda nova janela TOTP se restar menos de 5 segundos na atual
      // (evita código expirado antes do submit)
      const remaining = authenticator.timeRemaining();
      if (remaining < 5) {
        console.log(`[PJe] TOTP: aguardando nova janela (${remaining}s restantes)...`);
        await new Promise(r => setTimeout(r, (remaining + 1) * 1000));
      }

      for (let tentativa = 1; tentativa <= 2; tentativa++) {
        const codigo = authenticator.generate(secret);
        console.log(`[PJe] Tela de OTP — tentativa ${tentativa}, código gerado (${authenticator.timeRemaining()}s restantes)`);

        const otpInput = await page.$('input[type="text"], input[id*="otp"], input[name*="otp"]');
        if (otpInput) {
          await page.evaluate(el => { el.focus(); el.value = ''; }, otpInput);
          await page.keyboard.type(codigo);
        }
        const btnOtp = await page.$('[type="submit"]');
        if (btnOtp) await btnOtp.click();
        await page.waitForNetworkIdle({ timeout: 20_000 }).catch(() => {});
        await screenshot(page, `pos-otp-t${tentativa}`);

        // Verifica se ainda está na tela de OTP (código rejeitado)
        const aindaOtp = await page.evaluate(() => /autenticação|código|aplicativo/i.test(document.body?.innerText || '')).catch(() => false);
        if (!aindaOtp) break;

        if (tentativa < 2) {
          // Aguarda próxima janela TOTP completa antes de tentar de novo
          console.log('[PJe] Código OTP rejeitado — aguardando próxima janela TOTP...');
          const rem = authenticator.timeRemaining();
          await new Promise(r => setTimeout(r, (rem + 1) * 1000));
        }
      }
    } else if (precisaOtp && !totpSecret) {
      throw new Error('PJe exige código 2FA mas nenhum totp_secret foi fornecido. Configure a credencial com o TOTP secret do PJe.');
    }

    // Aguarda redirecionar para o painel
    await page.waitForFunction(
      () => !window.location.href.includes('sso.cloud') && !window.location.href.includes('login.seam'),
      { timeout: TIMEOUT }
    ).catch(() => {});
    await page.waitForNetworkIdle({ timeout: 15_000 }).catch(() => {});
    await screenshot(page, 'pos-login');

    const urlAtual = page.url();
    if (urlAtual.includes('login') || urlAtual.includes('sso.cloud')) {
      throw new Error('Login PJe falhou — verifique CPF, senha e código TOTP.');
    }

    console.log(`[PJe] Login OK. Painel: ${urlAtual}`);
    return { browser, page };

  } catch (err) {
    await screenshot(page, 'erro-login');
    await browser.close();
    throw err;
  }
}

// ─────────────────────────────────────────────
//  INSPECIONAR — busca TODOS os processos do advogado
//  Estratégia: Consulta de Processos (lista completa) com paginação
//  Fallback: painel de expedientes (processos com ação pendente)
// ─────────────────────────────────────────────
export async function inspecionarPainel(url, cpf, senha, totpSecret, oab = null) {
  let browser;
  try {
    ({ browser } = await login(url, cpf, senha, totpSecret));
    const page = (await browser.pages()).pop();

    const numerosEncontrados = new Set();
    const CNJ_RE = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/g;
    const PLACEHOLDER = '9999999-99.9999.9.99.9999';
    const base = new URL(url).origin + '/pje';

    async function coletarCNJsDOM() {
      const texto = await page.evaluate(() => document.body.innerText || '').catch(() => '');
      for (const m of texto.matchAll(CNJ_RE)) {
        if (m[0] !== PLACEHOLDER) numerosEncontrados.add(m[0]);
      }
    }

    async function aguardarAJAX(ms = 5000) {
      await page.waitForNetworkIdle({ timeout: ms, idleTime: 400 }).catch(() => {});
      await new Promise(r => setTimeout(r, 800));
    }

    async function paginarResultados(label, limite = 300) {
      let pagina = 1;
      while (pagina <= limite) {
        await coletarCNJsDOM();
        console.log(`[PJe] ${label} pág. ${pagina}: ${numerosEncontrados.size} CNJs acumulados`);

        // Diagnóstico de paginação
        const diagPag = await page.evaluate(() => {
          // Elementos candidatos a controle de paginação
          const candidatos = Array.from(document.querySelectorAll('a, input[type="submit"], button, td, span'))
            .filter(el => {
              const t = (el.textContent || el.title || el.value || el.id || el.className || '').toLowerCase();
              const onclick = (el.getAttribute('onclick') || '').toLowerCase();
              return t.includes('próx') || t.includes('prox') || t.includes('next') ||
                     t.includes('scr') || t.includes('pager') || t.includes('pagina') ||
                     onclick.includes('scr') || onclick.includes('page') ||
                     /^\s*[>»]\s*$/.test(el.textContent || '');
            })
            .map(el => ({
              tag: el.tagName,
              id: el.id || '',
              cls: (el.className || '').slice(0, 80),
              title: el.title || '',
              text: (el.textContent || el.value || '').trim().slice(0, 30),
              onclick: (el.getAttribute('onclick') || '').slice(0, 80),
            }));

          // HTML bruto das tabelas de paginação RichFaces
          const scraHtml = Array.from(document.querySelectorAll(
            '.rich-datascr, table[id*="scr"], table[class*="scr"], ' +
            '[class*="datascr"], [id*="scroller"], [class*="pager"]'
          )).map(el => el.outerHTML.slice(0, 500)).join('\n---\n');

          // Total de registros
          const totalText = Array.from(document.querySelectorAll('span, td, div'))
            .find(el => /\d+\s*(registro|result|processo|total)/i.test(el.textContent?.trim() || ''))
            ?.textContent?.trim().slice(0, 80) || '';

          return { candidatos, scraHtml, totalText };
        }).catch(() => ({ candidatos: [], scraHtml: '', totalText: '' }));

        if (diagPag.totalText) console.log(`[PJe] ${label} total encontrado: "${diagPag.totalText}"`);
        if (diagPag.scraHtml)  console.log(`[PJe] ${label} HTML paginação:\n${diagPag.scraHtml}`);
        if (diagPag.candidatos.length) {
          console.log(`[PJe] ${label} controles candidatos:`,
            diagPag.candidatos.map(c => `${c.tag}#${c.id} cls="${c.cls}" text="${c.text}" onclick="${c.onclick}"`).join('\n  '));
        } else {
          console.log(`[PJe] ${label} pág.${pagina}: zero controles de paginação na página`);
        }

        // RichFaces datascroller: <td onclick="Event.fire(this, 'rich:datascroller:onscroll', {'page': 'next'})">
        const clicouNext = await page.evaluate(() => {
          const tds = Array.from(document.querySelectorAll('td[onclick*="datascroller:onscroll"]'));
          const nextTd = tds.find(td => {
            const onclick = td.getAttribute('onclick') || '';
            const cls = td.className || '';
            return onclick.includes("'page': 'next'") && !cls.includes('dsbld');
          });
          if (nextTd) { nextTd.click(); return true; }
          return false;
        }).catch(() => false);

        if (!clicouNext) {
          console.log(`[PJe] ${label} pág.${pagina}: última página (botão next ausente ou desabilitado)`);
          break;
        }

        console.log(`[PJe] ${label} avançando para pág. ${pagina + 1}`);
        await aguardarAJAX(6000);
        pagina++;
      }
    }

    // ── FASE 0: Consulta por OAB (lista TODOS os processos do advogado) ──
    // Esta é a abordagem principal. Requer que a credencial tenha o campo oab preenchido.
    // ex: oab = '23395PB' ou '23395' (estado assumido como PB neste caso)
    if (oab) {
      const numeroOab = oab.replace(/\D/g, '');       // só dígitos
      const estadoOab = oab.replace(/\d/g, '').trim() || 'PB';  // letras = estado

      const urlConsultaOab = `${base}/Processo/ConsultaProcesso/listView.seam`;
      console.log(`[PJe] Abrindo consulta por OAB: ${urlConsultaOab}`);
      await page.goto(urlConsultaOab, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await aguardarAJAX(8000);
      await screenshot(page, 'consulta-oab');

      // Seletores amplos para o campo OAB — cobre diferentes versões do PJe
      const campoOab = await page.$(
        'input[id*="nroOab"], input[id*="Oab"], input[id*="OAB"], input[id*="oab"], ' +
        'input[name*="nroOab"], input[name*="Oab"], input[name*="OAB"], ' +
        'input[id*="advogado"][id*="numero"], input[id*="numAdvogado"], ' +
        'input[placeholder*="OAB"], input[placeholder*="oab"]'
      );

      if (campoOab) {
        const campoId = await campoOab.evaluate(el => el.id);
        console.log(`[PJe] Campo OAB encontrado: #${campoId}`);
        await page.evaluate(el => { el.focus(); el.value = ''; }, campoOab);
        await page.keyboard.type(numeroOab);
        await screenshot(page, 'oab-preenchido');

        // Campo UF/estado da OAB
        const campoEstado = await page.$(
          'select[id*="estadoOab"], select[id*="ufOab"], select[id*="orgaoOab"], ' +
          'select[id*="Oab"][id*="estado"], select[id*="Oab"][id*="uf"], ' +
          'select[name*="estadoOab"], select[name*="ufOab"], ' +
          'select[id*="advogado"][id*="estado"], input[id*="estadoOab"]'
        );
        if (campoEstado) {
          const tagName = await campoEstado.evaluate(el => el.tagName);
          const campoEstadoId = await campoEstado.evaluate(el => el.id);
          console.log(`[PJe] Campo estado OAB: ${tagName}#${campoEstadoId}`);
          if (tagName === 'SELECT') {
            await campoEstado.select(estadoOab).catch(async () => {
              // Tenta por value numérico se texto não funcionar
              await page.evaluate((el, uf) => {
                const opt = Array.from(el.options).find(o => o.text.includes(uf) || o.value === uf);
                if (opt) el.value = opt.value;
              }, campoEstado, estadoOab);
            });
          } else {
            await page.evaluate(el => { el.focus(); el.value = ''; }, campoEstado);
            await page.keyboard.type(estadoOab);
          }
        }

        // Botão Pesquisar — seletores amplos (inclui fPP:searchProcessos do TJPB)
        const btnPesquisar = await page.$(
          'input[id*="btnPesquisar"], input[id*="pesquisar"], ' +
          'input[id*="search"], button[id*="search"], a[id*="search"], ' +
          'input[value="Pesquisar"], input[value="Buscar"], ' +
          'button[id*="pesquisar"], button[id*="Pesquisar"], ' +
          'a[id*="pesquisar"], a[id*="Pesquisar"]'
        );
        if (btnPesquisar) {
          const btnId = await btnPesquisar.evaluate(el => el.id || el.tagName);
          console.log(`[PJe] Clicando Pesquisar: ${btnId}`);
          await btnPesquisar.click();
          await aguardarAJAX(12000);
          await screenshot(page, 'resultado-oab');
          await paginarResultados('OAB');
          console.log(`[PJe] Consulta OAB concluída: ${numerosEncontrados.size} processos`);
        } else {
          console.warn('[PJe] Botão Pesquisar não encontrado após preencher OAB');
        }
      } else {
        console.warn('[PJe] Campo OAB não encontrado com nenhum seletor — veja log de elementos acima');
      }
    }

    // ── FASE 1: Consulta de Processos sem filtro (complementa busca por OAB) ──
    if (numerosEncontrados.size === 0) {
      const urlConsulta = `${base}/ConsultaProcesso/listView.seam`;
      console.log(`[PJe] Consulta geral sem filtro: ${urlConsulta}`);
      await page.goto(urlConsulta, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await aguardarAJAX(8000);
      await screenshot(page, 'consulta-processos');

      const btnPesquisar = await page.$(
        'input[id*="btnPesquisar"], input[id*="pesquisar"], ' +
        'input[value="Pesquisar"], input[value="Buscar"], ' +
        'button[id*="pesquisar"], button[id*="Pesquisar"], ' +
        'a[id*="pesquisar"], a[id*="Pesquisar"], ' +
        'input[type="submit"], button[type="submit"]'
      );

      if (btnPesquisar) {
        const btnId = await btnPesquisar.evaluate(el => el.id || el.tagName);
        console.log(`[PJe] Clicando Pesquisar (geral): ${btnId}`);
        await btnPesquisar.click();
        await aguardarAJAX(10000);
        await screenshot(page, 'resultado-consulta');
        await paginarResultados('Consulta');
        console.log(`[PJe] Consulta geral concluída: ${numerosEncontrados.size} processos`);
      } else {
        console.warn('[PJe] Botão Pesquisar não encontrado — usando painel como fallback');
      }
    }

    // ── FASE 2 (fallback/complemento): Painel de expedientes ──
    // Captura processos com ação pendente que possam não ter aparecido na consulta
    const urlPainel = `${base}/Painel/painel_usuario/advogado.seam`;
    await page.goto(urlPainel, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await aguardarAJAX(8000);
    await coletarCNJsDOM();

    for (let grupoIdx = 0; grupoIdx <= 6; grupoIdx++) {
      const btnId = `formAbaExpediente:listaAgrSitExp:${grupoIdx}:j_id162`;
      const btnEl = await page.$(`[id="${btnId}"]`);
      if (!btnEl) continue;

      const titulo = await page.$eval(`[id="${btnId}"]`, el => el.title || '').catch(() => '');
      if (!titulo.includes('fechar')) {
        await page.click(`[id="${btnId}"]`);
        await aguardarAJAX(6000);
        await coletarCNJsDOM();
      }

      const forumSel = `[id*="listaAgrSitExp:${grupoIdx}:trPend:"][id$="::jNp"]`;
      const forumsEls = await page.$$(forumSel);
      if (forumsEls.length === 0) continue;

      const forumIds = await Promise.all(forumsEls.map(el => el.evaluate(e => e.id)));
      const forumNums = forumIds.map(id => id.match(/:trPend:(\d+)::/)?.[1]).filter(Boolean);
      console.log(`[PJe] Painel Grupo ${grupoIdx}: ${forumNums.length} fórum(ns)`);

      for (const forumNum of forumNums) {
        const handleId   = `formAbaExpediente:listaAgrSitExp:${grupoIdx}:trPend:${forumNum}::j_id166:handle`;
        const expandedId = `formAbaExpediente:listaAgrSitExp:${grupoIdx}:trPend:${forumNum}::j_id166NodeExpanded`;
        const expandedVal = await page.$eval(`[id="${expandedId}"]`, el => el.value).catch(() => 'false');
        if (expandedVal !== 'true') {
          const handleEl = await page.$(`[id="${handleId}"]`);
          if (handleEl) { await page.click(`[id="${handleId}"]`); await aguardarAJAX(5000); }
        }

        const cxSel = `[id*="listaAgrSitExp:${grupoIdx}:trPend:${forumNum}:"][id$="::j_id170:cxExItem"]`;
        const cxEls = await page.$$(cxSel);
        for (const cxEl of cxEls) {
          const cxId = await cxEl.evaluate(e => e.id);
          await page.click(`[id="${cxId}"]`).catch(() => {});
          await aguardarAJAX(5000);
          await coletarCNJsDOM();
        }
      }
    }

    await coletarCNJsDOM();

    const numeros = [...numerosEncontrados];
    console.log(`[PJe] Total de processos encontrados: ${numeros.length}`);
    return numeros;

  } finally {
    await browser?.close();
  }
}

// ─────────────────────────────────────────────
//  CLICAR NO LINK E ENTRAR NO PROCESSO
//  O PJe frequentemente abre o detalhe em nova aba (popup/window).
//  Detecta a nova aba e a retorna. Se o detalhe abrir na mesma aba,
//  valida que a tela de busca (processosTable) sumiu.
// ─────────────────────────────────────────────
async function clicarEEntrarNoProcesso(page, linkEl, numero) {
  const browser = page.browser();

  // Escuta nova aba ANTES de clicar
  let resolverNovaAba;
  const promessaNovaAba = new Promise(resolve => { resolverNovaAba = resolve; });
  const onTarget = async (target) => {
    if (target.type() === 'page') resolverNovaAba(target);
  };
  browser.once('targetcreated', onTarget);

  await linkEl.click();

  // Aguarda: nova aba (5s) ou timeout (mesmo aba)
  const novoTarget = await Promise.race([
    promessaNovaAba,
    new Promise(resolve => setTimeout(() => resolve(null), 5_000)),
  ]);
  browser.off('targetcreated', onTarget);

  if (novoTarget) {
    // Processo abriu em nova aba
    const novaAba = await novoTarget.page();
    novaAba.setDefaultTimeout(TIMEOUT);
    await novaAba.bringToFront();
    await novaAba.waitForNetworkIdle({ timeout: 20_000 }).catch(() => {});
    await new Promise(r => setTimeout(r, AJAX_WAIT));
    console.log(`[PJe] Processo ${numero} aberto em nova aba: ${novaAba.url()}`);
    return novaAba;
  }

  // Mesma aba — aguarda navegação e valida
  await page.waitForNetworkIdle({ timeout: TIMEOUT }).catch(() => {});
  await new Promise(r => setTimeout(r, AJAX_WAIT));

  // Rejeita se ainda estiver na tela de busca (processosTable visível = não entrou no detalhe)
  const aindaNaBusca = await page.$('#fPP\\:processosTable, [id*="processosTable"]').catch(() => null);
  if (aindaNaBusca) {
    // Tenta encontrar aba do processo já aberta em segundo plano
    const todasAbas = await browser.pages();
    for (const aba of todasAbas) {
      if (aba === page) continue;
      const url = aba.url();
      if (url.includes('pje') && !url.includes('ConsultaProcesso') && !url.includes('login')) {
        aba.setDefaultTimeout(TIMEOUT);
        await aba.bringToFront();
        await aba.waitForNetworkIdle({ timeout: 15_000 }).catch(() => {});
        console.log(`[PJe] Encontrou aba do processo em segundo plano: ${url}`);
        return aba;
      }
    }
    throw new Error(`Processo ${numero}: clicou no link mas tela de detalhe não abriu (processosTable ainda presente)`);
  }

  return page;
}

// ─────────────────────────────────────────────
//  BUSCAR PROCESSO — pesquisa por número CNJ
//  Retorna a página onde o detalhe foi aberto
//  (pode ser uma nova aba — o chamador deve fechar se necessário)
// ─────────────────────────────────────────────
async function navegarParaProcesso(page, base, numero) {
  console.log(`[PJe] Buscando processo v2: ${numero}`);

  // Abordagem 1: ConsultaProcesso preenchendo cada campo CNJ separadamente
  // Formato CNJ: 0862224-55.2023.8.15.2001
  //              seq(7)-dig(2).ano(4).jus(1).trib(2).orig(4)
  try {
    const cnj = numero.match(/^(\d{7})-(\d{2})\.(\d{4})\.(\d)\.(\d{2})\.(\d{4})$/);
    if (!cnj) throw new Error(`Número fora do formato CNJ: ${numero}`);
    const [, seq, dig, ano, jus, trib, orig] = cnj;

    const urlConsulta = `${base}/Processo/ConsultaProcesso/listView.seam`;
    await page.goto(urlConsulta, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await new Promise(r => setTimeout(r, AJAX_WAIT));

    // Preenche cada segmento do número CNJ no campo correspondente
    const segmentos = [
      { sel: '[id$=":numeroSequencial"], [id*="numeroSequencial"]', val: seq },
      { sel: '[id$=":digitoVerificador"], [id*="digitoVerificador"]', val: dig },
      { sel: '[id$=":anoOrigen"], [id*="anoOrigen"]', val: ano },
      { sel: '[id$=":justica"], [id*="justica"]:not(select)', val: jus },
      { sel: '[id$=":tribunal"], [id*="tribunal"]:not(select)', val: trib },
      { sel: '[id$=":origem"], [id*="origem"]', val: orig },
    ];

    let preenchidos = 0;
    for (const { sel, val } of segmentos) {
      const el = await page.$(sel).catch(() => null);
      if (!el) continue;
      await page.evaluate((e, v) => { e.focus(); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }, el, val);
      preenchidos++;
    }
    console.log(`[PJe] Campos CNJ preenchidos: ${preenchidos}/6 — ${seq}-${dig}.${ano}.${jus}.${trib}.${orig}`);

    // Selects de justiça/tribunal (dropdowns)
    for (const selId of ['[id*="justica"]', '[id*="tribunal"]']) {
      const sel = await page.$(`select${selId}`).catch(() => null);
      if (!sel) continue;
      const val = selId.includes('justica') ? jus : trib;
      await sel.select(val).catch(() =>
        page.evaluate((e, v) => {
          const opt = Array.from(e.options).find(o => o.value === v || o.value === v.padStart(2, '0'));
          if (opt) { e.value = opt.value; e.dispatchEvent(new Event('change', { bubbles: true })); }
        }, sel, val)
      );
    }

    const btnPesquisar = await page.$(
      'input[id*="btnPesquisar"], input[id*="pesquisar"], input[id*="search"], ' +
      'input[value="Pesquisar"], input[value="Buscar"], ' +
      'button[id*="pesquisar"], a[id*="pesquisar"], a[id*="search"]'
    );
    if (btnPesquisar) {
      await btnPesquisar.click();
    } else {
      const primeiroInput = await page.$('[id*="numeroSequencial"]');
      if (primeiroInput) await primeiroInput.press('Enter');
    }
    await new Promise(r => setTimeout(r, AJAX_WAIT + 2000));

    // Link do resultado — ID específico do TJPB primeiro, depois genérico
    const linkProcesso = await page.$(
      `#fPP\\:processosTable td a, ` +
      `table[id*="processosTable"] td a, ` +
      `a[href*="${seq}"], ` +
      `td.rich-list-item a, ` +
      `td a[id*="processo"]`
    );
    if (linkProcesso) {
      const procPage = await clicarEEntrarNoProcesso(page, linkProcesso, numero);
      console.log(`[PJe] Processo ${numero} aberto via ConsultaProcesso`);
      return procPage;
    }

    // Diagnóstico se não encontrou link
    const diagResult = await page.evaluate((s) => {
      const links = Array.from(document.querySelectorAll('td a, table a')).slice(0, 10)
        .map(a => `${a.id || '?'} href="${(a.href || '').slice(-60)}" txt="${(a.textContent || '').trim().slice(0, 40)}"`);
      const rows = Array.from(document.querySelectorAll('tr')).length;
      return { links, rows };
    }, seq).catch(() => ({ links: [], rows: 0 }));
    console.warn(`[PJe] Sem resultado (${diagResult.rows} linhas na pág). Links:\n  ` + (diagResult.links.join('\n  ') || '(nenhum)'));

  } catch (err) {
    console.warn(`[PJe] ConsultaProcesso falhou: ${err.message}`);
  }

  // Abordagem 2: painel autocomplete com Enter
  try {
    const urlPainel = `${base}/Painel/painel_usuario/advogado.seam`;
    if (!page.url().includes('Painel')) {
      await page.goto(urlPainel, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await new Promise(r => setTimeout(r, AJAX_WAIT));
    }

    const campoBusca = await page.$('#txtConsultaContextoExpedientes');
    if (campoBusca) {
      await campoBusca.click({ clickCount: 3 });
      await campoBusca.type(numero);
      await new Promise(r => setTimeout(r, 1500));

      // Tenta autocomplete JS
      await page.evaluate((num) => {
        if (typeof setarTextoConsultaContextoExpedientes === 'function') {
          setarTextoConsultaContextoExpedientes(num);
        }
      }, numero);
      await new Promise(r => setTimeout(r, 2000));

      const linkProcesso = await page.$(
        `a[id*="cxExItem"], a[href*="${numero.replace(/\D/g, '')}"]`
      );
      if (linkProcesso) {
        const procPage = await clicarEEntrarNoProcesso(page, linkProcesso, numero);
        console.log(`[PJe] Processo ${numero} aberto via painel autocomplete`);
        return procPage;
      }

      // Fallback: pressiona Enter para submeter busca
      await campoBusca.press('Enter');
      await new Promise(r => setTimeout(r, AJAX_WAIT + 1000));
      const linkAposEnter = await page.$(
        `a[id*="cxExItem"], a[href*="${numero.replace(/\D/g, '')}"], td a[id*="processo"]`
      );
      if (linkAposEnter) {
        const procPage = await clicarEEntrarNoProcesso(page, linkAposEnter, numero);
        console.log(`[PJe] Processo ${numero} aberto via painel Enter`);
        return procPage;
      }
    }
  } catch (err) {
    console.warn(`[PJe] Painel autocomplete falhou: ${err.message}`);
  }

  throw new Error(`[PJe] Não foi possível navegar para o processo ${numero}`);
}

// ─────────────────────────────────────────────
//  EXTRAIR MOVIMENTAÇÕES — com paginação
// ─────────────────────────────────────────────
//  EXTRAIR EXPEDIENTES — citações, intimações e mandados com prazo
// ─────────────────────────────────────────────
async function extrairExpedientes(page) {
  const abaExp = await page.$(
    'a[id*="expediente"], a[href*="expediente"], ' +
    'li a::-p-text("Expedientes"), li a::-p-text("Expediente"), ' +
    'a[title*="Expediente"], a[title*="Comunicação"]'
  );
  if (!abaExp) return [];

  await abaExp.click();
  await new Promise(r => setTimeout(r, AJAX_WAIT));
  await screenshot(page, 'aba-expedientes');

  const linhas = await page.$$eval(
    'table[id*="expediente"] tr, table[id*="Expediente"] tr, ' +
    'table[id*="comunicacao"] tr, #tabelaExpedientes tr, ' +
    '.tabela-expedientes tr, table[id*="ato"] tr',
    rows => rows.slice(1).map(tr => {
      const cols = Array.from(tr.querySelectorAll('td'));
      if (cols.length < 2) return null;

      // cols[0] = data de abertura
      // cols[1] = tipo/descrição — pode conter prazo final embutido: "07/04/2026 23:59:59 (para manifestação)"
      // cols[2] = botões de ação da UI (VISUALIZAR ATO, VALIDAR ASSINATURA DIGITAL) — ignorar como dado jurídico
      // cols[3] = coluna booleana "SIM/NÃO" (tem prazo?) — não é número de dias
      // cols[4] = vencimento (alternativa ao embutido no cols[1])
      const dataAbertura = cols[0]?.innerText?.trim() || '';
      const tipoRaw      = cols[1]?.innerText?.trim() || '';
      const vencimentoRaw = cols[4]?.innerText?.trim() || '';

      if (!tipoRaw || tipoRaw.length < 4) return null;

      // Extrai prazo final do texto de cols[1] — formato: "DD/MM/AAAA HH:MM:SS (descrição)"
      const dtMatch = tipoRaw.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}(?::\d{2})?)/);
      const prazoFinalTexto = dtMatch
        ? `${dtMatch[1]} às ${dtMatch[2].slice(0, 5)}`
        : (vencimentoRaw || null);

      // Descrição limpa: remove a data/hora inicial se presente
      const descricao = tipoRaw
        .replace(/^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}(?::\d{2})?\s*/, '')
        .replace(/^\(/, '').replace(/\)$/, '')
        .trim() || tipoRaw;

      const partes = [`[EXPEDIENTE] ${descricao}`];
      if (prazoFinalTexto) partes.push(`Prazo final: ${prazoFinalTexto}`);

      return { data: dataAbertura, tipo: 'expediente', texto: partes.join(' | ') };
    }).filter(Boolean)
  ).catch(() => []);

  console.log(`[PJe] Expedientes encontrados: ${linhas.length}`);
  return linhas;
}

// ─────────────────────────────────────────────
async function extrairMovimentacoes(page) {
  const movimentacoes = [];

  // TJPB PJe não tem aba "Movimentações" — movimentações vêm do DataJud.
  // Tenta ler tabelas já presentes na página; retorna vazio se não encontrar.
  await screenshot(page, 'aba-movimentacoes');

  // Log diagnóstico: tabelas visíveis após clicar na aba
  const diagTabelas = await page.evaluate(() => {
    const ts = Array.from(document.querySelectorAll('table[id]'));
    return ts.map(t => `${t.id}(${t.querySelectorAll('tr').length}tr)`).join(', ');
  }).catch(() => '');
  console.log(`[PJe] Tabelas após aba movimentações: ${diagTabelas.slice(0, 600) || '(nenhuma com id)'}`);

  // Seletores em ordem de especificidade — tenta cada um até encontrar linhas
  const SELETORES_TABELA = [
    'table[id*="evento"] tr',
    'table[id*="movimentac"] tr',
    'table[id*="Eventos"] tr',
    'table[id*="timeline"] tr',
    'table[id*="historic"] tr',
    'table[id*="listaEvento"] tr',
    'table[id*="listaMovimento"] tr',
    'table[id*="listaAndamento"] tr',
    '#tabelaEventos tr',
    '#tabelaMovimentacoes tr',
    '.tabela-movimentacoes tr',
    // Fallback amplo: qualquer tabela com 3+ colunas que contenha data no 1º td
    'table tr',
  ];

  const CNJ_RE  = /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/;
  const NUM_RE  = /^[\d\s\-\/\.\:,;()]+$/;
  const DATA_RE = /^\d{2}\/\d{2}\/\d{4}/;

  let pagina = 1;
  while (true) {
    // Tenta cada seletor; usa o primeiro que retorna linhas com texto válido
    let linhas = [];
    for (const sel of SELETORES_TABELA) {
      const candidatas = await page.evaluate((s) => {
        const rows = Array.from(document.querySelectorAll(s)).slice(1, 201); // pula header, max 200 linhas
        return rows.map(tr => {
          const cols = Array.from(tr.querySelectorAll('td'));
          if (cols.length < 2) return null;
          const texto = cols[2]?.innerText?.trim() || cols[1]?.innerText?.trim() || '';
          return {
            data:  cols[0]?.innerText?.trim() || '',
            tipo:  cols[1]?.innerText?.trim() || '',
            texto,
            ncols: cols.length,
          };
        }).filter(Boolean);
      }, sel).catch(() => []);

      // Aplica filtros de qualidade
      const validas = candidatas.filter(m => {
        if (!m.texto || m.texto.length < 10) return false;
        if (CNJ_RE.test(m.texto)) return false;
        if (NUM_RE.test(m.texto)) return false;
        return true;
      });

      // Só usa se encontrou movimentações com texto real
      // No fallback 'table tr', exige que a 1ª coluna pareça uma data
      if (sel === 'table tr') {
        const comData = validas.filter(m => DATA_RE.test(m.data));
        if (comData.length > 0) { linhas = comData; break; }
      } else if (validas.length > 0) {
        linhas = validas;
        break;
      }
    }

    movimentacoes.push(...linhas);
    console.log(`[PJe] Movimentações página ${pagina}: ${linhas.length} registros`);

    const proxPagina = await page.$(
      'a[id*="proxima"], a[title*="Próxima página"], ' +
      '.rich-datascr-button-next:not([disabled]), a[title="next page"]'
    );
    if (!proxPagina) break;

    const desabilitado = await proxPagina.evaluate(
      el => el.disabled || el.getAttribute('aria-disabled') === 'true' ||
            el.classList.contains('rich-datascr-button-next-dis')
    ).catch(() => true);
    if (desabilitado) break;

    await proxPagina.click();
    await new Promise(r => setTimeout(r, AJAX_WAIT));
    pagina++;
    if (pagina > 20) break;
  }

  return movimentacoes;
}

// ─────────────────────────────────────────────
//  EXTRAIR DADOS + HABILITADOS
//  TJPB PJe usa Bootstrap tabs: #maisDetalhes, #poloAtivo, #poloPassivo.
//  O conteúdo já está no DOM — clica no toggle ▼ para garantir carregamento
//  e lê diretamente dos IDs corretos.
// ─────────────────────────────────────────────
async function extrairDados(page) {
  // O toggle ▼ (Bootstrap dropdown) carrega #poloAtivo/#poloPassivo/#maisDetalhes via AJAX.
  // Usa waitForSelector para esperar o toggle aparecer no DOM antes de clicar.
  await screenshot(page, 'pre-toggle');
  try {
    const toggle = await page.waitForSelector(
      'a.titulo-topo.dropdown-toggle, a[class*="titulo-topo"][data-toggle="dropdown"]',
      { timeout: 15_000 }
    );
    await toggle.click();
    console.log('[PJe] Toggle ▼ clicado — aguardando #poloAtivo no DOM');
    // Aguarda AJAX injetar o conteúdo das abas
    await page.waitForSelector('#poloAtivo, #maisDetalhes', { timeout: 12_000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 800));
  } catch {
    // Diagnóstico: mostra snippet do body para entender o que carregou
    const bodySnip = await page.evaluate(() =>
      (document.body?.innerText || '').slice(0, 600)
    ).catch(() => '');
    console.log('[PJe] Toggle ▼ não encontrado após 15s. Body snippet:', bodySnip);
  }
  await screenshot(page, 'pos-toggle');

  const dados = await page.evaluate(() => {
    const limparNome = (txt) =>
      (txt || '').replace(/\s*[-–]\s*(CPF|CNPJ)[:\s].*$/i, '').trim() || null;

    // ── Estratégia 1: ler das abas #poloAtivo / #poloPassivo (disponível após clique no toggle) ──
    let polo_ativo  = limparNome(document.querySelector('#poloAtivo tbody td > span > span')?.textContent);
    let polo_passivo = limparNome(document.querySelector('#poloPassivo tbody td > span > span')?.textContent);

    // ── Estratégia 2: ler do subtítulo do navbar "NOME X OUTRA_PARTE" (sempre visível) ──
    if (!polo_ativo || !polo_passivo) {
      const navEl = document.querySelector('a.titulo-topo.dropdown-toggle, a[class*="titulo-topo"]')
        ?.closest('.navbar, nav, header, .navbar-header, .navbar-collapse');
      const navText = navEl?.innerText || document.querySelector('.navbar, nav')?.innerText || '';
      // Procura linha "NOME A X NOME B" — letras maiúsculas separadas por " X "
      const match = navText.match(/^([A-ZÁÀÂÃÉÈÊÍÏÓÔÕÖÚÜÇ][^\n]+?)\s+X\s+([A-ZÁÀÂÃÉÈÊÍÏÓÔÕÖÚÜÇ][^\n]+)$/m);
      if (match) {
        if (!polo_ativo)  polo_ativo  = match[1].trim();
        if (!polo_passivo) polo_passivo = match[2].trim();
      }
    }

    // ── Habilitados (OAB) das árvores dos polos ──
    const oabSet = new Set();
    document.querySelectorAll('#poloAtivo .tree span > span, #poloPassivo .tree span > span').forEach(el => {
      const txt = el.textContent?.trim() || '';
      const m = txt.match(/OAB\s+([A-Z]{2})\s*(\d+)/i);
      if (m) oabSet.add(`${m[1]}${m[2]}`);
    });

    // ── Campos de detalhe: busca por rótulo em #maisDetalhes OU no navbar ──
    let vara = null, acao = null, juiz = null, data_ajuizamento = null;
    const fonteDetalhes = document.querySelector('#maisDetalhes')
      || document.querySelector('.navbar, nav, header');
    if (fonteDetalhes) {
      const nos = Array.from(fonteDetalhes.querySelectorAll('td, dt, li, p'));
      for (let i = 0; i < nos.length - 1; i++) {
        const label = nos[i].textContent?.trim().replace(/:$/, '') || '';
        const valor = nos[i + 1]?.textContent?.trim();
        if (!valor || valor.length < 2) continue;
        if (!vara             && /órgão julgador|vara/i.test(label))     vara             = valor;
        if (!acao             && /classe|tipo de ação/i.test(label))      acao             = valor;
        if (!juiz             && /magistrado|juiz|juíza/i.test(label))    juiz             = valor;
        if (!data_ajuizamento && /autuação|ajuizamento/i.test(label))     data_ajuizamento = valor;
      }
    }

    const diag = {
      temPoloAtivo:   !!document.querySelector('#poloAtivo'),
      temPoloPassivo: !!document.querySelector('#poloPassivo'),
      temDetalhes:    !!document.querySelector('#maisDetalhes'),
    };

    return { polo_ativo, polo_passivo, vara, acao, juiz, data_ajuizamento, habilitados: [...oabSet], _diag: diag };
  }).catch(err => ({
    polo_ativo: null, polo_passivo: null, vara: null, acao: null,
    juiz: null, data_ajuizamento: null, habilitados: [], _diag: { err: err.message },
  }));

  console.log(`[PJe] extrairDados: polo_ativo="${dados.polo_ativo}", polo_passivo="${dados.polo_passivo}", data_ajuizamento="${dados.data_ajuizamento}", vara="${dados.vara}"`);
  console.log('[PJe] extrairDados DOM:', JSON.stringify(dados._diag));
  const { _diag, ...resultado } = dados;
  return resultado;
}

// ─────────────────────────────────────────────
//  EXPORTAÇÕES PÚBLICAS
// ─────────────────────────────────────────────

// Busca movimentações de um processo específico
export async function buscarMovimentacoes(url, cpf, senha, totpSecret, numeroProcesso) {
  let browser;
  try {
    ({ browser } = await login(url, cpf, senha, totpSecret));
    const page = (await browser.pages()).pop();
    const base = new URL(url).origin + new URL(url).pathname.replace('/login.seam', '');

    const procPage = await navegarParaProcesso(page, base, numeroProcesso);
    return await extrairMovimentacoes(procPage);

  } finally {
    await browser?.close();
  }
}

// Busca dados básicos + habilitados de um processo específico
export async function buscarDadosProcesso(url, cpf, senha, totpSecret, numeroProcesso) {
  let browser;
  try {
    ({ browser } = await login(url, cpf, senha, totpSecret));
    const page = (await browser.pages()).pop();
    const base = new URL(url).origin + new URL(url).pathname.replace('/login.seam', '');

    const procPage = await navegarParaProcesso(page, base, numeroProcesso);
    return await extrairDados(procPage);

  } finally {
    await browser?.close();
  }
}

// Busca movimentações + dados em uma única sessão (mais eficiente)
export async function buscarProcessoCompleto(url, cpf, senha, totpSecret, numeroProcesso) {
  let browser;
  try {
    ({ browser } = await login(url, cpf, senha, totpSecret));
    const page = (await browser.pages()).pop();
    const base = new URL(url).origin + new URL(url).pathname.replace('/login.seam', '');

    // procPage pode ser uma nova aba — browser.close() fecha tudo de qualquer forma
    const procPage = await navegarParaProcesso(page, base, numeroProcesso);

    // Expande seções colapsadas (botão ▼ acima do número do processo no TJPB)
    await expandirSecoesColapsadas(procPage).catch(() => {});

    let dados = {};
    let movimentacoes = [];
    let expedientes = [];
    try { dados = await comTimeout(extrairDados(procPage), 60_000, 'extrairDados'); } catch (e) { console.warn('[PJe] extrairDados falhou:', e.message); }
    try { movimentacoes = await comTimeout(extrairMovimentacoes(procPage), 90_000, 'extrairMovimentacoes'); } catch (e) { console.warn('[PJe] extrairMovimentacoes falhou:', e.message); }
    try { expedientes = await comTimeout(extrairExpedientes(procPage), 30_000, 'extrairExpedientes'); } catch (e) { console.warn('[PJe] extrairExpedientes falhou:', e.message); }

    return {
      dados,
      movimentacoes: [...movimentacoes, ...expedientes],
    };

  } finally {
    await browser?.close();
  }
}

// ─────────────────────────────────────────────
//  SESSÃO COMPARTILHADA — para sync em lote
//  Abre o browser UMA VEZ e reutiliza entre processos.
//  Cada processo abre uma aba nova, extrai os dados e fecha a aba.
//  O browser só é fechado pelo chamador (sincronizarTodos).
// ─────────────────────────────────────────────

// Abre browser e faz login — retorna {browser, page} para reutilização
export async function abrirSessao(url, cpf, senha, totpSecret) {
  return login(url, cpf, senha, totpSecret);
}

// No-op mantido para compatibilidade — TJPB PJe usa Bootstrap tabs (não RichFaces).
// O clique no toggle ▼ é feito diretamente dentro de extrairDados.
async function expandirSecoesColapsadas(_page) {
  // intencionalmente vazio
}

// Busca dados de um processo usando sessão existente (sem abrir novo browser)
export async function buscarProcessoCompletoComSessao(browser, url, numero) {
  const page = await browser.newPage();
  page.setDefaultTimeout(TIMEOUT);
  let procPage = page;
  try {
    const base = new URL(url).origin + new URL(url).pathname.replace('/login.seam', '');

    // procPage pode ser página diferente de page se o PJe abriu o detalhe em nova aba
    procPage = await navegarParaProcesso(page, base, numero);

    // Expande seções colapsadas (botão ▼ acima do número do processo no TJPB)
    await expandirSecoesColapsadas(procPage).catch(() => {});

    // Sequencial: extrairDados e extrairMovimentacoes clicam em abas diferentes
    // — rodar em paralelo no mesmo page causa conflito e perde os dados
    let dados = {};
    let movimentacoes = [];
    let expedientes = [];
    try { dados = await comTimeout(extrairDados(procPage), 60_000, 'extrairDados'); } catch (e) { console.warn('[PJe] extrairDados falhou:', e.message); }
    try { movimentacoes = await comTimeout(extrairMovimentacoes(procPage), 90_000, 'extrairMovimentacoes'); } catch (e) { console.warn('[PJe] extrairMovimentacoes falhou:', e.message); }
    try { expedientes = await comTimeout(extrairExpedientes(procPage), 30_000, 'extrairExpedientes'); } catch (e) { console.warn('[PJe] extrairExpedientes falhou:', e.message); }

    return { dados, movimentacoes: [...movimentacoes, ...expedientes] };
  } finally {
    // Fecha aba extra (nova aba do processo) se diferente da aba de navegação
    if (procPage !== page) await procPage.close().catch(() => {});
    await page.close().catch(() => {});
  }
}
