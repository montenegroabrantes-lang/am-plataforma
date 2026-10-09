import axios from 'axios';
import { randomUUID } from 'node:crypto';
import { db } from '../../db/index.js';
import { decrypt } from '../../utils/crypto.js';

function client() {
  const token  = process.env.DIGISAC_TOKEN;
  const apiUrl = process.env.DIGISAC_API_URL;
  if (!token || !apiUrl || token === 'configurar_no_railway') return null;

  return axios.create({
    baseURL: apiUrl,
    headers: { Authorization: `Bearer ${token}` },
    timeout: 15_000,
  });
}

// Busca atendimentos recentes (últimas 24h por padrão)
export async function buscarAtendimentos(horas = 24) {
  const api = client();
  if (!api) return [];

  const desde = new Date(Date.now() - horas * 3600 * 1000).toISOString();

  try {
    const resp = await api.get('/tickets', {
      params: { updatedAfter: desde, limit: 100 },
    });
    return resp.data?.data || resp.data || [];
  } catch (err) {
    console.error('[Digisac] Erro ao buscar atendimentos:', err.message);
    return [];
  }
}

// Histórico completo de um contato (todos os tickets), pro painel de conversa do AM.
// Verificado ao vivo em 23/09/2026: GET /messages?where[contactId]=…&page=N responde com
// { data, total, limit, skip, currentPage, lastPage }. A armadilha documentada (memória e
// digisac.js da Camila): sem o `where[...]` o Digisac devolve mensagens de OUTROS contatos —
// por isso o filtro vai no `where` E cada mensagem é conferida de novo em JS antes de sair.
// Lança em erro (quem chama decide o que mostrar); páginas são lidas da mais recente pra
// mais antiga e o resultado sai em ordem cronológica.
export async function buscarConversaContato(contactId, { paginas = 3, limite = 100 } = {}) {
  const api = client();
  if (!api) throw Object.assign(new Error('Digisac não configurado.'), { status: 503 });

  const mensagens = [];
  let total = 0, lastPage = 1, lidas = 0;
  for (let page = 1; page <= paginas; page++) {
    // include=file: sem isto a listagem vem sem o objeto `file` (nome/url do anexo) — o mesmo
    // parâmetro que a Camila usa em GET /messages/:id (digisac.js:164). Confirmado na lista.
    const resp = await api.get('/messages', {
      params: { 'where[contactId]': contactId, page, limit: limite, include: 'file' },
    });
    const lote = resp.data?.data || [];
    lidas = page;
    total = Number(resp.data?.total ?? total) || total;
    lastPage = Number(resp.data?.lastPage ?? lastPage) || lastPage;
    for (const m of lote) if (m && m.contactId === contactId) mensagens.push(m);
    if (!lote.length || page >= lastPage) break;
  }
  mensagens.sort((a, b) => new Date(a.timestamp || a.createdAt) - new Date(b.timestamp || b.createdAt));
  return { mensagens, total, paginasLidas: lidas, temMais: lidas < lastPage };
}

// Nome dos usuários do Digisac (4 no escritório) pra rotular quem falou; cache de 10 min em
// memória — muda raramente e é uma chamada a menos por conversa aberta.
let usuariosCache = { em: 0, mapa: new Map() };
export async function mapaUsuariosDigisac() {
  const api = client();
  if (!api) return new Map();
  if (Date.now() - usuariosCache.em < 10 * 60_000 && usuariosCache.mapa.size) return usuariosCache.mapa;
  try {
    const resp = await api.get('/users', { params: { limit: 100 } });
    const lista = resp.data?.data || resp.data || [];
    usuariosCache = { em: Date.now(), mapa: new Map(lista.map(u => [u.id, u.name || u.email || 'Usuário'])) };
  } catch (err) {
    console.warn('[Digisac] Não deu pra listar usuários:', err.message);
  }
  return usuariosCache.mapa;
}

