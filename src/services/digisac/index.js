import axios from 'axios';
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
    console.warn('[Digisac] criarOuBuscarContato: número inválido —', numero);
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
    if (contatoId) console.log(`[Digisac] Contato criado para +${numeroCompleto}: ${contatoId}`);
    return contatoId;
  } catch (err) {
    console.error('[Digisac] Erro ao criar/buscar contato:', err.response?.data || err.message);
    return null;
  }
}

// Envia mensagem de texto via Digisac → WhatsApp do destinatário
export async function enviarAlerta(numero, texto) {
  const api = client();
  if (!api) {
    console.warn('[Digisac] enviarAlerta ignorado — Digisac não configurado.');
    return false;
  }

  const phone = String(numero).replace(/\D/g, '');
  if (phone.length < 10) {
    console.warn('[Digisac] enviarAlerta: número inválido —', numero);
    return false;
  }

  try {
    await api.post('/messages', {
      serviceId:    process.env.DIGISAC_SERVICE_ID,
      contactPhone: phone.startsWith('55') ? phone : `55${phone}`,
      type:         'text',
      text:         texto,
    });
    console.log(`[Digisac] Alerta enviado para +${phone}`);
    return true;
  } catch (err) {
    console.error('[Digisac] Erro ao enviar alerta:', err.message);
    return false;
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
