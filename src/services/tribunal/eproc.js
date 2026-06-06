import puppeteer       from 'puppeteer';
import { authenticator } from 'otplib';
import fs               from 'fs';
import path             from 'path';

const TIMEOUT     = 45_000;
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
    protocolTimeout: 300_000,
  });
}

const MAX_SHOTS_EPROC = 200;
async function screenshot(page, nome) {
  if (!DEBUG_SHOTS) return;
  try {
    const dir = '/tmp/pje-debug';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, `${Date.now()}-eproc-${nome}.png`), fullPage: true });

    const arquivos = fs.readdirSync(dir)
      .filter(f => f.endsWith('.png'))
      .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const { f } of arquivos.slice(MAX_SHOTS_EPROC)) {
      try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignora */ }
    }
  } catch (err) { console.warn('[eProc] screenshot falhou:', err.message); }
}

// ─────────────────────────────────────────────
//  LOGIN eProc
// ─────────────────────────────────────────────
// eProc (FENIX) é PHP — seletores muito mais estáveis que o PJe
async function login(url, cpf, senha, totpSecret) {
  const browser = await abrirBrowser();
  const page    = await browser.newPage();
  page.setDefaultTimeout(TIMEOUT);

  try {
    console.log(`[eProc] Acessando login: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2' });
    await screenshot(page, 'login');

    // eProc usa campos com name fixos — muito estáveis
    await page.waitForSelector('[name="txtUsuario"]');
    await page.type('[name="txtUsuario"]', cpf.replace(/\D/g, ''));
    await page.type('[name="pwdSenha"]', senha);

    // TOTP: TRF5 exige código de autenticação antes de submeter
    if (totpSecret) {
      // Gera o código TOTP com janela de tolerância (+1 período para latência de rede)
      const codigo = authenticator.generate(totpSecret);
      const campoTotp = await page.$('[name="txtCodigoSeguranca"], #txtCodigoSeguranca, [name="txtOTP"]');
      if (campoTotp) {
        console.log('[eProc] Inserindo código TOTP...');
        await campoTotp.type(codigo);
      }
    }

    await page.click('[name="sbmLogin"], #sbmLogin, [type="submit"]');
    await page.waitForNetworkIdle({ timeout: TIMEOUT }).catch(() => {});
    await screenshot(page, 'pos-login');

    const urlAtual = page.url();
    const titulo   = await page.title();
    // Falha se ainda está na tela de login — URL do eProc pós-login contém externo_controlador
    if (titulo.toLowerCase().includes('login') || urlAtual.toLowerCase().includes('login')) {
      throw new Error('Login eProc falhou — verifique CPF, senha e código TOTP.');
    }

    console.log(`[eProc] Login OK. URL: ${urlAtual}`);
    return { browser, page };

  } catch (err) {
    await screenshot(page, 'erro-login');
    await browser.close();
    throw err;
  }
}

// ─────────────────────────────────────────────
//  INSPECIONAR PAINEL eProc — todas as abas
// ─────────────────────────────────────────────
export async function inspecionarPainel(url, cpf, senha, totpSecret) {
  let browser;
  try {
    ({ browser } = await login(url, cpf, senha, totpSecret));
    const page    = (await browser.pages()).pop();
    const baseUrl = new URL(url).origin;

    const numerosEncontrados = new Set();

    // eProc painel — grupos de processos
    const abasParaInspecionar = [
      // Painel principal
      `${baseUrl}/eproc/controlador.php?acao=principal`,
      // Processos com movimentação (último acesso)
      `${baseUrl}/eproc/controlador.php?acao=processo_pesquisar&txtPalavraGerada=&chkMostrarSomenteNaoLidos=S`,
      // Intimações pendentes
      `${baseUrl}/eproc/controlador.php?acao=intimacao_listar`,
      // Todos os processos do advogado
      `${baseUrl}/eproc/controlador.php?acao=processo_pesquisar`,
    ];

    for (const u of abasParaInspecionar) {
      try {
        console.log(`[eProc] Inspecionando: ${u}`);
        await page.goto(u, { waitUntil: 'networkidle2', timeout: 20_000 });
        await screenshot(page, 'aba-painel');

        // Coleta números CNJ visíveis
        await coletarNumerosComPaginacao(page, numerosEncontrados, baseUrl);

      } catch (err) {
        console.warn(`[eProc] Aba ${u} falhou:`, err.message);
      }
    }

    const numeros = [...numerosEncontrados];
    console.log(`[eProc] Total processos encontrados: ${numeros.length}`);
    return numeros;

  } finally {
    await browser?.close();
  }
}

async function coletarNumerosComPaginacao(page, set, baseUrl) {
  let pagina = 1;
  while (true) {
    const textos = await page.$$eval('td, a', els =>
      els.map(e => e.textContent?.trim()).filter(t => /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/.test(t ?? ''))
    );

    let novos = 0;
    for (const t of textos) {
      const match = t.match(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/);
      if (match && !set.has(match[0])) { set.add(match[0]); novos++; }
    }
    if (novos > 0) console.log(`[eProc] +${novos} números na página ${pagina}`);

    // eProc usa links "Próxima" para paginação
    const proxLink = await page.$('a[href*="pagina"]:last-of-type, a::-p-text("Próxima"), #lnkProximaPagina');
    if (!proxLink) break;

    const href = await proxLink.evaluate(el => el.href);
    if (!href || href === page.url()) break;

    await page.goto(href, { waitUntil: 'networkidle2', timeout: 20_000 });
    pagina++;
    if (pagina > 50) break; // segurança
  }
}

// ─────────────────────────────────────────────
//  NAVEGAR PARA PROCESSO — eProc suporta URL direta
// ─────────────────────────────────────────────
async function navegarParaProcesso(page, baseUrl, grau, numeroProcesso) {
  // eProc (PHP) aceita URL direta com número CNJ — muito mais simples que PJe
  // grau '1' → /eproc/, grau '2' → /eproc2g/
  const prefixo = grau === '2' ? 'eproc2g' : 'eproc';

  const urlProcesso = `${baseUrl}/${prefixo}/controlador.php?acao=processo_visualizar&num_processo=${encodeURIComponent(numeroProcesso)}`;

  console.log(`[eProc] Acessando processo: ${urlProcesso}`);
  await page.goto(urlProcesso, { waitUntil: 'networkidle2' });
  await screenshot(page, 'processo-detalhe');

  // Verifica se o processo foi encontrado
  const titulo = await page.title();
  if (titulo.toLowerCase().includes('erro') || titulo.toLowerCase().includes('não encontrado')) {
    throw new Error(`Processo ${numeroProcesso} não encontrado no eProc.`);
  }
}

// ─────────────────────────────────────────────
//  EXTRAIR MOVIMENTAÇÕES — eProc
// ─────────────────────────────────────────────
async function extrairMovimentacoes(page) {
  const movimentacoes = [];
  let pagina = 1;

  while (true) {
    // eProc usa tabela com id tblProcEventos ou similar
    const linhas = await page.$$eval(
      '#tblProcEventos tr, table#eventos tr, #divMovimentos table tr, ' +
      'table.infraTable tr, #frmProcessoEvento table tr',
      rows => rows.slice(1).map(tr => {
        const cols = Array.from(tr.querySelectorAll('td'));
        const texto = cols[2]?.innerText?.trim() || cols[1]?.innerText?.trim() || '';
        if (!texto || cols.length < 2) return null;
        return {
          data:  cols[0]?.innerText?.trim() || '',
          tipo:  cols[1]?.innerText?.trim() || '',
          texto,
        };
      }).filter(Boolean)
    );

    movimentacoes.push(...linhas);
    console.log(`[eProc] Movimentações página ${pagina}: ${linhas.length}`);

    // eProc pagina eventos com link "Próximo" ou numeração
    const proxPagina = await page.$('a[href*="pagina_evento"]:last-of-type, a::-p-text("Próximo"), #lnkProximosEventos');
    if (!proxPagina) break;

    const href = await proxPagina.evaluate(el => el.href);
    if (!href || href === page.url()) break;

    await page.goto(href, { waitUntil: 'networkidle2' });
    pagina++;
    if (pagina > 50) break;
  }

  return movimentacoes;
}

// ─────────────────────────────────────────────
//  EXTRAIR DADOS + HABILITADOS — eProc
// ─────────────────────────────────────────────
async function extrairDados(page) {
  return await page.evaluate(() => {
    const txt = sel => document.querySelector(sel)?.innerText?.trim() || null;

    const vara = txt('#lblOrgaoJulgador') ||
                 txt('[id*="OrgaoJulgador"]') ||
                 txt('.infraLabelObrigatorio + td');

    const juiz = txt('#lblMagistrado') ||
                 txt('[id*="Magistrado"]') ||
                 txt('[id*="magistrado"]');

    const acao = txt('#lblClasse') ||
                 txt('[id*="Classe"]') ||
                 txt('[id*="classe"]') ||
                 txt('[id*="tipoAcao"]');

    const polo_ativo = txt('#txtAutor') ||
                       txt('[id*="Autor"]') ||
                       txt('[id*="polo_ativo"]') ||
                       txt('[id*="requerente"]');

    const polo_passivo = txt('#txtReu') ||
                         txt('[id*="Reu"]') ||
                         txt('[id*="polo_passivo"]');

    // eProc lista advogados habilitados em tabela de partes
    // OAB aparece no formato "OAB/PB 000000" ou similar
    const habilitados = Array.from(
      document.querySelectorAll(
        '#tblPartes td, table[id*="partes"] td, ' +
        '.infraTable td[nowrap], td[id*="oab"], ' +
        'td[id*="advogado"]'
      )
    )
    .map(el => el.innerText?.trim())
    .filter(t => t && /OAB\/[A-Z]{2}\s?\d{3,6}|^\d{4,6}$/.test(t));

    return { vara, juiz, acao, polo_ativo, polo_passivo, habilitados };
  });
}

// ─────────────────────────────────────────────
//  EXPORTAÇÕES PÚBLICAS
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
//  SESSÃO COMPARTILHADA — sync em lote eProc
// ─────────────────────────────────────────────

export async function abrirSessao(url, cpf, senha, totpSecret) {
  return login(url, cpf, senha, totpSecret);
}

export async function buscarProcessoCompletoComSessao(browser, url, numeroProcesso, grau = '1') {
  const page    = await browser.newPage();
  page.setDefaultTimeout(TIMEOUT);
  try {
    const baseUrl = new URL(url).origin;
    await navegarParaProcesso(page, baseUrl, grau, numeroProcesso);
    const dados         = await extrairDados(page);
    const movimentacoes = await extrairMovimentacoes(page);
    return { dados, movimentacoes };
  } finally {
    await page.close().catch(() => {});
  }
}

export async function buscarMovimentacoes(url, cpf, senha, totpSecret, numeroProcesso, grau = '1') {
  let browser;
  try {
    ({ browser } = await login(url, cpf, senha, totpSecret));
    const page    = (await browser.pages()).pop();
    const baseUrl = new URL(url).origin;

    await navegarParaProcesso(page, baseUrl, grau, numeroProcesso);
    return await extrairMovimentacoes(page);

  } finally {
    await browser?.close();
  }
}

export async function buscarDadosProcesso(url, cpf, senha, totpSecret, numeroProcesso, grau = '1') {
  let browser;
  try {
    ({ browser } = await login(url, cpf, senha, totpSecret));
    const page    = (await browser.pages()).pop();
    const baseUrl = new URL(url).origin;

    await navegarParaProcesso(page, baseUrl, grau, numeroProcesso);
    return await extrairDados(page);

  } finally {
    await browser?.close();
  }
}

// Busca tudo em uma sessão — evita dois logins
export async function buscarProcessoCompleto(url, cpf, senha, totpSecret, numeroProcesso, grau = '1') {
  let browser;
  try {
    ({ browser } = await login(url, cpf, senha, totpSecret));
    const page    = (await browser.pages()).pop();
    const baseUrl = new URL(url).origin;

    await navegarParaProcesso(page, baseUrl, grau, numeroProcesso);

    const dados         = await extrairDados(page);
    const movimentacoes = await extrairMovimentacoes(page);

    return { dados, movimentacoes };

  } finally {
    await browser?.close();
  }
}
