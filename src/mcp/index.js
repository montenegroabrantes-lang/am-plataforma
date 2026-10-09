// Servidor MCP do AM — expõe como ferramentas as rotas de /api/acervo e, desde 28/09/2026, o
// levantamento de re-protocolo (/api/reprotocolo, somente leitura) e, desde 09/10/2026, o contato
// com clientes por WhatsApp (/api/comunicacao).
// Stateless: uma instância de servidor e transporte por requisição.
// As ferramentas chamam a própria API por HTTP local com o MESMO token, reaproveitando
// validação, perfil (apenasMaster), escopo OAuth (exigirEscopo), visibilidade e auditoria já
// implementados nas rotas — nenhuma regra de acesso é reimplementada aqui.
import { Router } from 'express';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { autenticar } from '../middleware/auth.js';
import { urlHttpsOuNulo } from '../utils/validacao.js';
import { somenteBearer } from '../middleware/somenteBearer.js';

export const mcpRouter = Router();

const BASE = `http://127.0.0.1:${process.env.PORT || 3001}/api`;

async function chamar(metodo, caminho, token, corpo) {
  const r = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await r.text();
  let dados; try { dados = JSON.parse(texto); } catch { dados = { ok: false, erro: 'resposta-invalida', corpo: texto.slice(0, 500) }; }
  return { status: r.status, dados };
}

const saida = ({ status, dados }) => ({
  content: [{ type: 'text', text: JSON.stringify({ http: status, ...dados }, null, 2) }],
  isError: status >= 400,
});

// Para respostas grandes (re-protocolo): tira só o que não carrega informação — null e listas
// vazias; false e 0 ficam (ex.: pasta_drive_vinculada:false, meses_mais_5_anos:0 importam).
export function enxugar(valor) {
  if (Array.isArray(valor)) return valor.map(enxugar);
  if (valor && typeof valor === 'object') {
    const limpo = {};
    for (const [k, v] of Object.entries(valor)) {
      if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) continue;
      limpo[k] = enxugar(v);
    }
    return limpo;
  }
  return valor;
}

const saidaCompacta = ({ status, dados }) => ({
  content: [{ type: 'text', text: JSON.stringify(enxugar({ http: status, ...dados })) }],
  isError: status >= 400,
});

