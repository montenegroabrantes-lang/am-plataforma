// /api/comunicacao — localizar cliente e enviar WhatsApp pelo Digisac (09/10/2026).
//
// Acesso: autenticar (index.js) → apenasMaster → exigirEscopo('comunicacao'). Uma sessão Master do
// AM entra; o conector Claude só entra se o Master marcou "Contato com clientes (WhatsApp)" ao
// autorizar. Motivo: cobrar o contador judicial depois do pagamento da RPV pelo chat, sem copiar e
// colar no Digisac.
//
// Regras: telefone sai sempre mascarado; processo restrito só para o Master 01 (S-21); cada
// consulta e cada envio vão para logs_auditoria (o texto não — só o tamanho e o hash); o mesmo
// texto ao mesmo destino nas últimas 24h é recusado (409) salvo `reenviar: true`.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { createHash } from 'node:crypto';
import { apenasMaster, exigirEscopo } from '../middleware/auth.js';
import { registrarAuditoria } from '../middleware/auditoria.js';
import { db } from '../db/index.js';
import { uuidValido } from '../utils/validacao.js';
import { filtroVisibilidade, usuarioVeVisibilidade } from '../utils/visibilidade.js';
import {
  buscarContatosPorNome, enviarMensagemCliente, mascararTelefone, contatoIdValido,
} from '../services/digisac/index.js';

export const TEXTO_MAX = 4000;
export const ACAO_ENVIO = 'enviar_whatsapp_cliente';

export const SQL_PROCESSO_POR_NUMERO = (user) => `
  SELECT p.id AS processo_id, p.numero, p.status, p.situacao_atual, p.vara, p.visibilidade,
         c.id AS cliente_id, c.nome AS cliente_nome, c.whatsapp, c.digisac_contact_id
    FROM processos p
    LEFT JOIN clientes c ON c.id = p.cliente_id
   WHERE REGEXP_REPLACE(p.numero, '\\D', '', 'g') = $1 ${filtroVisibilidade(user)}
   ORDER BY p.criado_em DESC
   LIMIT 10`;

export const SQL_CLIENTES_POR_NOME = `
  SELECT c.id AS cliente_id, c.nome AS cliente_nome, c.whatsapp, c.digisac_contact_id
    FROM clientes c
   WHERE c.ativo = true AND c.nome ILIKE $1
   ORDER BY c.nome
   LIMIT 10`;

export const SQL_CLIENTE = 'SELECT id, nome, whatsapp, digisac_contact_id FROM clientes WHERE id = $1';

// Vincula o contato do Digisac ao cliente depois de um envio que SAIU por esse contato. Só preenche
// vínculo vazio — nunca troca um vínculo existente por aqui.
export const SQL_VINCULAR_CONTATO = `
  UPDATE clientes SET digisac_contact_id = $1
   WHERE id = $2 AND (digisac_contact_id IS NULL OR digisac_contact_id = '')`;

export const SQL_ENVIO_RECENTE = `
  SELECT 1 AS existe FROM logs_auditoria
   WHERE acao = '${ACAO_ENVIO}' AND valor_depois->>'chave' = $1
     AND valor_depois->>'status' IN ('enviado', 'incerto')
     AND criado_em > NOW() - INTERVAL '24 hours'
   LIMIT 1`;

const digitos = v => String(v ?? '').replace(/\D/g, '');

// "%joseane%santos%" a partir de "Joseane Dias Santos": casa o nome com abreviações no meio.
function padraoNome(nome) {
  const palavras = String(nome ?? '').trim().split(/\s+/).filter(p => p.length > 1).slice(0, 6);
  return palavras.length ? `%${palavras.map(p => p.replace(/[%_\\]/g, '')).join('%')}%` : null;
}

function limitadorEnvio() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, erro: 'Limite de envios atingido (30 a cada 15 min). Aguarde alguns minutos.' },
  });
}

