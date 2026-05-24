import puppeteer    from 'puppeteer';
import { authenticator } from 'otplib';

const TIMEOUT = 30_000;

function browserArgs() {
  return [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
  ];
}

async function abrirBrowser() {
  return puppeteer.launch({
    headless: 'new',
    args: browserArgs(),
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
}

// Login no eProc com TOTP opcional
async function login(url, cpf, senha, totpSecret) {
  const browser = await abrirBrowser();
  const page    = await browser.newPage();
  await page.setDefaultTimeout(TIMEOUT);

  await page.goto(url, { waitUntil: 'networkidle2' });

  await page.type('[name="txtUsuario"], #txtUsuario, input[type="text"]', cpf.replace(/\D/g, ''));
  await page.type('[name="pwdSenha"],  #pwdSenha,  input[type="password"]', senha);

  // TOTP: TRF5 exige código antes de submeter
  if (totpSecret) {
    const codigo = authenticator.generate(totpSecret);
    const totpField = await page.$('[name="txtCodigoSeguranca"], #txtCodigoSeguranca');
    if (totpField) await totpField.type(codigo);
  }

  await page.click('[name="sbmLogin"], #sbmLogin, [type="submit"]');
  await page.waitForNavigation({ waitUntil: 'networkidle2' });

  const titulo = await page.title();
  if (titulo.toLowerCase().includes('login') || titulo.toLowerCase().includes('erro')) {
    await browser.close();
    throw new Error(`Login eProc falhou em ${url}.`);
  }

  return { browser, page };
}

// Busca movimentações pelo número CNJ
export async function buscarMovimentacoes(url, cpf, senha, totpSecret, numeroProcesso) {
  let browser;
  try {
    ({ browser } = await login(url, cpf, senha, totpSecret));
    const page = (await browser.pages()).pop();

    // eProc: pesquisa por número
    const baseUrl = new URL(url).origin;
    await page.goto(`${baseUrl}/eproc/controlador.php?acao=processo_selecionar&num_processo=${encodeURIComponent(numeroProcesso)}`, {
      waitUntil: 'networkidle2',
    });

    await page.waitForSelector('#divMovimentacoes tr, .movimentacao', { timeout: TIMEOUT });

    const movs = await page.evaluate(() => {
      const linhas = Array.from(document.querySelectorAll('#divMovimentacoes tr, .movimentacao'));
      return linhas.slice(1).map(tr => {
        const cols = Array.from(tr.querySelectorAll('td'));
        return {
          data:  cols[0]?.innerText?.trim() || '',
          tipo:  cols[1]?.innerText?.trim() || '',
          texto: cols[2]?.innerText?.trim() || cols[1]?.innerText?.trim() || '',
        };
      }).filter(m => m.texto);
    });

    return movs;
  } finally {
    await browser?.close();
  }
}

// Busca dados básicos do processo
export async function buscarDadosProcesso(url, cpf, senha, totpSecret, numeroProcesso) {
  let browser;
  try {
    ({ browser } = await login(url, cpf, senha, totpSecret));
    const page = (await browser.pages()).pop();

    const baseUrl = new URL(url).origin;
    await page.goto(`${baseUrl}/eproc/controlador.php?acao=processo_selecionar&num_processo=${encodeURIComponent(numeroProcesso)}`, {
      waitUntil: 'networkidle2',
    });

    await page.waitForSelector('#divDadosProcesso, .processo-dados', { timeout: TIMEOUT });

    const dados = await page.evaluate(() => {
      const get = (sel) => document.querySelector(sel)?.innerText?.trim() || null;
      return {
        vara:         get('#lblOrgaoJulgador, .orgao-julgador'),
        juiz:         get('#lblMagistrado, .magistrado'),
        polo_passivo: get('.polo-passivo .nome, #txtReu'),
        habilitados:  Array.from(document.querySelectorAll('.advogado-oab, .oab-habilitado'))
                           .map(el => el.innerText.trim()).filter(Boolean),
      };
    });

    return dados;
  } finally {
    await browser?.close();
  }
}
