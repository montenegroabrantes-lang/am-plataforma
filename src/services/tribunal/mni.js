/**
 * MNI — Modelo Nacional de Interoperabilidade (SOAP 2.2.2)
 * Autenticação: idConsultante + senhaConsultante NO BODY SOAP (não HTTP Basic).
 * Endpoint: <base_pje>/intercomunicacao
 */
import axios from 'axios';

// Namespace do serviço MNI no PJe CNJ
const NS = 'http://www.cnj.jus.br/intercomunicacao-2.2.2';

// ─────────────────────────────────────────────
//  HELPERS XML
// ─────────────────────────────────────────────

function envelope(body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:ser="${NS}">
  <soapenv:Header/>
  <soapenv:Body>${body}</soapenv:Body>
</soapenv:Envelope>`;
}

// Remove namespace prefixes so regex can match tag names directly
function stripNs(xml) {
  return xml
    .replace(/<(\/?)[\w.-]+:([\w.-]+)/g, '<$1$2')
    .replace(/\s[\w.-]+:([\w.-]+)=/g, ' $1=');
}

// First text content of <tag>…</tag>
function xText(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? m[1].replace(/<[^>]+>/g, '').trim() : null;
}

// First value of attribute inside a tag occurrence
function xAttr(xml, tag, attr) {
  const m = xml.match(new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`, 'i'));
  return m ? m[1] : null;
}

// All occurrences of <tag …>…</tag>
function xAll(xml, tag) {
  const re = new RegExp(`<${tag}[\\s>][\\s\\S]*?<\\/${tag}>`, 'gi');
  return xml.match(re) || [];
}

// Build MNI endpoint from PJe login URL
// https://pje.tjpb.jus.br/pje/login.seam → https://pje.tjpb.jus.br/pje/intercomunicacao
function endpointDe(loginUrl) {
  return loginUrl.replace(/\/login\.seam.*$/, '/intercomunicacao');
}

// ─────────────────────────────────────────────
//  consultarProcesso
// ─────────────────────────────────────────────
export async function consultarProcesso(loginUrl, cpf, senha, numero, opts = {}) {
  const endpoint = endpointDe(loginUrl);
  const { movimentos = true, incluirDocumentos = false } = opts;
  const cpfLimpo = cpf.replace(/\D/g, '');

  // Credenciais vão dentro do body SOAP (padrão MNI — não usa HTTP Basic Auth)
  const body = `
    <ser:consultarProcesso>
      <idConsultante>${cpfLimpo}</idConsultante>
      <senhaConsultante>${senha}</senhaConsultante>
      <numeroProcesso>${numero}</numeroProcesso>
      <movimentos>${movimentos}</movimentos>
      <incluirCabecalho>true</incluirCabecalho>
      <incluirDocumentos>${incluirDocumentos}</incluirDocumentos>
    </ser:consultarProcesso>`;

  console.log(`[MNI] consultarProcesso ${numero} → ${endpoint}`);

  const resp = await axios.post(endpoint, envelope(body), {
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': '',
    },
    timeout: 30_000,
    validateStatus: null,
  });

  if (resp.status >= 400) {
    throw new Error(`MNI HTTP ${resp.status} — ${numero}`);
  }

  return parsearProcesso(stripNs(String(resp.data)));
}

// ─────────────────────────────────────────────
//  PARSER SOAP → {dados, movimentacoes}
// ─────────────────────────────────────────────
function parsearProcesso(xml) {
  const sucesso = xText(xml, 'sucesso');
  if (sucesso === 'false') {
    const msg = xText(xml, 'mensagem') || 'MNI retornou erro';
    throw new Error(`MNI: ${msg}`);
  }

  // Órgão julgador (vara): pode ser atributo nomeOrgao ou elemento
  const vara =
    xAttr(xml, 'orgaoJulgador', 'nomeOrgao') ||
    xAttr(xml, 'orgaoJulgador', 'nome')      ||
    xText(xml, 'orgaoJulgador');

  // Magistrado/juiz
  const juiz =
    xAttr(xml, 'dadosBasicos', 'magistrado') ||
    xAttr(xml, 'magistrado', 'nome')         ||
    xText(xml, 'magistrado');

  // Polo passivo (tipo PA ou RE) — primeiro nome de parte
  const poloPassivoM = xml.match(/<polo[^>]*tipo="(?:PA|RE)"[^>]*>([\s\S]*?)<\/polo>/i);
  let polo_passivo = null;
  if (poloPassivoM) {
    const nomes = [...poloPassivoM[1].matchAll(/<nome>([^<]+)<\/nome>/gi)];
    polo_passivo = nomes.map(n => n[1].trim()).join(', ') || null;
  }

  // Habilitados — OABs dos advogados do polo ativo (AT)
  const poloAtivoM = xml.match(/<polo[^>]*tipo="AT"[^>]*>([\s\S]*?)<\/polo>/i);
  const habilitados = [];
  if (poloAtivoM) {
    for (const m of poloAtivoM[1].matchAll(/numeroOAB="([^"]+)"/gi)) habilitados.push(m[1]);
    for (const m of poloAtivoM[1].matchAll(/<oab>([^<]+)<\/oab>/gi))  habilitados.push(m[1].trim());
  }

  // Movimentações
  const movimentacoes = [];
  for (const bloco of xAll(xml, 'movimento')) {
    const dataHora = xText(bloco, 'dataHora') || xAttr(bloco, 'movimento', 'dataHora');
    const data = dataHora ? dataHora.substring(0, 10) : null;

    // Junta todos os complementos em um texto legível
    const compBlocks = xAll(bloco, 'complemento');
    let texto = compBlocks.map(c => {
      const tipo  = xAttr(c, 'complemento', 'descricaoTipo') || '';
      const valor = xAttr(c, 'complemento', 'valor') || xText(c, 'complemento') || '';
      return tipo ? `${tipo}: ${valor}` : valor;
    }).filter(Boolean).join(' — ');

    if (!texto) texto = xText(bloco, 'descricao') || '';
    const tipo = xText(bloco, 'codigoNacional') || null;

    if (texto) movimentacoes.push({ data, tipo, texto });
  }

  return {
    dados: { vara, juiz, polo_passivo, habilitados },
    movimentacoes,
  };
}

// ─────────────────────────────────────────────
//  VERIFICAR DISPONIBILIDADE DO ENDPOINT
// ─────────────────────────────────────────────
export async function verificarEndpoint(loginUrl) {
  const endpoint = endpointDe(loginUrl);
  try {
    const resp = await axios.get(`${endpoint}?wsdl`, {
      timeout: 10_000,
      validateStatus: null,
    });
    return resp.status < 500;
  } catch {
    return false;
  }
}
