// /api/precatorios — versão 2.0, etapa 2. Precatório como entidade própria, ligado ao processo de origem.
// Master only (a ficha traz valor requisitado e percentual de honorários). Toda escrita é auditada e toda
// mudança de etapa ou de habilitação fica no histórico do precatório (precatorio_eventos).
import { Router } from 'express';
import { db } from '../db/index.js';
import { apenasMaster } from '../middleware/auth.js';
import { registrarAuditoria } from '../middleware/auditoria.js';
import { uuidValido } from '../utils/validacao.js';
import { usuarioVeVisibilidade } from '../utils/visibilidade.js';
import {
  ETAPAS, PRIORIDADES, HABILITACOES, SOCIOS, etapaValida, numeroCnjValido, lerValor,
  grupoExercicio, pendencias, resumoPorGrupo,
} from '../services/precatorios/regras.js';
import { criarConsultaFormacao } from '../services/precatorios/formacao.js';

const SQL_LISTA = (extra = '') => `
  SELECT pr.id, pr.numero, pr.credor_nome, pr.devedor, pr.cliente_id, pr.processo_origem_id, pr.numero_origem,
         pr.regime_especial, pr.exercicio, pr.etapa, pr.valor_requisitado, pr.honorarios_percentual, pr.prioridade,
         pr.habilitacao_ramon, pr.habilitacao_luciano, pr.observacao, pr.criado_em, pr.atualizado_em,
         pr.pje_acesso, pr.pje_lido_em, pr.pje_classe, pr.pje_orgao, pr.pje_relator,
         ult.data AS ultimo_andamento_em, ult.texto AS ultimo_andamento,
         p.numero AS origem_numero, p.visibilidade AS origem_visibilidade, c.nome AS cliente_nome
    FROM precatorios pr
    LEFT JOIN processos p ON p.id = pr.processo_origem_id
    LEFT JOIN clientes c ON c.id = pr.cliente_id
    LEFT JOIN LATERAL (SELECT a.data, a.texto FROM precatorio_andamentos a WHERE a.precatorio_id = pr.id ORDER BY a.data DESC, a.criado_em DESC LIMIT 1) ult ON true
   WHERE 1=1 ${extra}
   ORDER BY (pr.numero IS NOT NULL), pr.regime_especial, pr.exercicio NULLS LAST, pr.credor_nome
   LIMIT 1000`;

const texto = (v, max) => String(v ?? '').trim().slice(0, max);
const CAMPOS_EVENTO = ['etapa', 'habilitacao_ramon', 'habilitacao_luciano', 'exercicio', 'regime_especial'];

// Lê e valida os campos enviados. Devolve { erro } ou { dados } só com o que veio no corpo.
function lerCampos(corpo, { criando }) {
  const d = {};
  const veio = k => corpo?.[k] !== undefined;
  if (criando || veio('numero')) {
    d.numero = texto(corpo?.numero, 30);
    if (!numeroCnjValido(d.numero)) return { erro: 'Informe o número do precatório no formato 0000000-00.0000.0.00.0000.' };
  }
  if (criando || veio('credor_nome')) {
    d.credor_nome = texto(corpo?.credor_nome, 200);
    if (!d.credor_nome) return { erro: 'Informe o nome do credor.' };
  }
  if (criando || veio('devedor')) {
    d.devedor = texto(corpo?.devedor, 200);
    if (!d.devedor) return { erro: 'Informe o devedor.' };
  }
  if (veio('numero_origem')) {
    d.numero_origem = texto(corpo.numero_origem, 30) || null;
    if (d.numero_origem && !numeroCnjValido(d.numero_origem)) return { erro: 'Número do processo de origem inválido.' };
  }
  if (veio('regime_especial')) d.regime_especial = corpo.regime_especial === true;
  if (veio('exercicio')) {
    const vazio = corpo.exercicio === null || corpo.exercicio === '';
    d.exercicio = vazio ? null : Number(corpo.exercicio);
    if (!vazio && !(Number.isInteger(d.exercicio) && d.exercicio >= 2000 && d.exercicio <= 2100)) return { erro: 'Exercício inválido.' };
  }
  if (veio('etapa')) {
    if (!etapaValida(corpo.etapa)) return { erro: 'Etapa inválida.' };
    d.etapa = corpo.etapa;
  }
  if (veio('valor_requisitado')) {
    d.valor_requisitado = lerValor(corpo.valor_requisitado);
    if (d.valor_requisitado === false) return { erro: 'Valor requisitado inválido.' };
  }
  if (veio('honorarios_percentual')) {
    const vazio = corpo.honorarios_percentual === null || corpo.honorarios_percentual === '';
    d.honorarios_percentual = vazio ? null : Number(String(corpo.honorarios_percentual).replace(',', '.'));
    if (!vazio && !(d.honorarios_percentual >= 0 && d.honorarios_percentual <= 100)) return { erro: 'Percentual de honorários inválido.' };
  }
  if (veio('prioridade')) {
    if (!Object.hasOwn(PRIORIDADES, corpo.prioridade)) return { erro: 'Prioridade inválida.' };
    d.prioridade = corpo.prioridade;
  }
  for (const [campo] of SOCIOS) {
    if (!veio(campo)) continue;
    if (!HABILITACOES.includes(corpo[campo])) return { erro: 'Situação de habilitação inválida.' };
    d[campo] = corpo[campo];
  }
  if (veio('observacao')) d.observacao = texto(corpo.observacao, 2000) || null;
  return { dados: d };
}

