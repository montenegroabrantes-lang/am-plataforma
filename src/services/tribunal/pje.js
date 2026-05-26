import puppeteer          from 'puppeteer';
import { authenticator }  from 'otplib';
import path               from 'path';
import fs                 from 'fs';

const TIMEOUT     = 45_000;
const AJAX_WAIT   = 3_000;   // tempo para AJAX do RichFaces estabilizar
const DEBUG_SHOTS = process.env.PJE_DEBUG_SCREENSHOTS === 'true';

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
  return puppeteer.launch({
    headless: 'new',
    args: browserArgs(),
    executablePath: process.env.CHROMIUM_PATH || undefined,
    defaultViewport: { width: 1280, height: 900 },
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

        // Diagnóstico de paginação em todas as páginas para ajudar depuração
        const diagPag = await page.evaluate(() => {
          // Todos os elementos com texto/id/class relacionado a navegação de páginas
          const candidatos = Array.from(document.querySelectorAll('a, input[type="submit"], button, span'))
            .filter(el => {
              const t = (el.textContent || el.title || el.value || el.id || el.className || '').toLowerCase();
              return t.includes('próx') || t.includes('prox') || t.includes('next') ||
                     t.includes('scroller') || t.includes('scr') || t.includes('pager') ||
                     t.includes('pagina') || t.includes('page') ||
                     /^\s*[>»]\s*$/.test(el.textContent || '');
            })
            .map(el => ({
              tag: el.tagName,
              id: el.id || '',
              cls: (el.className || '').slice(0, 60),
              title: el.title || '',
              text: (el.textContent || el.value || '').trim().slice(0, 20),
              onclick: (el.getAttribute('onclick') || '').slice(0, 60),
              href: (el.getAttribute('href') || '').slice(0, 60),
            }));

          // Total de registros (para calcular páginas esperadas)
          const totalText = Array.from(document.querySelectorAll('span, td, div'))
            .find(el => /\d+\s*(registro|result|processo)/i.test(el.textContent))?.textContent?.trim().slice(0,60) || '';

          return { candidatos, totalText };
        }).catch(() => ({ candidatos: [], totalText: '' }));

        if (diagPag.totalText) console.log(`[PJe] ${label} total: ${diagPag.totalText}`);
        if (diagPag.candidatos.length) {
          console.log(`[PJe] ${label} controles paginação:`,
            diagPag.candidatos.map(c => `${c.tag}#${c.id} cls="${c.cls}" title="${c.title}" text="${c.text}"`).join(' || '));
        } else {
          console.log(`[PJe] ${label} pág. ${pagina}: nenhum controle de paginação detectado`);
        }

        // Tenta encontrar botão "próxima página" — ordem de prioridade
        const SELETORES_NEXT = [
          // RichFaces scroller padrão PJe
          'a[id*="scroller"][id*="next"]',
          'a[id*="scroller"][id*="Next"]',
          'a[id*="Scroller"][id*="next"]',
          'a[id*="Scroller"][id*="Next"]',
          // Classe RichFaces
          '.rich-datascr-button-next:not(.rich-datascr-button-next-dis)',
          // Títulos
          'a[title*="Próxima"], a[title*="próxima"]',
          'a[title*="next"], a[title*="Next"]',
          'a[title*="Avançar"]',
          // IDs genéricos
          'a[id*="proxima"]:not([class*="dis"])',
          'a[id*="Proxima"]:not([class*="dis"])',
          'a[id*="next"]:not([class*="dis"])',
          // Texto ">" ou "»"
          'a[href*="next"], a[href*="proxima"]',
        ];

        let proxPag = null;
        for (const sel of SELETORES_NEXT) {
          proxPag = await page.$(sel).catch(() => null);
          if (proxPag) { console.log(`[PJe] ${label} botão próxima via: ${sel}`); break; }
        }

        // Fallback: clica via JavaScript no primeiro elemento que pareça "próxima página"
        if (!proxPag) {
          const clicou = await page.evaluate(() => {
            const el = Array.from(document.querySelectorAll('a, button, input'))
              .find(e => {
                const text = (e.textContent || e.value || e.title || '').trim();
                const id = (e.id || '').toLowerCase();
                const cls = (e.className || '').toLowerCase();
                return (text === '>' || text === '»' || text === 'Próxima' ||
                        id.includes('next') || id.includes('proxima') ||
                        cls.includes('next') || cls.includes('scroller')) &&
                       !cls.includes('-dis') && !e.disabled;
              });
            if (el) { el.click(); return true; }
            return false;
          }).catch(() => false);

          if (!clicou) break;
          console.log(`[PJe] ${label} clique JS na próxima página`);
          await aguardarAJAX(6000);
          pagina++;
          continue;
        }

        const desabilitado = await proxPag.evaluate(
          el => el.disabled || el.getAttribute('aria-disabled') === 'true' ||
                el.className?.includes('-dis') || el.className?.includes('inativo')
        ).catch(() => true);
        if (desabilitado) break;

        await proxPag.click();
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

        // Botão Pesquisar — seletores amplos
        const btnPesquisar = await page.$(
          'input[id*="btnPesquisar"], input[id*="pesquisar"], ' +
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
//  BUSCAR PROCESSO — pesquisa por número CNJ
// ─────────────────────────────────────────────
async function navegarParaProcesso(page, base, numero) {
  console.log(`[PJe] Buscando processo: ${numero}`);

  // Campo de busca do painel do advogado (validado em produção TJPB)
  // Garante que está no painel
  if (!page.url().includes('Painel')) {
    const urlPainel = `${base}/Painel/painel_usuario/advogado.seam`;
    await page.goto(urlPainel, { waitUntil: 'networkidle2', timeout: 20_000 });
    await page.waitForNetworkIdle({ timeout: 10_000, idleTime: 500 }).catch(() => {});
  }

  // Tenta o campo de busca da sidebar do painel (id confirmado em TJPB)
  let campoBusca = await page.$('#txtConsultaContextoExpedientes');

  // Fallback para outros seletores de busca
  if (!campoBusca) {
    campoBusca = await page.$(
      'input[placeholder*="processo"], input[placeholder*="número"], ' +
      'input[id*="numProcesso"], input[id*="numeroProcesso"]'
    );
  }

  if (campoBusca) {
    await campoBusca.click({ clickCount: 3 });
    await campoBusca.type(numero);
    await screenshot(page, 'busca-preenchida');

    // Chama a função JS de busca do painel ou pressiona Enter
    await page.evaluate((num) => {
      if (typeof setarTextoConsultaContextoExpedientes === 'function') {
        setarTextoConsultaContextoExpedientes(num);
      }
    }, numero);

    await page.waitForNetworkIdle({ timeout: 10_000, idleTime: 500 }).catch(() => {});
    await new Promise(r => setTimeout(r, AJAX_WAIT));
    await screenshot(page, 'resultado-busca');

    // Procura link clicável para o processo na lista de resultados
    const linkProcesso = await page.$(
      `a[id*="cxExItem"], ` +
      `a[href*="${encodeURIComponent(numero)}"], ` +
      `td a[id*="processo"]`
    );

    if (linkProcesso) {
      await linkProcesso.click();
      await page.waitForNetworkIdle({ timeout: TIMEOUT }).catch(() => {});
      await new Promise(r => setTimeout(r, AJAX_WAIT));
      await screenshot(page, 'detalhe-processo');
      console.log(`[PJe] Processo ${numero} aberto com sucesso`);
      return true;
    }
  }

  // Fallback: consulta pública (sem necessidade de login)
  const urlConsulta = `${base}/ConsultaPublica/listView.seam`;
  try {
    await page.goto(urlConsulta, { waitUntil: 'networkidle2', timeout: 20_000 });
    await screenshot(page, 'tela-busca-publica');

    const campoNumero = await page.$(
      'input[id*="numProcesso"], input[name*="numProcesso"], ' +
      'input[id*="numeroProcesso"], input[placeholder*="processo"]'
    );
    if (campoNumero) {
      await campoNumero.click({ clickCount: 3 });
      await campoNumero.type(numero);
      const btnBusca = await page.$('input[id*="btnPesquisar"], a[id*="pesquisar"], input[value*="Pesquisar"]');
      if (btnBusca) await btnBusca.click(); else await campoNumero.press('Enter');
      await new Promise(r => setTimeout(r, AJAX_WAIT + 1000));
      await screenshot(page, 'resultado-busca-publica');

      const linkProcesso = await page.$(`a[href*="${numero.replace(/\D/g, '')}"], td a[href*="processo"]`);
      if (linkProcesso) {
        await linkProcesso.click();
        await page.waitForNetworkIdle({ timeout: TIMEOUT }).catch(() => {});
        await new Promise(r => setTimeout(r, AJAX_WAIT));
        await screenshot(page, 'detalhe-processo');
        console.log(`[PJe] Processo ${numero} aberto via consulta pública`);
        return true;
      }
    }
  } catch (err) {
    console.warn(`[PJe] Consulta pública falhou:`, err.message);
  }

  throw new Error(`[PJe] Não foi possível navegar para o processo ${numero}`);
}

// ─────────────────────────────────────────────
//  EXTRAIR MOVIMENTAÇÕES — com paginação
// ─────────────────────────────────────────────
async function extrairMovimentacoes(page) {
  const movimentacoes = [];

  // Clica na aba de movimentações se não estiver ativa
  const abaMovs = await page.$(
    'a[id*="movimentacao"], a[href*="movimentacao"], ' +
    'li a::-p-text("Movimentações"), li a::-p-text("Histórico"), ' +
    'a[title*="Movimentação"]'
  );
  if (abaMovs) {
    await abaMovs.click();
    await new Promise(r => setTimeout(r, AJAX_WAIT));
  }

  await screenshot(page, 'aba-movimentacoes');

  let pagina = 1;
  while (true) {
    // Seletores possíveis para a tabela de movimentações no PJe
    const linhas = await page.$$eval(
      'table[id*="evento"] tr, table[id*="movimentac"] tr, ' +
      'table[id*="Eventos"] tr, .rich-table-row, ' +
      '#tabelaEventos tr, #tabelaMovimentacoes tr, ' +
      '.tabela-movimentacoes tr',
      rows => rows.slice(1).map(tr => {
        const cols = Array.from(tr.querySelectorAll('td'));
        const texto = cols[2]?.innerText?.trim() || cols[1]?.innerText?.trim() || '';
        if (!texto) return null;
        return {
          data:  cols[0]?.innerText?.trim() || '',
          tipo:  cols[1]?.innerText?.trim() || '',
          texto,
        };
      }).filter(Boolean)
    );

    movimentacoes.push(...linhas);
    console.log(`[PJe] Movimentações página ${pagina}: ${linhas.length} registros`);

    // Verifica se há próxima página de movimentações
    const proxPagina = await page.$(
      'a[id*="proxima"], a[title*="Próxima página"], ' +
      '.rich-datascr-button-next:not([disabled]), ' +
      'a[title="next page"]'
    );

    if (!proxPagina) break;

    const desabilitado = await proxPagina.evaluate(el => el.disabled || el.getAttribute('aria-disabled') === 'true' || el.classList.contains('rich-datascr-button-next-dis'));
    if (desabilitado) break;

    await proxPagina.click();
    await new Promise(r => setTimeout(r, AJAX_WAIT));
    pagina++;
    if (pagina > 20) break; // segurança
  }

  return movimentacoes;
}

// ─────────────────────────────────────────────
//  EXTRAIR DADOS + HABILITADOS
// ─────────────────────────────────────────────
async function extrairDados(page) {
  // Clica na aba de dados/partes se necessário
  const abaDados = await page.$(
    'a[id*="aba"][id*="dados"], li a::-p-text("Dados"), ' +
    'li a::-p-text("Partes"), a[title*="Partes"], a[title*="Dados"]'
  );
  if (abaDados) {
    await abaDados.click();
    await new Promise(r => setTimeout(r, AJAX_WAIT));
  }

  await screenshot(page, 'aba-dados');

  return await page.evaluate(() => {
    const txt = sel => document.querySelector(sel)?.innerText?.trim() || null;

    // Vara / Órgão Julgador — várias possibilidades de seletor no PJe
    const vara = txt('[id*="orgaoJulgador"]') ||
                 txt('[id*="OrgaoJulgador"]') ||
                 txt('.orgao-julgador') ||
                 txt('[class*="vara"]') ||
                 txt('td[title*="Órgão"]');

    // Juiz
    const juiz = txt('[id*="magistrado"]') ||
                 txt('[id*="Magistrado"]') ||
                 txt('.magistrado') ||
                 txt('[class*="juiz"]');

    // Polo passivo
    const polo_passivo = txt('[id*="partePassiva"] .nome, [id*="partePassiva"]') ||
                         txt('.polo-passivo .parte-nome') ||
                         txt('[class*="passivo"] .nome');

    // Habilitados: OABs dos advogados do polo ativo
    // PJe lista advogados em tabela de partes com OAB no formato "OAB/UF 000000"
    const habilitados = Array.from(
      document.querySelectorAll(
        '[id*="tabelaAdvogados"] td, [id*="advogado"] td, ' +
        '.polo-ativo .oab, .advogado .oab, ' +
        '[class*="advogado"] span, td[title*="OAB"]'
      )
    )
    .map(el => el.innerText?.trim())
    .filter(t => t && /OAB|^\d{3,6}$/.test(t))
    .map(t => t.replace(/[^\d\w\/]/g, ''));

    return { vara, juiz, polo_passivo, habilitados };
  });
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

    await navegarParaProcesso(page, base, numeroProcesso);
    return await extrairMovimentacoes(page);

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

    await navegarParaProcesso(page, base, numeroProcesso);
    return await extrairDados(page);

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

    await navegarParaProcesso(page, base, numeroProcesso);

    const [dados, movimentacoes] = await Promise.allSettled([
      extrairDados(page),
      extrairMovimentacoes(page),
    ]);

    return {
      dados:         dados.status === 'fulfilled'         ? dados.value         : {},
      movimentacoes: movimentacoes.status === 'fulfilled' ? movimentacoes.value : [],
    };

  } finally {
    await browser?.close();
  }
}