export function criarComunicacaoRouter({
  banco = db,
  auditar = registrarAuditoria,
  buscarContatos = buscarContatosPorNome,
  enviar = enviarMensagemCliente,
  limitador = limitadorEnvio(),
} = {}) {
  const router = Router();
  router.use(apenasMaster, exigirEscopo('comunicacao'));

  const viaConector = req => ({ via_conector: Array.isArray(req.user.escopos), autorizado_por: req.user.autorizado_por ?? null });

  // Candidatos do Digisac só quando o AM não tem o número; falha do Digisac não derruba a consulta.
  async function contatosDigisac(nome) {
    try {
      return { candidatos: await buscarContatos(nome) };
    } catch (err) {
      return { candidatos: [], erro: err.status === 503 ? 'Digisac não configurado.' : 'Não foi possível consultar o Digisac agora.' };
    }
  }

  async function descreverCliente(linha) {
    const temWhatsapp = Boolean(linha.whatsapp && digitos(linha.whatsapp).length >= 10);
    const vinculado = contatoIdValido(linha.digisac_contact_id) ? linha.digisac_contact_id : null;
    const saida = {
      cliente_id: linha.cliente_id ?? null,
      cliente_nome: linha.cliente_nome ?? null,
      whatsapp_cadastro: temWhatsapp ? mascararTelefone(linha.whatsapp) : null,
      contato_digisac_vinculado: vinculado,
    };
    // Sem número e sem vínculo: candidatos por nome (o vínculo nasce no primeiro envio confirmado).
    if (!temWhatsapp && !vinculado && linha.cliente_nome) {
      const { candidatos, erro } = await contatosDigisac(linha.cliente_nome);
      saida.contatos_digisac = candidatos;
      if (erro) saida.erro_digisac = erro;
    }
    return saida;
  }

  // GET /api/comunicacao/localizar?processo=0809017-10.2024.8.15.2001  ou  ?nome=Joseane Dias Santos
  router.get('/localizar', async (req, res) => {
    const numero = digitos(req.query.processo);
    const nome = String(req.query.nome ?? '').trim().slice(0, 120);
    if (!numero && !nome) return res.status(400).json({ ok: false, erro: 'Informe processo (número CNJ) ou nome.' });
    if (numero && numero.length !== 20) return res.status(400).json({ ok: false, erro: 'Número de processo deve ter os 20 dígitos do CNJ.' });

    const resultado = { ok: true, processos: [], clientes: [], contatos_digisac: [] };
    if (numero) {
      const linhas = await banco.query(SQL_PROCESSO_POR_NUMERO(req.user), [numero]);
      for (const l of linhas) {
        resultado.processos.push({
          processo_id: l.processo_id, numero: l.numero, status: l.status, situacao_atual: l.situacao_atual, vara: l.vara,
          ...(await descreverCliente(l)),
        });
      }
    }
    if (nome) {
      const padrao = padraoNome(nome);
      const linhas = padrao ? await banco.query(SQL_CLIENTES_POR_NOME, [padrao]) : [];
      for (const l of linhas) resultado.clientes.push(await descreverCliente(l));
      if (!linhas.length) {
        const { candidatos, erro } = await contatosDigisac(nome);
        resultado.contatos_digisac = candidatos;
        if (erro) resultado.erro_digisac = erro;
      }
    }
    if (numero && !resultado.processos.length) {
      resultado.aviso = 'Processo não cadastrado no AM. Tente pelo nome do cliente (parâmetro nome).';
    }

    await auditar({
      usuarioId: req.user.id, acao: 'localizar_cliente_comunicacao', entidade: 'cliente',
      valorDepois: {
        processo: numero || null, nome: nome || null,
        processos: resultado.processos.length, clientes: resultado.clientes.length, ...viaConector(req),
      },
      ip: req._ip,
    });
    res.json(resultado);
  });

  // POST /api/comunicacao/enviar  { cliente_id?, contato_digisac_id?, processo_id?, texto, reenviar? }
  // Destino: o WhatsApp do cadastro do cliente; sem ele, o contato do Digisac vinculado ao cliente
  // (clientes.digisac_contact_id) ou o indicado. O indicado é vinculado ao cliente após envio confirmado.
  router.post('/enviar', limitador, async (req, res) => {
    const { cliente_id: clienteId, contato_digisac_id: contatoId, processo_id: processoId, reenviar } = req.body ?? {};
    const texto = typeof req.body?.texto === 'string' ? req.body.texto.trim() : '';
    if (!texto) return res.status(400).json({ ok: false, erro: 'texto é obrigatório.' });
    if (texto.length > TEXTO_MAX) return res.status(400).json({ ok: false, erro: `texto passa de ${TEXTO_MAX} caracteres.` });
    if (!clienteId && !contatoId) return res.status(400).json({ ok: false, erro: 'Informe cliente_id ou contato_digisac_id.' });
    if (clienteId && !uuidValido(clienteId)) return res.status(400).json({ ok: false, erro: 'cliente_id inválido.' });
    if (contatoId && !contatoIdValido(contatoId)) return res.status(400).json({ ok: false, erro: 'contato_digisac_id inválido.' });
    if (processoId && !uuidValido(processoId)) return res.status(400).json({ ok: false, erro: 'processo_id inválido.' });

    if (processoId) {
      const p = await banco.queryOne('SELECT visibilidade, cliente_id FROM processos WHERE id = $1', [processoId]);
      if (!p || !usuarioVeVisibilidade(req.user, p.visibilidade)) return res.status(404).json({ ok: false, erro: 'Processo não encontrado.' });
      if (clienteId && p.cliente_id && p.cliente_id !== clienteId) {
        return res.status(422).json({ ok: false, erro: 'O processo informado é de outro cliente.' });
      }
    }

    let cliente = null;
    if (clienteId) {
      cliente = await banco.queryOne(SQL_CLIENTE, [clienteId]);
      if (!cliente) return res.status(404).json({ ok: false, erro: 'Cliente não encontrado.' });
    }
    const numero = cliente?.whatsapp && digitos(cliente.whatsapp).length >= 10 ? cliente.whatsapp : null;
    const vinculado = contatoIdValido(cliente?.digisac_contact_id) ? cliente.digisac_contact_id : null;
    if (!numero && vinculado && contatoId && contatoId !== vinculado) {
      return res.status(422).json({
        ok: false, erro: 'O cliente já está vinculado a outro contato do Digisac. Confira o contato; o vínculo só se troca pelo cadastro do cliente.',
      });
    }
    const contato = numero ? null : (contatoId || vinculado);
    if (!numero && !contato) {
      return res.status(422).json({
        ok: false, erro: 'O cliente não tem WhatsApp no cadastro do AM. Use localizar_cliente para achar o contato no Digisac e informe contato_digisac_id.',
      });
    }

    const destinoRef = numero ? `n:${digitos(numero).slice(-11)}` : `c:${contato}`;
    const chave = createHash('sha256').update(`${destinoRef}|${texto}`).digest('hex');
    if (!reenviar && await banco.queryOne(SQL_ENVIO_RECENTE, [chave])) {
      return res.status(409).json({ ok: false, erro: 'Esta mesma mensagem já foi enviada a este destino nas últimas 24h. Para mandar de novo, use reenviar: true.' });
    }

    const r = await enviar({ numero, contatoId: contato, texto, usuarioId: req.user.id });
    const status = r.ok ? 'enviado' : (r.antesEnvio ? 'falhou' : 'incerto');

    // Envio confirmado por um contato escolhido agora → fica vinculado ao cliente.
    let vinculouContato = false;
    if (r.ok && cliente && contato && !vinculado) {
      try {
        await banco.execute(SQL_VINCULAR_CONTATO, [contato, cliente.id]);
        vinculouContato = true;
      } catch (err) {
        console.error('[comunicacao] Falha ao vincular o contato do Digisac ao cliente:', err.message);
      }
    }

    await auditar({
      usuarioId: req.user.id, acao: ACAO_ENVIO, entidade: 'cliente', entidadeId: cliente?.id ?? null,
      valorDepois: {
        status, chave, destino: r.destino ?? null, message_id: r.messageId ?? null, processo_id: processoId ?? null,
        contato_digisac_id: contato, contato_vinculado_ao_cliente: vinculouContato,
        caracteres: texto.length, erro: r.erro ?? null, ...viaConector(req),
      },
      ip: req._ip,
    });

    const corpo = {
      ok: r.ok, status, destino: r.destino ?? null, cliente_nome: cliente?.nome ?? null, message_id: r.messageId ?? null,
      contato_digisac_vinculado: vinculouContato || (contato && contato === vinculado) ? contato : null,
    };
    if (!r.ok) {
      corpo.erro = r.erro;
      corpo.pode_tentar_de_novo = Boolean(r.antesEnvio);
    }
    res.status(r.ok ? 200 : (r.antesEnvio ? 502 : 504)).json(corpo);
  });

  return router;
}

export const comunicacaoRouter = criarComunicacaoRouter();