export function criarPrecatoriosRouter({ banco = db, auditar = registrarAuditoria, anoAtual = () => new Date().getFullYear() } = {}) {
  const router = Router();
  router.use(apenasMaster);

  // A origem restrita não aparece para quem não pode vê-la; o precatório em si continua na lista.
  const apresentar = (linha, user) => {
    const { origem_visibilidade: vis, ...p } = linha;
    const pend = pendencias(p, anoAtual());
    if (p.processo_origem_id && !usuarioVeVisibilidade(user, vis)) { p.processo_origem_id = null; p.origem_numero = null; p.numero_origem = null; }
    return { ...p, grupo: grupoExercicio(p), pendencias: pend };
  };

  // Processo de origem pelo número: só vincula o que existe e o que o usuário pode ver.
  async function acharOrigem(numero, user) {
    if (!numero) return null;
    const proc = await banco.queryOne(`SELECT id, cliente_id, visibilidade FROM processos WHERE numero = $1`, [numero]);
    return proc && usuarioVeVisibilidade(user, proc.visibilidade) ? proc : null;
  }

  router.get('/opcoes', (_req, res) => {
    res.json({ ok: true, etapas: ETAPAS, prioridades: PRIORIDADES, habilitacoes: HABILITACOES, socios: SOCIOS.map(([campo, nome]) => ({ campo, nome })) });
  });

  router.get('/', async (req, res) => {
    const params = [];
    let extra = '';
    const q = texto(req.query.q, 100);
    if (q) { params.push(`%${q}%`); extra = ` AND (pr.credor_nome ILIKE $1 OR pr.numero ILIKE $1 OR pr.devedor ILIKE $1 OR pr.numero_origem ILIKE $1)`; }
    const lista = (await banco.query(SQL_LISTA(extra), params)).map(l => apresentar(l, req.user));
    // Última leitura do PJe de 2º grau (rotina /varredura-2grau), para a tela dizer de quando são os andamentos.
    const leitura = await banco.queryOne(
      `SELECT executada_em, precatorios_lidos, precatorios_sem_acesso, recursos_lidos, andamentos_novos
         FROM segundo_grau_varreduras ORDER BY executada_em DESC LIMIT 1`);
    res.json({ ok: true, precatorios: lista, resumo: resumoPorGrupo(lista), etapas: ETAPAS, leitura_2grau: leitura || null });
  });

  // Faixas "em formação" e "alvarás a receber", pela última varredura do PJe.
  router.get('/formacao', criarConsultaFormacao(banco));

  router.get('/:id', async (req, res) => {
    if (!uuidValido(req.params.id)) return res.status(400).json({ ok: false, erro: 'Id inválido.' });
    const linha = (await banco.query(SQL_LISTA(' AND pr.id = $1'), [req.params.id]))[0];
    if (!linha) return res.status(404).json({ ok: false, erro: 'Precatório não encontrado.' });
    const eventos = await banco.query(
      `SELECT e.campo, e.de, e.para, e.criado_em, u.nome AS usuario_nome
         FROM precatorio_eventos e LEFT JOIN usuarios u ON u.id = e.usuario_id
        WHERE e.precatorio_id = $1 ORDER BY e.criado_em DESC LIMIT 100`, [req.params.id]);
    const andamentos = await banco.query(
      `SELECT a.data, a.texto FROM precatorio_andamentos a WHERE a.precatorio_id = $1 ORDER BY a.data DESC, a.criado_em DESC LIMIT 300`, [req.params.id]);
    res.json({ ok: true, precatorio: apresentar(linha, req.user), eventos, andamentos });
  });

  router.post('/', async (req, res) => {
    const { erro, dados } = lerCampos(req.body, { criando: true });
    if (erro) return res.status(400).json({ ok: false, erro });
    if (await banco.queryOne(`SELECT id FROM precatorios WHERE numero = $1`, [dados.numero])) {
      return res.status(409).json({ ok: false, erro: 'Já existe um precatório cadastrado com esse número.' });
    }
    const origem = await acharOrigem(dados.numero_origem, req.user);
    const [novo] = await banco.query(
      `INSERT INTO precatorios (numero, credor_nome, devedor, cliente_id, processo_origem_id, numero_origem, regime_especial, exercicio,
                                etapa, valor_requisitado, honorarios_percentual, prioridade, habilitacao_ramon, habilitacao_luciano, observacao, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
      [dados.numero, dados.credor_nome, dados.devedor, origem?.cliente_id ?? null, origem?.id ?? null, dados.numero_origem ?? null,
        dados.regime_especial ?? false, dados.exercicio ?? null, dados.etapa ?? 'autuado', dados.valor_requisitado ?? null,
        dados.honorarios_percentual ?? null, dados.prioridade ?? 'nenhuma', dados.habilitacao_ramon ?? 'pendente',
        dados.habilitacao_luciano ?? 'pendente', dados.observacao ?? null, req.user.id]);
    await auditar({ usuarioId: req.user.id, acao: 'criar', entidade: 'precatorio', entidadeId: novo.id,
      valorDepois: { numero: dados.numero, credor_nome: dados.credor_nome, devedor: dados.devedor }, ip: req._ip });
    res.status(201).json({ ok: true, id: novo.id, origem_vinculada: Boolean(origem) });
  });

  router.patch('/:id', async (req, res) => {
    if (!uuidValido(req.params.id)) return res.status(400).json({ ok: false, erro: 'Id inválido.' });
    const antes = await banco.queryOne(`SELECT * FROM precatorios WHERE id = $1`, [req.params.id]);
    if (!antes) return res.status(404).json({ ok: false, erro: 'Precatório não encontrado.' });
    const { erro, dados } = lerCampos(req.body, { criando: false });
    if (erro) return res.status(400).json({ ok: false, erro });
    if (dados.numero && dados.numero !== antes.numero && await banco.queryOne(`SELECT id FROM precatorios WHERE numero = $1 AND id <> $2`, [dados.numero, req.params.id])) {
      return res.status(409).json({ ok: false, erro: 'Já existe um precatório cadastrado com esse número.' });
    }
    // Trocar (ou limpar) o número de origem refaz o vínculo com o processo.
    if (dados.numero_origem !== undefined && dados.numero_origem !== antes.numero_origem) {
      const origem = await acharOrigem(dados.numero_origem, req.user);
      dados.processo_origem_id = origem?.id ?? null;
      if (origem?.cliente_id) dados.cliente_id = origem.cliente_id;
    }
    const campos = Object.keys(dados);
    if (!campos.length) return res.json({ ok: true, alterado: false });
    await banco.execute(
      `UPDATE precatorios SET ${campos.map((c, i) => `${c} = $${i + 2}`).join(', ')}, atualizado_em = NOW() WHERE id = $1`,
      [req.params.id, ...campos.map(c => dados[c])]);
    const mudou = c => dados[c] !== undefined && String(dados[c] ?? '') !== String(antes[c] ?? '');
    for (const campo of CAMPOS_EVENTO.filter(mudou)) {
      await banco.execute(`INSERT INTO precatorio_eventos (precatorio_id, campo, de, para, usuario_id) VALUES ($1,$2,$3,$4,$5)`,
        [req.params.id, campo, antes[campo] === null ? null : String(antes[campo]), dados[campo] === null ? null : String(dados[campo]), req.user.id]);
    }
    const alterados = campos.filter(mudou);
    await auditar({ usuarioId: req.user.id, acao: 'editar', entidade: 'precatorio', entidadeId: req.params.id,
      valorAntes: Object.fromEntries(alterados.map(c => [c, antes[c]])), valorDepois: Object.fromEntries(alterados.map(c => [c, dados[c]])), ip: req._ip });
    res.json({ ok: true, alterado: alterados.length > 0 });
  });

  return router;
}

export const precatoriosRouter = criarPrecatoriosRouter();
