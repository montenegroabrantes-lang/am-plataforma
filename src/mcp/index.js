// Servidor MCP do Acervo — expõe as rotas de /api/acervo como ferramentas MCP.
// Stateless: uma instância de servidor e transporte por requisição.
// As ferramentas chamam a própria API por HTTP local, reaproveitando validação,
// escopo de visibilidade e auditoria já implementados nas rotas.
import { Router } from 'express';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { autenticar } from '../middleware/auth.js';

export const mcpRouter = Router();

const BASE = `http://127.0.0.1:${process.env.PORT || 3001}/api/acervo`;

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

const qs = o => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.append(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

const ENTES = ['municipio-joao-pessoa','estado-paraiba','municipio-outro-pb','estado-pernambuco','estado-espirito-santo','uniao','inss','alpb','particular','outro'];
const INSTANCIAS = ['1grau','2grau','turma-recursal','stj','stf','tre-pb','tse','administrativo'];
const RESULTADOS = ['pendente','procedente','parcialmente-procedente','improcedente','provido','parcialmente-provido','desprovido','nao-conhecido','extinto-sem-merito','acordo','desistencia'];
const TIPOS = ['inicial','emenda-inicial','impugnacao-contestacao','especificacao-provas','recurso-inominado','contrarrazoes','embargos-declaracao','apelacao','agravo','recurso-especial','recurso-extraordinario','memorial','cumprimento-sentenca','alvara','precatorio','cessao-credito','peticao-diversa'];

function construirServidor(token) {
  const s = new McpServer({ name: 'acervo-am-advogados', version: '1.0.0' });

  s.registerTool('listar_teses', {
    title: 'Listar teses do acervo',
    description: 'Lista os slugs de tese válidos do acervo do escritório. Consulte antes de criar peça ou precedente para não usar slug inexistente.',
    inputSchema: {},
  }, async () => saida(await chamar('GET', '/teses', token)));

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
  }, async a => saida(await chamar('GET', `/${qs(a)}`, token)));

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
      drive_url: z.string().optional(),
      resultado: z.enum(RESULTADOS).optional(),
      resumo: z.string().optional(),
      modelo_aprovado: z.boolean().optional(),
    },
  }, async a => saida(await chamar('POST', '/pecas', token, a)));

  s.registerTool('atualizar_resultado_peca', {
    title: 'Atualizar resultado da peça',
    description: 'Registra o desfecho de uma peça já cadastrada. Use ao saber o resultado do julgamento.',
    inputSchema: {
      id: z.string().uuid(),
      resultado: z.enum(RESULTADOS),
      resumo: z.string().optional(),
    },
  }, async ({ id, ...b }) => saida(await chamar('PATCH', `/pecas/${id}/resultado`, token, b)));

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
      fonte_primaria_url: z.string().optional(),
      drive_file_id: z.string().optional(),
      drive_url: z.string().optional(),
    },
  }, async a => saida(await chamar('POST', '/precedentes', token, a)));

  s.registerTool('conferir_precedente', {
    title: 'Conferir precedente',
    description: 'Marca um precedente como conferido, exigindo a URL da fonte primária. Só use depois de ter lido a ementa na fonte.',
    inputSchema: {
      id: z.string().uuid(),
      fonte_primaria_url: z.string(),
    },
  }, async ({ id, fonte_primaria_url }) => saida(await chamar('PATCH', `/precedentes/${id}/conferir`, token, { fonte_primaria_url })));

  return s;
}

mcpRouter.post('/', autenticar, async (req, res) => {
  const token = req.cookies?.am_token || req.headers.authorization?.replace('Bearer ', '');
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
