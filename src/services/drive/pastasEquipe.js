// Pastas da equipe no Drive: "_PENDENTE A PROTOCOLAR - 2026 - AM" (antes do protocolo) e
// "Outorgantes 2026" (depois). Regras puras de nome e de correspondência pasta ↔ cliente, sem I/O.
//
// A equipe nomeia as pastas "NOME x ENTE" (ex.: "FRANKLIN HERIK ... x PB", "VERA LUCIA ... X PMJP -
// AUX SALA DE AULA"), à mão e às vezes com erro de digitação ("MATO" por "MATOS"). Por isso a
// correspondência é por palavras, tolerante a prefixo, e só vale quando há UM cliente acima do corte.

export function pastasConfiguradas(env = process.env) {
  const lista = (v) => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
  return {
    pendentes: lista(env.GOOGLE_DRIVE_PASTA_PENDENTES)[0] || null,
    outorgantes: lista(env.GOOGLE_DRIVE_PASTA_OUTORGANTES), // a 1ª é a do ano corrente (destino da mudança)
  };
}

function semAcento(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Sigla do ente no padrão da equipe. Sem regra conhecida, usa o próprio polo em maiúsculas.
const SIGLAS = [
  [/estado da paraiba|governo da paraiba|^pb$/, 'PB'],
  [/estado de pernambuco|governo de pernambuco|^pe$/, 'PE'],
  [/estado do rio grande do norte|^rn$/, 'RN'],
  [/estado do ceara|^ce$/, 'CE'],
  [/emlur/, 'EMLUR'],
  [/municipio de joao pessoa|prefeitura (municipal )?de joao pessoa|^pmjp$/, 'PMJP'],
  [/municipio de campina grande|prefeitura (municipal )?de campina grande/, 'PMCG'],
  [/municipio de natal|prefeitura (municipal )?de natal/, 'NATAL'],
  [/municipio de recife|prefeitura (municipal )?do recife/, 'RECIFE'],
  [/municipio de fortaleza/, 'FORTALEZA'],
  [/uniao federal|ministerio da agricultura|\bmapa\b/, 'UNIAO'],
  [/\binss\b/, 'INSS'],
];

export function siglaEnte(polo) {
  const p = semAcento(polo).toLowerCase().trim();
  if (!p) return null;
  for (const [re, sigla] of SIGLAS) if (re.test(p)) return sigla;
  return semAcento(polo).toUpperCase().replace(/\s+/g, ' ').trim();
}

export function nomePastaEquipe(nome, polo) {
  const n = semAcento(nome).toUpperCase().replace(/\s+/g, ' ').trim() || 'CLIENTE';
  const s = siglaEnte(polo);
  return s ? `${n} x ${s}` : n;
}

const LIGACOES = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E']);

// Palavras do nome da pessoa numa pasta: o que vem antes do " x ENTE" / " - ".
export function palavrasDoNome(texto) {
  const base = semAcento(texto).toUpperCase().split(/\s+X\s+|\s+-\s+/)[0];
  return base.replace(/[^A-Z\s]/g, ' ').split(/\s+/).filter(p => p.length > 1 && !LIGACOES.has(p));
}

function mesmaPalavra(a, b) {
  if (a === b) return true;
  const [curta, longa] = a.length <= b.length ? [a, b] : [b, a];
  return curta.length >= 4 && longa.startsWith(curta) && longa.length - curta.length <= 2;
}

// 0..1: fração das palavras do nome mais longo que têm par no outro (tolerando "MATO"/"MATOS").
export function semelhancaNomes(a, b) {
  const pa = palavrasDoNome(a), pb = palavrasDoNome(b);
  if (!pa.length || !pb.length) return 0;
  const usadas = new Set();
  let pares = 0;
  for (const x of pa) {
    const i = pb.findIndex((y, j) => !usadas.has(j) && mesmaPalavra(x, y));
    if (i >= 0) { usadas.add(i); pares++; }
  }
  // O primeiro nome tem de bater: evita casar "MARIA DA SILVA" com "ANA DA SILVA".
  if (!mesmaPalavra(pa[0], pb[0])) return 0;
  return pares / Math.max(pa.length, pb.length);
}

export const CORTE_SEMELHANCA = 0.8;

// Cliente da pasta: id da pasta igual ao drive_pasta_id vence; senão, o único cliente com nome
// semelhante acima do corte. Dois ou mais candidatos = ambíguo (devolve os candidatos, não escolhe).
export function clienteDaPasta(pasta, clientes) {
  const porId = clientes.find(c => c.drive_pasta_id && c.drive_pasta_id === pasta.id);
  if (porId) return { cliente: porId, por: 'pasta_vinculada', candidatos: [] };
  const candidatos = clientes
    .map(c => ({ c, s: semelhancaNomes(pasta.nome, c.nome) }))
    .filter(x => x.s >= CORTE_SEMELHANCA)
    .sort((x, y) => y.s - x.s);
  if (candidatos.length === 1) return { cliente: candidatos[0].c, por: 'nome', candidatos: [] };
  return { cliente: null, por: candidatos.length ? 'ambiguo' : 'nenhum', candidatos: candidatos.map(x => x.c) };
}

// Números CNJ (com máscara) num texto — o comprovante de protocolo do PJe traz o número formatado.
export function numerosCnj(texto) {
  const achados = new Set();
  for (const m of String(texto || '').matchAll(/\b(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})\b/g)) achados.add(m[1]);
  return [...achados];
}

// Arquivo que parece comprovante de protocolo, pelo nome.
export function ehComprovante(nomeArquivo) {
  const n = semAcento(nomeArquivo).toLowerCase();
  return /\.pdf$/.test(n) && /(protocolo|comprovante|recibo)/.test(n);
}
