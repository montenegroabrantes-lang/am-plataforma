import { registrarAuditoria } from './auditoria.js';
import { idCurto } from '../utils/auditoriaCampos.js';

// S-13 — trilha de auditoria para um router inteiro de proxy (Estimativas → Camila), em um só lugar:
// toda escrita (POST/PATCH/PUT/DELETE) que terminar com sucesso grava quem fez, o quê e sobre qual
// estimativa/lead. Rotas novas adicionadas ao router entram na trilha sozinhas (ação genérica
// "camila_<método>") em vez de ficarem sem registro até alguém lembrar.
//
// O que NUNCA vai para o log: texto de mensagem enviada a lead (só o tamanho e o contactId
// truncado), dados que o lead digitou (nome, telefone, cargo) e senhas. De um corpo desconhecido
// só saem: os nomes dos campos, os escalares que a rota declara seguros e o tamanho dos textos.

const METODOS_DE_LEITURA = new Set(['GET', 'HEAD', 'OPTIONS']);

// Chaves cujo valor nunca vai para o log, mesmo que a rota o declare.
const CHAVE_SENSIVEL = /senha|password|token|segredo|cpf|telefone|fone|whatsapp|celular|e-?mail/i;

// { campos: [...nomes], booleanos e números, textos curtos declarados, tamanhos: { campo: n } } —
// nunca o texto livre. Listas viram só a quantidade (n_<campo>).
export function resumoDoCorpo(corpo, escalares = []) {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return {};
  const resumo = { campos: Object.keys(corpo).sort() };
  const tamanhos = {};
  for (const [chave, valor] of Object.entries(corpo)) {
    if (CHAVE_SENSIVEL.test(chave)) continue;
    if (typeof valor === 'boolean' || (typeof valor === 'number' && Number.isFinite(valor))) resumo[chave] = valor;
    else if (Array.isArray(valor)) resumo[`n_${chave}`] = valor.length;
    else if (typeof valor === 'string' && valor.length) {
      if (escalares.includes(chave) && valor.length <= 200) resumo[chave] = valor;
      else tamanhos[chave] = valor.length;
    }
  }
  if (Object.keys(tamanhos).length) resumo.tamanhos = tamanhos;
  return resumo;
}

// `rotas`: { 'POST /:id/aprovar': { acao, entidade, escalares? } } — a chave é o método + o padrão
// da rota do Express (req.route.path). Sem entrada, cai na ação genérica.
export function auditarEscritasProxy(rotas, { entidadePadrao = 'estimativa' } = {}) {
  return (req, res, next) => {
    if (METODOS_DE_LEITURA.has(req.method)) return next();
    res.on('finish', () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      const padrao = req.route?.path ?? '';
      const regra = rotas[`${req.method} ${padrao}`] || {
        acao: `camila_${req.method.toLowerCase()}`,
        entidade: entidadePadrao,
      };
      const { id, contactId, ...outros } = req.params || {};
      registrarAuditoria({
        usuarioId: req.user?.id,
        acao: regra.acao,
        entidade: regra.entidade || entidadePadrao,
        entidadeId: id, // id que não for UUID vai para valor_depois.entidade_ref (ver registrarAuditoria)
        valorDepois: {
          ...(regra.acao.startsWith('camila_') ? { rota: padrao } : {}),
          ...(contactId ? { contato: idCurto(contactId) } : {}),
          ...Object.fromEntries(Object.entries(outros).map(([k, v]) => [k, String(v).slice(0, 60)])),
          ...resumoDoCorpo(req.body, regra.escalares),
          http: res.statusCode,
        },
        ip: req._ip,
      }).catch(() => {});
    });
    next();
  };
}
