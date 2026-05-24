import { google } from 'googleapis';
import { db }     from '../../db/index.js';

function auth() {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return oauth2;
}

// Lê processos ativos da planilha processos_camila
export async function lerProcessosCamila() {
  const sheetId = process.env.SHEETS_PROCESSOS_CAMILA_ID
    || await obterConfiguracao('processos_camila_id');

  if (!sheetId || sheetId === 'configurar_no_railway') {
    console.warn('[Sheets] SHEETS_PROCESSOS_CAMILA_ID não configurado.');
    return [];
  }

  if (!process.env.GOOGLE_REFRESH_TOKEN || process.env.GOOGLE_REFRESH_TOKEN === 'configurar_no_railway') {
    console.warn('[Sheets] GOOGLE_REFRESH_TOKEN não configurado.');
    return [];
  }

  try {
    const sheets = google.sheets({ version: 'v4', auth: auth() });
    const resp   = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'A:Z',
    });

    const rows    = resp.data.values || [];
    const headers = rows[0]?.map(h => h?.toLowerCase().trim().replace(/\s+/g, '_')) || [];

    return rows.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i] || ''; });
      return obj;
    }).filter(r => r.numero_processo || r.processo);
  } catch (err) {
    console.error('[Sheets] Erro ao ler planilha:', err.message);
    return [];
  }
}

// Salva eventos da Camila como eventos_sac no banco
export async function sincronizarProcessosCamila() {
  const processos = await lerProcessosCamila();
  let salvos = 0;

  for (const proc of processos) {
    const numero = proc.numero_processo || proc.processo;
    if (!numero) continue;

    try {
      await db.execute(
        `INSERT INTO eventos_sac (tipo, payload, criado_em)
         VALUES ('lead_qualificado', $1, NOW())
         ON CONFLICT DO NOTHING`,
        [JSON.stringify({ ...proc, fonte: 'camila_sheets' })]
      );
      salvos++;
    } catch { /* ignora */ }
  }

  return salvos;
}

async function obterConfiguracao(chave) {
  const row = await db.queryOne(
    `SELECT valor FROM configuracoes WHERE categoria = 'sheets' AND chave = $1`, [chave]
  );
  return row?.valor;
}
