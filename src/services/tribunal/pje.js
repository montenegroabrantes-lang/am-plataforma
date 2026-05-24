import puppeteer from 'puppeteer';

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

// Loga no PJe e retorna browser+page com sessão ativa
async function login(url, cpf, senha) {
  const browser = await abrirBrowser();
  const page    = await browser.newPage();
  await page.setDefaultTimeout(TIMEOUT);

  await page.goto(url, { waitUntil: 'networkidle2' });

  await page.type('#username', cpf.replace(/\D/g, ''));
  await page.type('#password', senha);
  await page.click('[type="submit"]');

  await page.waitForNavigation({ waitUntil: 'networkidle2' });

  const titulo = await page.title();
  if (titulo.toLowerCase().includes('login') || titulo.toLowerCase().includes('erro')) {
    await browser.close();
    throw new Error(`Login PJe falhou em ${url}. Verifique CPF e senha.`);
  }

  return { browser, page };
}

// Busca movimentações de um processo pelo número
export async function buscarMovimentacoes(url, cpf, senha, numeroProcesso) {
  let browser;
  try {
    ({ browser } = await login(url, cpf, senha));
    const page = (await browser.pages()).pop();

    // Navega para a busca de processo
    await page.goto(`${url.replace('/login.seam', '')}/Processo/Detalhe?processo=${encodeURIComponent(numeroProcesso)}`, {
      waitUntil: 'networkidle2',
    });

    // Aguarda tabela de movimentações
    await page.waitForSelector('.rich-table-row, table.tabela-movimentacoes tr', { timeout: TIMEOUT });

    const movs = await page.evaluate(() => {
      const linhas = Array.from(document.querySelectorAll('.rich-table-row, table.tabela-movimentacoes tr'));
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

// Busca dados básicos do processo (vara, juiz, polo passivo, habilitados)
export async function buscarDadosProcesso(url, cpf, senha, numeroProcesso) {
  let browser;
  try {
    ({ browser } = await login(url, cpf, senha));
    const page = (await browser.pages()).pop();

    await page.goto(`${url.replace('/login.seam', '')}/Processo/Detalhe?processo=${encodeURIComponent(numeroProcesso)}`, {
      waitUntil: 'networkidle2',
    });

    await page.waitForSelector('.processo-detalhe, #detalhe-processo', { timeout: TIMEOUT });

    const dados = await page.evaluate(() => {
      const get = (sel) => document.querySelector(sel)?.innerText?.trim() || null;
      return {
        vara:         get('.vara, .orgao-julgador'),
        juiz:         get('.magistrado, .juiz'),
        polo_passivo: get('.polo-passivo .parte-nome'),
        habilitados:  Array.from(document.querySelectorAll('.polo-ativo .oab, .advogado .oab'))
                           .map(el => el.innerText.trim()).filter(Boolean),
      };
    });

    return dados;
  } finally {
    await browser?.close();
  }
}
