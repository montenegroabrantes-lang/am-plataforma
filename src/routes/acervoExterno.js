import { Router } from 'express';
import { acervoRouter } from './acervo.js';

// Acervo jurídico pela chave de integração externa (X-AM-API-Key), 23/11/2026.
// Montado em /api/integracoes/v1/acervo, DEPOIS de autenticarChaveExterna.
//
// - acervo_leitura: listar/buscar, ler peça ou precedente, catálogo de teses.
// - acervo_edicao: criar e editar teses, peças e precedentes; registrar resultado; conferir precedente.
// Fica de fora de propósito: Drive, prazos, protocolos, contexto do processo, arquivar/restaurar
// e qualquer registro de processo restrito (a chave nunca vê "restrito").
const ID = '[0-9a-fA-F-]{36}';
const SLUG = '[a-z0-9-]{1,80}';
const LEITURA = [
  new RegExp('^/$'),
  new RegExp('^/teses$'),
  new RegExp(`^/(pecas|precedentes)/${ID}$`),
];
const EDICAO = {
  POST: [new RegExp('^/(pecas|precedentes|teses)$')],
  PATCH: [
    new RegExp(`^/(pecas|precedentes)/${ID}$`),
    new RegExp(`^/pecas/${ID}/resultado$`),
    new RegExp(`^/precedentes/${ID}/conferir$`),
    new RegExp(`^/teses/${SLUG}$`),
  ],
};

export function permissaoNecessaria(metodo, caminho) {
  if (metodo === 'GET') return LEITURA.some(r => r.test(caminho)) ? 'acervo_leitura' : null;
  return (EDICAO[metodo] || []).some(r => r.test(caminho)) ? 'acervo_edicao' : null;
}

export const acervoExternoRouter = Router();

acervoExternoRouter.use((req, res, next) => {
  const caminho = req.path.replace(/\/+$/, '') || '/';
  const permissao = permissaoNecessaria(req.method, caminho);
  if (!permissao) return res.status(404).json({ ok: false, erro: 'Rota do acervo não disponível para chaves de integração.' });
  const permissoes = req.integracao?.permissoes || [];
  // Quem edita também lê.
  const tem = permissoes.includes(permissao) || (permissao === 'acervo_leitura' && permissoes.includes('acervo_edicao'));
  if (!tem) return res.status(403).json({ ok: false, erro: `Esta chave não possui a permissão “${permissao}”.` });
  // Age como o Master dono da chave, sem acesso a registros restritos; a auditoria leva o id da chave.
  req.user = { id: req.integracao.masterId, perfil: 'master', master_id: null, pode_marcar_restrito: false, via_chave: req.integracao.id };
  next();
}, acervoRouter);