const qs = o => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.append(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

// S-23: links gravados no acervo só https:// (a rota do acervo também confere e devolve 422).
// Nos campos opcionais, texto vazio segue valendo como "sem link".
const urlHttpsObrigatoria = z.string().url().refine(v => urlHttpsOuNulo(v) !== null, { message: 'Use um endereço que comece com https://' });
const urlHttpsOpcional = z.string().refine(v => v.trim() === '' || urlHttpsOuNulo(v) !== null, { message: 'Use um endereço que comece com https://' }).optional();

const ENTES = ['municipio-joao-pessoa','estado-paraiba','municipio-outro-pb','estado-pernambuco','estado-espirito-santo','uniao','inss','alpb','particular','outro'];
const INSTANCIAS = ['1grau','2grau','turma-recursal','stj','stf','tre-pb','tse','administrativo'];
const RESULTADOS = ['pendente','procedente','parcialmente-procedente','improcedente','provido','parcialmente-provido','desprovido','nao-conhecido','extinto-sem-merito','acordo','desistencia'];
const TIPOS = ['inicial','emenda-inicial','impugnacao-contestacao','especificacao-provas','recurso-inominado','contrarrazoes','embargos-declaracao','apelacao','agravo','recurso-especial','recurso-extraordinario','memorial','cumprimento-sentenca','alvara','precatorio','cessao-credito','peticao-diversa'];

function construirServidor(token) {
  const s = new McpServer({ name: 'acervo-am-advogados', version: '1.3.0' });

  s.registerTool('listar_teses', {
    title: 'Listar teses do acervo',
    description: 'Lista os slugs de tese válidos do acervo do escritório. Consulte antes de criar peça ou precedente para não usar slug inexistente.',
    inputSchema: {},
  }, async () => saida(await chamar('GET', '/acervo/teses', token)));

  s.registerTool('buscar_acervo', {
    title: 'Buscar no acervo',
    description: 'Consulta peças e precedentes já produzidos pelo escritório, por tese, ente, tribunal, instância e resultado. Use ANTES de redigir qualquer peça, para aproveitar o que já venceu naquela tese.',
    inputSchema: {
      q: z.string().optional().describe('Busca textual em título, processo, cliente, órgão e fundamento'),
      tese: z.string().optional(),
      ente: z.enum(ENTES).optional(),
      tribunal: z.string().optional(),
      instancia: z.enum(INSTANCIAS).optional(),
      resultado: z.enum(RESULTADOS).optional(),
      aba: z.enum(['todos','pecas','precedentes','organizacao']).optional(),
      limite: z.number().int().min(1).max(200).optional(),
    },
  }, async a => saida(await chamar('GET', `/acervo/${qs(a)}`, token)));

  s.registerTool('criar_peca', {
    title: 'Registrar peça no acervo',
    description: 'Registra uma peça processual protocolada. Use ao concluir e protocolar qualquer peça.',
    inputSchema: {
      teses: z.array(z.string()).min(1).describe('Slugs de tese; ao menos um'),
      titulo: z.string(),
      tipo_peca: z.enum(TIPOS),
      ente: z.enum(ENTES),
      ente_detalhe: z.string().optional().describe('Obrigatório quando ente = municipio-outro-pb'),
      instancia: z.enum(INSTANCIAS),
      processo_id: z.string().uuid().optional(),
      processo_numero: z.string().optional(),
      cliente_id: z.string().uuid().optional(),
      cliente_nome: z.string().optional(),
      tribunal: z.string().optional(),
      orgao_julgador: z.string().optional(),
      relator: z.string().optional(),
      data_protocolo: z.string().optional().describe('AAAA-MM-DD'),
      drive_file_id: z.string().optional(),
      drive_url: urlHttpsOpcional,
      resultado: z.enum(RESULTADOS).optional(),
      resumo: z.string().optional(),
      modelo_aprovado: z.boolean().optional(),
    },
  }, async a => saida(await chamar('POST', '/acervo/pecas', token, a)));

  s.registerTool('atualizar_resultado_peca', {
    title: 'Atualizar resultado da peça',
    description: 'Registra o desfecho de uma peça já cadastrada. Use ao saber o resultado do julgamento.',
    inputSchema: {
      id: z.string().uuid(),
      resultado: z.enum(RESULTADOS),
      resumo: z.string().optional(),
    },
  }, async ({ id, ...b }) => saida(await chamar('PATCH', `/acervo/pecas/${id}/resultado`, token, b)));

  s.registerTool('criar_precedente', {
    title: 'Registrar precedente',
    description: 'Registra acórdão, sentença ou decisão no acervo de precedentes. Use ao obter decisão favorável ou ao localizar julgado reaproveitável. O campo ratio deve trazer a razão de decidir em uma a três linhas.',
    inputSchema: {
      teses: z.array(z.string()).min(1),
      orgao: z.string(),
      instancia: z.enum(INSTANCIAS),
      data_julgamento: z.string().describe('AAAA-MM-DD'),
      ratio: z.string(),
      resultado: z.enum(RESULTADOS),
      favoravel: z.boolean(),
      processo_id: z.string().uuid().optional(),
      processo_numero: z.string().optional(),
      tribunal: z.string().optional(),
      relator: z.string().optional(),
      ente: z.enum(ENTES).optional(),
      ementa: z.string().optional(),
      vinculante: z.boolean().optional(),
      fonte_primaria_url: urlHttpsOpcional,
      drive_file_id: z.string().optional(),
      drive_url: urlHttpsOpcional,
    },
  }, async a => saida(await chamar('POST', '/acervo/precedentes', token, a)));

  s.registerTool('conferir_precedente', {
    title: 'Conferir precedente',
    description: 'Marca um precedente como conferido, exigindo a URL da fonte primária. Só use depois de ter lido a ementa na fonte.',
    inputSchema: {
      id: z.string().uuid(),
      fonte_primaria_url: urlHttpsObrigatoria,
    },
  }, async ({ id, fonte_primaria_url }) => saida(await chamar('PATCH', `/acervo/precedentes/${id}/conferir`, token, { fonte_primaria_url })));

  // ── Drive: grava peça/planilha na pasta do cliente (PDF para o PJe). Master + escopo "acervo". ──

  s.registerTool('salvar_documento_drive', {
    title: 'Salvar peça ou planilha no Drive (PDF/Word)',
    description: 'Grava um documento escrito em HTML como PDF (padrão — o PJe só aceita PDF) e/ou Word (.docx) na pasta '
      + 'do cliente no Google Drive do escritório, em A4 com margens ABNT (3/3/2/2 cm) ou em paisagem para planilhas largas. '
      + 'Arquivo de mesmo nome na pasta é substituído (o anterior vai para a lixeira). Só grava nas pastas da equipe '
      + '(Pendentes a protocolar, Outorgantes) ou na pasta de clientes do AM, e nas subpastas diretas delas. '
      + 'Use HTML simples: <p>, <b>, <i>, <table>, estilos inline (text-align, text-indent, margin-left, font-size, '
      + 'background-color, border). Nome no padrão do escritório, sem extensão: "TIPO - CLIENTE - PROCESSO".',
    inputSchema: {
      pasta_id: z.string().regex(/^[A-Za-z0-9_-]{10,100}$/).describe('ID da pasta do cliente no Drive'),
      nome: z.string().min(1).max(200).describe('Nome do arquivo, sem extensão'),
      html: z.string().min(1).max(1500000).describe('Conteúdo completo em HTML'),
      formatos: z.array(z.enum(['pdf', 'docx', 'gdoc'])).min(1).max(3).optional()
        .describe('Padrão ["pdf"]. gdoc mantém também a versão editável em Google Docs'),
      orientacao: z.enum(['retrato', 'paisagem']).optional().describe('Padrão retrato (peças); paisagem para planilhas'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async a => saida(await chamar('POST', '/acervo/drive/documentos', token, a)));

  // ── Re-protocolo (somente leitura). Exige Master + escopo "reprotocolo" no conector. ──

  s.registerTool('levantamento_reprotocolo', {
    title: 'Levantamento de re-protocolo (somente leitura)',
    description: 'Retrato, SEM ALTERAR NADA, das duas filas de re-protocolo do AM: "prontos" (fila Re-protocolo — ciclos já '
      + 'aceitos, prontos para protocolar) e "aguardando" (fila Novos ciclos — aguardam autorização do Master). Agrupa por '
      + 'ente (polo passivo) + juízo do processo anterior e ordena pelo mês mais antigo do período. Traz cliente com CPF '
      + 'mascarado, tese, período acumulado, meses com mais de 5 anos (risco de prescrição), intervalo da tese, responsável, '
      + 'flags de revisão humana e o que o AM sabe da documentação (a regra de "documento a atualizar" ainda NÃO foi '
      + 'definida — não afirme que documento está vencido). Os totais batem com os contadores da tela de Tarefas. '
      + 'Comece por detalhe="resumo"; para ver casos, use detalhe="itens" com ente e/ou limite. '
      + 'Requer a permissão "Levantamento de re-protocolo" marcada ao autorizar o conector.',
    inputSchema: {
      secao: z.enum(['todas', 'prontos', 'aguardando']).optional()
        .describe('prontos = fila Re-protocolo; aguardando = fila Novos ciclos; padrão: todas'),
      detalhe: z.enum(['resumo', 'itens']).optional()
        .describe('resumo (padrão): totais e grupos; itens: lista os casos de cada grupo'),
      ente: z.string().max(100).optional()
        .describe('Filtra grupos pelo nome do ente ou do juízo (ex.: "Paraíba", "2º Juizado"); os totais continuam os da fila inteira'),
      limite: z.number().int().min(1).max(500).optional()
        .describe('No modo itens: máximo de casos listados por seção (padrão 20)'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ secao, detalhe, ente, limite }) => {
    const modo = detalhe || 'resumo';
    const parametros = { secao, detalhe: modo, ente, limite: modo === 'itens' ? (limite ?? 20) : undefined };
    return saidaCompacta(await chamar('GET', `/reprotocolo/levantamento${qs(parametros)}`, token));
  });

  s.registerTool('conferir_vinculo_oficial', {
    title: 'Conferir vínculo na fonte oficial (PB/PE)',
    description: 'Para 1 a 5 tarefas do levantamento de re-protocolo, consulta a folha oficial do Estado da Paraíba ou de '
      + 'Pernambuco (a mesma fonte da aba Estimativas, com cache de 6h) no período acumulado: competências localizadas, '
      + 'última competência com pagamento, órgão/cargo/regime encontrados, compatibilidade com o cadastro e a referência de '
      + '8% como valor em risco (só na tese FGTS e só quando a correspondência com o cadastro é única/clara — a busca é '
      + 'por nome exato e nomes comuns trazem homônimos). Mês sem pagamento no fim pode ser só atraso de publicação da '
      + 'fonte. Entes municipais ou outros: responde "sem fonte oficial integrada". Somente leitura. '
      + 'Não use em massa — é API pública do governo; consulte só os casos que o Master pedir.',
    inputSchema: {
      tarefa_ids: z.array(z.string().uuid()).min(1).max(5).describe('IDs de tarefa (campo tarefa_id do levantamento), no máximo 5'),
      atualizar: z.boolean().optional().describe('true ignora o cache de 6h e consulta de novo'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ tarefa_ids, atualizar }) => {
    const resultados = [];
    // Um por vez, nunca em paralelo: cada consulta já dispara vários pedidos à fonte oficial.
    for (const id of [...new Set(tarefa_ids)]) {
      const { status, dados } = await chamar('GET', `/reprotocolo/${id}/vinculo-oficial${atualizar ? '?atualizar=1' : ''}`, token);
      resultados.push({ tarefa_id: id, http: status, ...dados });
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(enxugar({ resultados })) }],
      isError: resultados.every(r => r.http >= 400),
    };
  });

  // ── Contato com clientes (WhatsApp pelo Digisac). Master + escopo "comunicacao". ──

  s.registerTool('localizar_cliente', {
    title: 'Localizar cliente (processo ou nome)',
    description: 'Acha o cliente pelo número CNJ do processo (com ou sem pontuação) e/ou pelo nome. Devolve '
      + 'cliente_id, nome, processo, o WhatsApp do cadastro MASCARADO e o contato do Digisac já vinculado ao cliente; '
      + 'sem número nem vínculo, lista os contatos do Digisac com nome compatível (contato_id + número mascarado) — '
      + 'confira o nome com o usuário antes de usar. '
      + 'Se o processo não estiver no AM, tente pelo nome. Use antes de enviar_whatsapp_cliente. Não altera nada.',
    inputSchema: {
      processo: z.string().max(40).optional().describe('Número CNJ, ex.: 0809017-10.2024.8.15.2001'),
      nome: z.string().max(120).optional().describe('Nome do cliente (completo ou primeiro e último)'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ processo, nome }) => saidaCompacta(await chamar('GET', `/comunicacao/localizar${qs({ processo, nome })}`, token)));

  s.registerTool('enviar_whatsapp_cliente', {
    title: 'Enviar WhatsApp ao cliente (Digisac)',
    description: 'Envia UMA mensagem de texto ao cliente pelo WhatsApp do escritório (Digisac). Destino: o WhatsApp '
      + 'do cadastro do cliente (cliente_id); sem ele, o contato do Digisac já vinculado ao cliente ou o '
      + 'contato_digisac_id achado por localizar_cliente — que, com cliente_id, fica VINCULADO ao cadastro do '
      + 'cliente depois do envio confirmado. Só envie texto que o usuário aprovou, com nome e valores já preenchidos, um cliente '
      + 'por chamada. A mesma mensagem ao mesmo destino nas últimas 24h é recusada (reenviar: true força). '
      + 'Status "incerto" = a mensagem pode ter saído: NÃO reenvie sem conferir no Digisac. Fica na auditoria.',
    inputSchema: {
      texto: z.string().min(1).max(4000).describe('Texto final da mensagem'),
      cliente_id: z.string().uuid().optional().describe('cliente_id devolvido por localizar_cliente'),
      contato_digisac_id: z.string().uuid().optional().describe('Contato do Digisac, quando o cliente não tem WhatsApp no AM'),
      processo_id: z.string().uuid().optional().describe('Processo a que a mensagem se refere (auditoria)'),
      reenviar: z.boolean().optional().describe('true manda de novo um texto idêntico já enviado nas últimas 24h'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async a => saida(await chamar('POST', '/comunicacao/enviar', token, a)));

  return s;
}

// (S-01) /mcp é isento da checagem de Origin: só aceita Bearer, nunca o cookie de sessão.
mcpRouter.post('/', somenteBearer, autenticar, async (req, res) => {
  const token = req.headers.authorization.replace('Bearer ', '');
  const servidor = construirServidor(token);
  const transporte = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transporte.close(); servidor.close(); });
  try {
    await servidor.connect(transporte);
    await transporte.handleRequest(req, res, req.body);
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: e.message }, id: null });
  }
});

const semSessao = (_req, res) => res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Servidor MCP stateless: use POST.' }, id: null });
mcpRouter.get('/', semSessao);
mcpRouter.delete('/', semSessao);
