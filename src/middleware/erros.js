import crypto from 'node:crypto';
import { daTabela } from '../utils/tabelaSegura.js';

// S-22 — erros internos não devolvem mais a mensagem crua (texto do Postgres, caminhos, nomes de
// contas de serviço...). O usuário recebe "Erro interno. Código ABC12345." e o detalhe completo
// fica só no log do servidor, com o mesmo código para o suporte achar a linha certa.

// 8 caracteres hexadecimais em maiúsculas (ex.: 9F3A0C71): fácil de ler por telefone e de
// procurar no log do Railway.
export function gerarCodigoErro() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

// Mensagens de erro costumam carregar o dado que causou o erro (o Postgres cita a chave
// duplicada, o Digisac cita o telefone...). O log guarda o erro, não o dado pessoal.
export function limparParaLog(texto) {
  return String(texto ?? '')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[cpf]')
    .replace(/\(\d{2}\)\s?9?\d{4}-?\d{4}/g, '[telefone]')
    .replace(/\+?\b\d{10,}\b/g, '[numero]');
}

// Rota sem query string e sem os valores dos parâmetros (o padrão da rota, quando existe).
function rotaParaLog(req) {
  if (!req) return '';
  const caminho = req.route?.path ? `${req.baseUrl || ''}${req.route.path}` : (req.originalUrl || req.url || '').split('?')[0];
  return limparParaLog(`${req.method || ''} ${caminho}`.trim());
}

// Grava o erro completo (sem dados pessoais) e devolve o código de correlação.
export function registrarErroInterno(err, req) {
  const codigo = gerarCodigoErro();
  const tipo = err?.name || 'Error';
  const sql = err?.code ? ` code=${err.code}` : '';
  const restricao = err?.constraint ? ` constraint=${err.constraint}` : '';
  const pilha = String(err?.stack || '').split('\n').slice(1, 6).join(' | ');
  console.error(`[ERROR] codigo=${codigo} ${rotaParaLog(req)} ${tipo}${sql}${restricao}: ${limparParaLog(err?.message)}${pilha ? ` || ${limparParaLog(pilha)}` : ''}`);
  return codigo;
}

export const mensagemErroInterno = codigo => `Erro interno. Código ${codigo}.`;

// Mensagem própria da rota + o código do erro: "Não foi possível enviar o arquivo. Código ABC12345."
// Serve para falhas de integração (Drive, Camila) em que o usuário precisa saber o que falhou, mas
// o texto técnico do erro fica só no log.
export function mensagemComCodigo(texto, err, req) {
  return `${texto} Código ${registrarErroInterno(err, req)}.`;
}

// Resposta padrão de erro inesperado, para os blocos `catch` das rotas.
export function erroInterno(res, err) {
  const codigo = registrarErroInterno(err, res.req);
  if (res.headersSent) return undefined;
  return res.status(500).json({ ok: false, erro: mensagemErroInterno(codigo) });
}

// Para rotas que já lançam erros de negócio com `status` (validação, conflito, 502 de integração):
// esses têm mensagem escrita pelo sistema e continuam aparecendo; o que não tem `status` é
// erro inesperado (banco, bug) e vira o erro genérico com código.
export function responderErro(res, err) {
  const status = Number(err?.status);
  if (Number.isInteger(status) && status >= 400 && status < 600) {
    return res.status(status).json({ ok: false, erro: err.message, ...(err.detalhes ? { detalhes: err.detalhes } : {}) });
  }
  return erroInterno(res, err);
}

const MENSAGENS_CORPO = {
  'entity.parse.failed': 'O corpo da requisição não é um JSON válido.',
  'entity.too.large': 'O corpo da requisição é grande demais.',
  'encoding.unsupported': 'Codificação da requisição não suportada.',
  'charset.unsupported': 'Codificação da requisição não suportada.',
};

const MENSAGENS_UPLOAD = {
  LIMIT_FILE_SIZE: [413, 'Arquivo grande demais.'],
  LIMIT_FILE_COUNT: [400, 'Envie um único arquivo.'],
  LIMIT_UNEXPECTED_FILE: [400, 'Envie um único arquivo PDF no campo "arquivo".'],
};

// Tratador global (o último `app.use` do index.js).
// - erro de entrada do cliente (JSON quebrado, corpo grande, upload fora do limite): 4xx com mensagem clara;
// - qualquer outra coisa: 500 genérico com código; o detalhe só vai para o log.
export function tratadorGlobalDeErros(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err?.name === 'MulterError') {
    const [status, erro] = daTabela(MENSAGENS_UPLOAD, err.code) || [400, 'Envio de arquivo inválido.'];
    return res.status(status).json({ ok: false, erro });
  }

  const status = Number(err?.status ?? err?.statusCode);
  if (Number.isInteger(status) && status >= 400 && status < 500 && err.expose === true) {
    return res.status(status).json({ ok: false, erro: daTabela(MENSAGENS_CORPO, err.type) || err.message });
  }

  return erroInterno(res, err);
}