// Salva eventos Digisac no banco (cache local)
export async function sincronizarEventosSAC() {
  const atendimentos = await buscarAtendimentos(48);

  let salvos = 0;
  for (const ticket of atendimentos) {
    const tipo = classificarTipo(ticket);

    // Tenta associar a um lead ou cliente pelo WhatsApp
    const contato = ticket.contact?.phone?.replace(/\D/g, '');
    const lead    = contato ? await db.queryOne(
      `SELECT id FROM leads WHERE REPLACE(whatsapp, '+','') LIKE '%' || $1`, [contato.slice(-9)]
    ) : null;

    try {
      await db.execute(
        `INSERT INTO eventos_sac (tipo, lead_id, payload, criado_em)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [tipo, lead?.id || null, JSON.stringify(ticket), new Date(ticket.updatedAt || ticket.createdAt)]
      );
      salvos++;
    } catch { /* ignora duplicata */ }
  }

  return salvos;
}

// Cria (ou reaproveita, se já existir) o contato do Digisac pro número informado — documentação
// oficial: POST /api/v1/contacts, campos internalName/number/serviceId/defaultDepartmentId.
// Idempotente por design: busca antes de criar (mesma conexão/serviceId), pra nunca duplicar
// contato a cada novo cadastro ou edição do mesmo cliente. Nunca lança — cadastro de cliente
// não pode falhar por causa do Digisac, mesmo estilo do resto deste arquivo (enviarAlerta) e
// da criação de pasta no Drive.
export async function criarOuBuscarContato(numero, nome) {
  const api = client();
  const serviceId = process.env.DIGISAC_SERVICE_ID;
  if (!api || !serviceId) {
    console.warn('[Digisac] criarOuBuscarContato ignorado — Digisac ou DIGISAC_SERVICE_ID não configurados.');
    return null;
  }

  const phone = String(numero || '').replace(/\D/g, '');
  if (phone.length < 10) {
    console.warn(`[Digisac] criarOuBuscarContato: número inválido — ${mascararTelefone(numero)}`);
    return null;
  }
  const numeroCompleto = phone.startsWith('55') ? phone : `55${phone}`;

  try {
    // Achado do revisor: a documentação oficial usa $iLike com wildcards (%numero%) pro
    // exemplo de busca por número, mas isso casa por SUBSTRING — um número de 13 dígitos
    // pode ser prefixo/sufixo literal de outro (ex.: dado legado sem o 9º dígito, ou DDD
    // gravado errado antes de alguma normalização). Sem wildcard nenhum, $iLike ainda
    // funciona (é só case-insensitive), mas passa a exigir igualdade exata da string
    // completa. Confirma de novo em JS, contra o campo bruto da resposta, como segunda
    // camada — nunca reaproveita um contato cujo número não bate exatamente.
    const busca = await api.get('/contacts', {
      params: { 'where[data.number][$iLike]': numeroCompleto, 'where[serviceId]': serviceId },
    });
    const candidatos = busca.data?.data || busca.data || [];
    const existente = candidatos.find(c => String(c?.data?.number || '').replace(/\D/g, '') === numeroCompleto);
    if (existente?.id) return existente.id;

    const criado = await api.post('/contacts', {
      internalName: nome || numeroCompleto,
      number: numeroCompleto,
      serviceId,
      defaultDepartmentId: null,
    });
    const contatoId = criado.data?.id || criado.data?.data?.id || null;
    if (contatoId) console.log(`[Digisac] Contato criado para ${mascararTelefone(numeroCompleto)}: ${contatoId}`);
    return contatoId;
  } catch (err) {
    console.error('[Digisac] Erro ao criar/buscar contato:', textoErroSeguro(err)); // o corpo do erro pode ecoar o telefone
    return null;
  }
}

// Normaliza o número do usuário pro formato do campo `number` do Digisac: 55 + DDD + número,
// só dígitos. Devolve null se não parecer um telefone brasileiro (10/11 dígitos, ou 12/13 já
// com 55). O teste antigo era "começa com 55", que tratava um celular do DDD 55 (RS) sem o
// código do país (11 dígitos) como se já tivesse — e mandava pro número errado.
export function normalizarNumeroWhatsapp(numero) {
  const digitos = String(numero ?? '').replace(/\D/g, '');
  // DDD não começa com 0: "0 83 ..." (fixo com o 0 do tronco) viraria um número errado.
  if ((digitos.length === 10 || digitos.length === 11) && digitos[0] !== '0') return `55${digitos}`;
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55') && digitos[2] !== '0') return digitos;
  return null;
}

// Telefone é dado pessoal: nunca vai inteiro pro log nem pro registro de envios.
// "+55 83 9****-1234" (celular) ou "+55 83 ****-1234" (fixo/8 dígitos); lixo vira "***".
export function mascararTelefone(numero) {
  const digitos = String(numero ?? '').replace(/\D/g, '');
  if (digitos.length < 8) return '***';
  const ultimos = digitos.slice(-4);
  const completo = normalizarNumeroWhatsapp(digitos);
  if (!completo) return `****-${ultimos}`;
  const local = completo.slice(4);
  return `+55 ${completo.slice(2, 4)} ${local.length === 9 ? local[0] : ''}****-${ultimos}`;
}

// "Antes do envio" = o Digisac certamente NÃO entregou a mensagem, então tentar de novo não
// duplica: sem conexão com a API, requisição recusada (4xx, exceto 408) ou "service
// disconnected" (mesmo critério de classificarErroEnvio da Camila). Timeout, conexão
// derrubada no meio e 5xx são INCERTOS: a mensagem pode ter saído.
export function classificarFalhaEnvio(err) {
  const status = err?.response?.status;
  const corpo = JSON.stringify(err?.response?.data ?? '');
  const desconectado = Boolean(err?.response) && /service[^\n]*disconnected|servi[cç]o[^\n]*desconectad/i.test(corpo);
  const semConexao = ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(err?.code);
  const recusada = status >= 400 && status < 500 && status !== 408;
  return { antesEnvio: desconectado || semConexao || recusada };
}

// Texto de erro pro log e pro registro: o corpo da resposta do Digisac pode ecoar o payload,
// então qualquer sequência longa de dígitos (telefone) é trocada antes de sair daqui.
function textoErroSeguro(err) {
  const status = err?.response?.status;
  let detalhe = err?.response?.data;
  if (detalhe && typeof detalhe !== 'string') {
    try { detalhe = JSON.stringify(detalhe); } catch { detalhe = ''; }
  }
  return [status ? `HTTP ${status}` : null, detalhe || err?.message].filter(Boolean).join(': ')
    .replace(/\+?\d[\d\s().-]{8,}\d/g, '[número]')
    .slice(0, 300);
}

// Registra cada tentativa de envio em notificacoes_whatsapp (R-05): quem, quando, se saiu e o
// messageId do Digisac. Guarda só o destino mascarado e o rótulo da origem — nunca o texto da
// mensagem (A5-22: a tabela guarda ids, não conteúdo). Nunca lança: o registro não pode
// derrubar o alerta nem o fluxo que está avisando.
export async function registrarEnvioWhatsapp(
  { tipo, origem = null, usuarioId = null, destino, status, messageId = null, erro = null },
  banco = db
) {
  try {
    await banco.execute(
      `INSERT INTO notificacoes_whatsapp
         (tipo, origem, usuario_id, destino_mascarado, chave, status, tentativas, digisac_message_id, erro, enviado_em)
       VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, $9)`,
      [tipo, origem, usuarioId, destino, `${tipo}:${randomUUID()}`, status, messageId, erro,
        status === 'enviado' ? new Date() : null]
    );
  } catch (err) {
    console.warn('[Digisac] Não deu pra registrar o envio em notificacoes_whatsapp:', err.message);
  }
}

// Envia mensagem de texto via Digisac → WhatsApp do destinatário.
//
// R-05 (30/09/2026): o payload antigo mandava `contactPhone`, campo que a documentação do
// Digisac não traz e que a Camila (com envio comprovado em produção) nunca usou — ela manda
// `number`. Hipótese forte: nenhum aviso do AM chegou a alguém. Agora vai `number`, com
// origin:'bot' e dontOpenTicket:true (não abre chamado na fila de atendimento).
//
// Nunca lança (alerta falhando não pode derrubar quem está avisando), mas AGORA devolve o
// resultado em vez de true/false: { ok, messageId, erro, antesEnvio }. Quem chama decide o
// que fazer com a falha; `antesEnvio` diz se é seguro tentar de novo (ver classificarFalhaEnvio).
// Toda tentativa fica em notificacoes_whatsapp. `api` e `registrar` são injetáveis pra teste.
export async function enviarAlerta(numero, texto, {
  tipo = 'alerta_tecnico', origem = null, usuarioId = null,
  api = client(), registrar = registrarEnvioWhatsapp,
} = {}) {
  const destino = mascararTelefone(numero);
  const concluir = async (resultado, status) => {
    try {
      await registrar({ tipo, origem, usuarioId, destino, status, messageId: resultado.messageId, erro: resultado.erro });
    } catch (err) {
      console.warn('[Digisac] Falha ao registrar o envio:', err.message);
    }
    return resultado;
  };
  const falha = (erro, antesEnvio) => ({ ok: false, messageId: null, erro, antesEnvio });

  try {
    const serviceId = process.env.DIGISAC_SERVICE_ID;
    if (!api || !serviceId) {
      console.warn('[Digisac] enviarAlerta ignorado — Digisac ou DIGISAC_SERVICE_ID não configurados.');
      return await concluir(falha('Digisac não configurado.', true), 'falhou');
    }

    const completo = normalizarNumeroWhatsapp(numero);
    if (!completo) {
      console.warn(`[Digisac] enviarAlerta: número inválido — ${destino}`);
      return await concluir(falha('Número de WhatsApp inválido.', true), 'sem_numero');
    }

    try {
      const resp = await api.post('/messages', {
        serviceId,
        number: completo,
        type: 'text',
        text: texto,
        origin: 'bot',
        dontOpenTicket: true,
      });
      const messageId = resp?.data?.id ?? resp?.data?.data?.id ?? null;
      console.log(`[Digisac] Alerta enviado para ${destino} (messageId ${messageId ?? 'n/d'})`);
      return await concluir({ ok: true, messageId, erro: null, antesEnvio: false }, 'enviado');
    } catch (err) {
      const { antesEnvio } = classificarFalhaEnvio(err);
      const erro = textoErroSeguro(err);
      console.error(`[Digisac] Falha ao enviar alerta para ${destino} (${antesEnvio ? 'não enviado' : 'resultado incerto'}): ${erro}`);
      return await concluir(falha(erro, antesEnvio), antesEnvio ? 'falhou' : 'incerto');
    }
  } catch (err) {
    // Rede de segurança: nada acima deveria lançar, mas o contrato é "nunca lança".
    console.error(`[Digisac] enviarAlerta: erro inesperado para ${destino}:`, err.message);
    return falha(`Erro inesperado: ${err.message}`.slice(0, 300), false);
  }
}

// Contatos do Digisac cujo nome contém todas as palavras de `nome` (sem acento/caixa). Usado
// quando o cadastro do AM não tem o WhatsApp do cliente (09/10/2026: só ~22 de 404 têm). A busca
// na API vai pelo primeiro e pelo último nome (`$iLike`, campos name e internalName) e a
// conferência das palavras é refeita aqui. Número sai só mascarado. Lança em erro de API.
const ID_CONTATO_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const contatoIdValido = id => ID_CONTATO_RE.test(String(id ?? ''));

const semAcento = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const PARTICULAS = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);

export async function buscarContatosPorNome(nome, { api = client(), limite = 10 } = {}) {
  if (!api) throw Object.assign(new Error('Digisac não configurado.'), { status: 503 });
  const palavras = semAcento(nome).split(/\s+/).filter(p => p.length > 1 && !PARTICULAS.has(p));
  if (!palavras.length) return [];
  const termo = palavras.length > 1 ? `%${palavras[0]}%${palavras.at(-1)}%` : `%${palavras[0]}%`;
  const serviceId = process.env.DIGISAC_SERVICE_ID;

  const vistos = new Map();
  for (const campo of ['name', 'internalName']) {
    const params = { [`where[${campo}][$iLike]`]: termo, limit: 50 };
    if (serviceId) params['where[serviceId]'] = serviceId;
    const resp = await api.get('/contacts', { params });
    for (const c of resp.data?.data || resp.data || []) {
      if (!c?.id || vistos.has(c.id)) continue;
      const nomes = semAcento(`${c.name ?? ''} ${c.internalName ?? ''}`);
      if (!palavras.every(p => nomes.includes(p))) continue;
      vistos.set(c.id, {
        contato_id: c.id,
        nome: c.internalName || c.name || null,
        nome_whatsapp: c.name || null,
        numero_mascarado: mascararTelefone(c?.data?.number),
      });
    }
  }
  return [...vistos.values()].slice(0, limite);
}

// Mensagem a CLIENTE (cobrança, aviso), pedida por um Master. Diferente de enviarAlerta: aceita
// o contato do Digisac (contactId) quando o AM não tem o número, e não usa dontOpenTicket — a
// resposta do cliente precisa aparecer num chamado. Nunca lança; devolve o mesmo formato de
// enviarAlerta e registra a tentativa em notificacoes_whatsapp (sem o texto).
export async function enviarMensagemCliente({ numero = null, contatoId = null, texto, usuarioId = null, origem = 'conector_claude' }, {
  api = client(), registrar = registrarEnvioWhatsapp,
} = {}) {
  const destino = contatoId && !numero ? `contato ${String(contatoId).slice(0, 8)}…` : mascararTelefone(numero);
  const concluir = async (resultado, status) => {
    try {
      await registrar({ tipo: 'mensagem_cliente', origem, usuarioId, destino, status, messageId: resultado.messageId, erro: resultado.erro });
    } catch (err) {
      console.warn('[Digisac] Falha ao registrar o envio:', err.message);
    }
    return { ...resultado, destino };
  };
  const falha = (erro, antesEnvio) => ({ ok: false, messageId: null, erro, antesEnvio });

  try {
    const serviceId = process.env.DIGISAC_SERVICE_ID;
    if (!api || !serviceId) return await concluir(falha('Digisac não configurado.', true), 'falhou');

    const corpo = { type: 'text', text: texto, origin: 'bot' };
    if (numero) {
      const completo = normalizarNumeroWhatsapp(numero);
      if (!completo) return await concluir(falha('Número de WhatsApp inválido.', true), 'sem_numero');
      Object.assign(corpo, { serviceId, number: completo });
    } else if (contatoIdValido(contatoId)) {
      corpo.contactId = contatoId;
    } else {
      return await concluir(falha('Sem número nem contato do Digisac.', true), 'sem_numero');
    }

    try {
      const resp = await api.post('/messages', corpo);
      const messageId = resp?.data?.id ?? resp?.data?.data?.id ?? null;
      console.log(`[Digisac] Mensagem a cliente enviada para ${destino} (messageId ${messageId ?? 'n/d'})`);
      return await concluir({ ok: true, messageId, erro: null, antesEnvio: false }, 'enviado');
    } catch (err) {
      const { antesEnvio } = classificarFalhaEnvio(err);
      const erro = textoErroSeguro(err);
      console.error(`[Digisac] Falha ao enviar mensagem a ${destino} (${antesEnvio ? 'não enviada' : 'resultado incerto'}): ${erro}`);
      return await concluir(falha(erro, antesEnvio), antesEnvio ? 'falhou' : 'incerto');
    }
  } catch (err) {
    console.error(`[Digisac] enviarMensagemCliente: erro inesperado para ${destino}:`, err.message);
    return { ...falha(`Erro inesperado: ${err.message}`.slice(0, 300), false), destino };
  }
}

function classificarTipo(ticket) {
  const status = ticket.status?.toLowerCase() || '';
  const tags   = (ticket.tags || []).map(t => t.toLowerCase());

  if (tags.includes('proposta') || tags.includes('proposta_enviada')) return 'proposta_enviada';
  if (tags.includes('doc') || tags.includes('documento'))             return 'doc_recebido';
  if (tags.includes('qualificado') || tags.includes('lead'))          return 'lead_qualificado';
  if (status === 'resolved' || status === 'closed')                   return 'atendimento';
  return 'atendimento';
}
