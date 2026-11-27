// Servidor de simulação para conferir as telas da versão 2.0 (Precatórios e Comercial) sem banco: usa as rotas reais com um
// banco em memória e dados fictícios. Uso: node scripts/simular-v2.mjs (porta 3051).
import express from 'express';
import 'express-async-errors';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { criarPrecatoriosRouter } from '../src/routes/precatorios.js';
import { criarComercialRouter } from '../src/routes/comercial.js';
import { criarHojeRouter } from '../src/routes/hoje.js';

const PROC = '33333333-3333-4333-8333-333333333333';
const base = { cliente_id: null, processo_origem_id: null, numero_origem: null, regime_especial: false, exercicio: null, etapa: 'autuado',
  valor_requisitado: null, honorarios_percentual: null, prioridade: 'nenhuma', habilitacao_ramon: 'habilitado', habilitacao_luciano: 'pendente', observacao: null };
const linhas = [
  { numero: '0800101-10.2026.8.15.0000', credor_nome: 'Maria das Graças Tenório (fictício)', devedor: 'Mun. João Pessoa', exercicio: 2027, etapa: 'incluido_orcamento', valor_requisitado: '184300.00', honorarios_percentual: '30', prioridade: 'idoso', processo_origem_id: PROC, numero_origem: '0800011-10.2022.8.15.2001' },
  { numero: '0800102-20.2025.8.15.0000', credor_nome: 'Severino Ramos Batista (fictício)', devedor: 'Mun. João Pessoa', exercicio: 2027, etapa: 'incluido_orcamento', habilitacao_luciano: 'habilitado', valor_requisitado: '96750.00' },
  { numero: '0800103-30.2026.8.15.0000', credor_nome: 'Joana Darc Pimentel (fictício)', devedor: 'Estado da PB', regime_especial: true },
  { numero: '0800105-50.2026.8.15.0000', credor_nome: 'Lindalva Coutinho (fictício)', devedor: 'Mun. João Pessoa', exercicio: 2028, habilitacao_ramon: 'protocolada', habilitacao_luciano: 'habilitado' },
  { numero: '0800106-60.2023.8.15.0000', credor_nome: 'Inácio Gomes Ferraz (fictício)', devedor: 'Mun. João Pessoa', exercicio: 2025, etapa: 'aguardando_pagamento' },
  { numero: '0800107-70.2026.8.15.0000', credor_nome: 'Rosilda Amorim (fictício)', devedor: 'EMLUR' },
  { numero: null, credor_nome: 'Tereza Cristina Nóbrega (fictício)', devedor: 'Município de João Pessoa', etapa: 'assinado', habilitacao_ramon: 'pendente', processo_origem_id: PROC, numero_origem: '0800011-10.2022.8.15.2001', observacao: 'Ficha criada pela varredura do PJe: ofício requisitório de precatório juntado em 26/11.' },
].map(l => ({ id: randomUUID(), ...base, ...l, criado_em: new Date(), atualizado_em: new Date() }));
const eventos = [];
// Faixas "em formação" e "alvarás a receber": itens fictícios da varredura do PJe.
const it = (n, cliente, folha, local, bloco, extra = {}) => ({ processo_id: `p${n}`, numero: `08${String(n).padStart(5, '0')}-11.2024.8.15.2001`, cliente_nome: `${cliente} (fictício)`, folha, local, bloco, observacao: null, concluso: null, dias_parado: null, ...extra });
const itensVarredura = [
  it(1, 'Abel Tavares', 'diligencia', '2º JEFP', 'Fazer minuta de precatório', { dias_parado: 21 }), it(2, 'Berenice Lins', 'diligencia', '3ª Vara da Fazenda', 'Fazer minuta de precatório', { dias_parado: 6 }),
  it(3, 'Cícero Paiva', 'diligencia', '1º JEFP', 'Fazer formulário de precatório/RPV', { dias_parado: 2 }),
  it(4, 'Dalva Moura', 'cartorio', '2º JEFP', 'Formulário juntado: falta a minuta do precatório', { observacao: 'Formulário juntado em 12/11', dias_parado: 15 }),
  it(5, 'Edson Brito', 'diligencia', '4º JEFP', 'Juntar concordância', { observacao: 'Minuta juntada em 24/11', dias_parado: 3 }),
  it(6, 'Fátima Leal', 'cartorio', '2º JEFP', 'Certificar o envio ao SAPRE', { observacao: 'Concordância juntada em 10/11', dias_parado: 17 }),
  it(7, 'Gilson Prado', 'outros', 'Núcleo 4.0', 'Certificar o envio ao SAPRE', { observacao: 'Concordância juntada em 03/11', dias_parado: 24 }),
  it(8, 'Helena Vaz', 'assinaturas', '1º JEFP', 'Assinar precatório no SAPRE', { observacao: 'Certidão do cartório em 25/11', dias_parado: 2 }),
  it(9, 'Ivo Sales', 'cartorio', '3º JEFP', 'Pedir conclusão para expedir alvará', { dias_parado: 12 }),
  it(10, 'Júlia Reis', 'gabinete', '2º JEFP', 'Expedir alvará', { concluso: '19/11 Conclusos para decisão', dias_parado: 8 }),
  it(11, 'Kátia Nunes', 'gabinete', '1º JEFP', 'Expedir alvará', { concluso: '01/10 Conclusos para despacho', dias_parado: 57 }),
  it(12, 'Lauro Pires', 'gabinete', '4ª Vara da Fazenda', 'Expedir alvará', { concluso: '10/11 Conclusos para despacho', dias_parado: 17 }),
  it(13, 'Marta Dias', 'diligencia', '2º JEFP', 'Cumprir intimação pessoal para o alvará', { observacao: 'Juiz exigiu intimação pessoal em 20/11', dias_parado: 7 }),
  it(14, 'Nilo Rocha', 'assinaturas', '3º JEFP', 'Assinar alvará no BRBJus', { observacao: 'Alvará juntado em 10/11', dias_parado: 17 }),
];
const comOrigem = l => ({ ...l, origem_numero: l.processo_origem_id ? l.numero_origem : null, origem_visibilidade: 'normal', cliente_nome: null });

const banco = {
  async query(sql, p = []) {
    if (sql.includes('FROM despachos_itens')) return itensVarredura.filter(i => p[1].includes(i.bloco));
    if (sql.includes('pr.numero IS NULL')) return linhas.filter(l => !l.numero).map(l => ({ precatorio_id: l.id, numero: l.numero_origem, cliente_nome: l.credor_nome, processo_id: l.processo_origem_id, criado_em: l.criado_em }));
    if (sql.includes('INSERT INTO precatorios')) {
      const [numero, credor_nome, devedor, cliente_id, processo_origem_id, numero_origem, regime_especial, exercicio, etapa, valor_requisitado,
        honorarios_percentual, prioridade, habilitacao_ramon, habilitacao_luciano, observacao] = p;
      const nova = { id: randomUUID(), numero, credor_nome, devedor, cliente_id, processo_origem_id, numero_origem, regime_especial, exercicio, etapa,
        valor_requisitado, honorarios_percentual, prioridade, habilitacao_ramon, habilitacao_luciano, observacao, criado_em: new Date(), atualizado_em: new Date() };
      linhas.push(nova); return [{ id: nova.id }];
    }
    if (sql.includes('FROM precatorio_eventos')) return eventos.filter(e => e.precatorio_id === p[0]).reverse();
    if (sql.includes('pr.id = $1')) return linhas.filter(l => l.id === p[0]).map(comOrigem);
    return linhas.map(comOrigem);
  },
  async queryOne(sql, p = []) {
    if (sql.includes('alvará pago')) return { total: 4 };
    if (sql.includes('FROM despachos_varreduras')) return { id: 'v1', executada_em: new Date(Date.now() - 3 * 3600_000) };
    if (sql.includes('FROM segundo_grau_varreduras')) return null;
    if (sql.includes('FROM processos WHERE numero')) return p[0] === '0800011-10.2022.8.15.2001' ? { id: PROC, cliente_id: null, visibilidade: 'normal' } : null;
    if (sql.includes('WHERE numero = $1')) return linhas.find(l => l.numero === p[0] && l.id !== p[1]) || null;
    const achado = linhas.find(l => l.id === p[0]);
    return achado ? { ...achado } : null; // cópia: o UPDATE não pode alterar o "antes" que a rota já leu
  },
  async execute(sql, p = []) {
    if (sql.includes('INSERT INTO precatorio_eventos')) { eventos.push({ precatorio_id: p[0], campo: p[1], de: p[2], para: p[3], criado_em: new Date(), usuario_nome: 'Teste Local' }); return; }
    const campos = [...sql.matchAll(/(\w+) = \$(\d+)/g)].filter(m => m[2] !== '1');
    const alvo = linhas.find(l => l.id === p[0]);
    for (const [, nome, n] of campos) alvo[nome] = p[Number(n) - 1];
  },
};

const user = { id: '00000000-0000-4000-8000-000000000000', nome: 'Teste Local', perfil: 'master' };
const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.get('/api/auth/me', (_q, r) => r.json({ ok: true, user }));
app.use('/api/precatorios', (q, _r, n) => { q.user = user; n(); }, criarPrecatoriosRouter({ banco, auditar: async () => {} }));
// Quadro Comercial: fechamentos, tarefas e leads fictícios.
const ha = dias => new Date(Date.now() - dias * 86_400_000).toISOString();
const O = n => `0000000${n}-0000-4000-8000-000000000000`;
const fechamentos = [
  { id: O(1), status: 'cadastro_pendente', nome: 'Paulo Henrique Dantas (fictício)', valor_fechado: '8400', fechado_em: ha(60), responsavel_cadastro_nome: 'Ana' },
  { id: O(2), status: 'cadastro_pendente', nome: 'Fernanda Queiroz (fictício)', fechado_em: ha(2), responsavel_cadastro_nome: 'Ana' },
  { id: O(3), status: 'protocolo_pendente', cliente_nome: 'LUCIANA FARIAS (FICTÍCIO)', valor_fechado: '12900', fechado_em: ha(50), responsavel_protocolo_nome: 'Bia' },
  { id: O(4), status: 'protocolo_pendente', cliente_nome: 'ROBERTO MAIA (FICTÍCIO)', fechado_em: ha(9), responsavel_protocolo_nome: 'Bia' },
  { id: O(5), status: 'concluido', cliente_nome: 'MARIANA SOUTO (FICTÍCIO)', atualizado_em: ha(4), responsavel_protocolo_nome: 'Bia' },
];
const tarefasComerciais = [
  { onboarding_id: O(3), tipo: 'cadastro_cliente', status: 'concluida', concluida_em: ha(47) },
  { onboarding_id: O(3), tipo: 'protocolar', status: 'pendente' }, { onboarding_id: O(3), tipo: 'protocolar', status: 'concluida' },
  { onboarding_id: O(4), tipo: 'cadastro_cliente', status: 'concluida', concluida_em: ha(3) },
  { onboarding_id: O(4), tipo: 'protocolar', status: 'pendente', drive_protocolo_detectado_em: ha(1) },
];
const leadsFicticios = [
  { contact_id: 101, nome: 'Carlos Nóbrega (fictício)', etapa: 'proposta_enviada', valor: 15200, proposta_enviada_em: ha(8), status_atendimento: 'com_camila' },
  { contact_id: 102, nome: 'Ana Beatriz Lima (fictício)', etapa: 'proposta_enviada', valor: 9800, proposta_enviada_em: ha(1), atendente_nome: 'Ana' },
  { contact_id: 103, nome: 'José Ricardo Alves (fictício)', etapa: 'documentos_parciais', ultima_cliente_em: ha(3), atendente_nome: 'Ana' },
  { contact_id: 104, nome: 'Rosilda Amorim (fictício)', etapa: 'aguardando_assinatura', ultima_equipe_em: ha(5), atendente_nome: 'Ana' },
  { contact_id: 105, nome: 'Edvaldo Nunes (fictício)', etapa: 'assinado', ultima_cliente_em: ha(1) },
  { contact_id: 106, nome: 'Fora do quadro (fictício)', etapa: 'simulou' },
];
const bancoComercial = { async query(sql) { return sql.includes('camila_contact_id') ? [] : sql.includes('FROM tarefas') ? tarefasComerciais : fechamentos; } };
app.use('/api/comercial', (q, _r, n) => { q.user = user; n(); },
  criarComercialRouter({ banco: bancoComercial, clienteCamila: () => ({ get: async () => ({ data: { ok: true, leads: leadsFicticios } }) }) }));
// Tela Hoje e Busca: tarefas, assinaturas e publicações fictícias; a busca usa respostas fixas.
const idPrazo = n => `00000000-0000-4000-8000-00000000000${n}`;
const prazosCumpridos = new Set();
const bancoHoje = {
  async queryOne(_sql, [id]) { return prazosCumpridos.has(id) ? null : { id, tipo: 'prazo', status: 'pendente', descricao: 'Manifestação sobre cálculos', prazo_data: ha(-4), processo_id: 'proc-2', atribuido_a: user.id, visibilidade: 'normal', inicio: ha(6) }; },
  async execute(_sql, [id]) { prazosCumpridos.add(id); return { rowCount: 1 }; },
  async query(sql) {
  if (sql.includes('FROM movimentacoes')) return [{ processo_id: 'proc-2', data: ha(2), texto: 'Juntada de Petição de petição' }];
  if (sql.includes('FROM acervo_pecas')) return [];
  if (sql.includes('FROM tarefas t')) return [
    { id: idPrazo(1), tipo: 'prazo', descricao: 'Impugnação à contestação', prazo_data: ha(-1), processo_numero: '0800001-11.2026.8.15.2001', cliente_nome: 'Ana Beatriz Lima (fictício)', responsavel_nome: 'Ana' },
    { id: idPrazo(2), tipo: 'prazo', descricao: 'Manifestação sobre cálculos', prazo_data: ha(-4), processo_id: 'proc-2', inicio: ha(6), processo_numero: '0800002-22.2025.8.15.2001', cliente_nome: 'Carlos Nóbrega (fictício)' },
    { id: 3, tipo: 'protocolar', descricao: 'Protocolar FGTS de temporário', cliente_nome: 'Paulo Dantas (fictício)', criado_em: ha(12), responsavel_nome: 'Bia' },
    { id: 4, tipo: 'protocolar', cliente_nome: 'Roberto Maia (fictício)', criado_em: ha(3), drive_protocolo_detectado_em: ha(1) },
  ].filter(t => !prazosCumpridos.has(t.id));
  if (sql.includes('FROM despachos_itens')) return [{ id: 'a1', observacao: 'Contrarrazões prontas', local: '2ª Vara da Fazenda', processo_numero: '0800003-33.2024.8.15.2001', cliente_nome: 'Mariana Souto (fictício)' }];
  if (sql.includes('FROM publicacoes pb')) return [{ id: 'p1', tipo_documento: 'Sentença', numero_processo: '0800005-55.2025.8.15.2001', data_disponibilizacao: ha(1), cliente_nome: 'Luciana Farias (fictício)' }, { id: 'p2', tipo_documento: 'EXPEDIENTE', data_disponibilizacao: ha(0) }];
  if (sql.includes('FROM onboardings_contrato')) return [{ status: 'protocolo_pendente', total: 21, dias_medio: 47 }, { status: 'cadastro_pendente', total: 7, dias_medio: 60 }];
  return linhas;
} };
app.use('/api/hoje', (q, _r, n) => { q.user = user; n(); }, criarHojeRouter({ banco: bancoHoje, auditar: async () => {}, apagarEvento: async () => {} }));
// Lista de Processos: 48 linhas fictícias para ver o desenho da tabela (nomes inventados).
const NOMES_FIC = ['ANA BEATRIZ LIMA', 'CARLOS EDUARDO NOBREGA', 'MARIANA SOUTO DE ALBUQUERQUE', 'JOSE RICARDO ALVES', 'FERNANDA QUEIROZ DA COSTA', 'PAULO HENRIQUE DANTAS', 'LUCIANA FARIAS', 'ROBERTO MAIA DOS SANTOS', 'TEREZA CRISTINA BRITO', 'ANTONIO MARCOS DE OLIVEIRA E SILVA'];
const VARAS_FIC = ['1º Juizado Especial da Fazenda Pública da Região Metropolitana da Capital', '2º Juizado Especial da Fazenda Pública da Região Metropolitana da Capital', '1ª Vara de Fazenda Pública da Capital', '3ª Vara de Fazenda Pública da Capital', 'Núcleo de Justiça 4.0 de Cumprimento de Sentença Fazendário da Capital'];
const MOVS_FIC = ['Conclusos para julgamento', 'Juntada de Petição de petição', 'Recebida a emenda à inicial', 'Juntada de Petição de impugnação ao cumprimento de sentença', 'Expedição de Outros documentos', 'Decorrido prazo do Município', 'Publicado despacho', 'Juntada de ofício requisitório de precatório'];
const ETAPAS_FIC = ['Inicial', 'Cumprimento de Sentença', 'Recurso', 'Contestação', 'Sem classificação', 'Precatório', 'Minuta de Precatório'];
const TESES_FIC = ['FGTS', 'FERIAS 45 DIAS', 'PISO SALARIAL - MAGISTÉRIO', 'ADICIONAL NOTURNO'];
const CARGOS_FIC = ['Professor', 'Médico', 'Técnico de Enfermagem', 'Servidor Municipal'];
const PARADOS_FIC = [0, 0, 1, 3, 15, 28, 61, 95, 140, 210, 400];
const processosFic = Array.from({ length: 48 }, (_, i) => ({
  id: i === 0 ? PROC : `00000000-0000-4000-9100-${String(i).padStart(12, '0')}`,
  numero: `08${String(1234 + i * 613).padStart(5, '0')}-${String(11 + (i * 7) % 88).padStart(2, '0')}.${2023 + (i % 4)}.8.15.2001`,
  cliente_nome: NOMES_FIC[i % NOMES_FIC.length] + ' (FICTÍCIO)', cliente_cargo: CARGOS_FIC[i % CARGOS_FIC.length], produto_nome: TESES_FIC[i % TESES_FIC.length],
  vara: VARAS_FIC[i % VARAS_FIC.length], polo_passivo: i % 3 === 0 ? 'Estado da Paraíba' : i % 7 === 0 ? 'AUTARQUIA ESPECIAL DE LIMPEZA URBANA-EMLUR E OUTROS' : 'Município de João Pessoa',
  status: 'ativo', urgente: i === 0 || i === 5, tem_cessao: i === 9, requer_revisao: i === 3, visibilidade: i === 12 ? 'restrito' : 'normal',
  data_distribuicao: `${2023 + (i % 4)}-0${1 + (i % 9)}-15`, dias_parado: PARADOS_FIC[i % PARADOS_FIC.length],
  ultima_atualizacao: ha(PARADOS_FIC[i % PARADOS_FIC.length]), ultima_atualizacao_origem: i % 6 === 2 ? 'publicacao' : 'movimentacao',
  ultima_mov_texto: MOVS_FIC[i % MOVS_FIC.length], ultima_pub_resumo: 'Intimação para manifestação sobre os cálculos apresentados',
  etapa: ETAPAS_FIC[i % ETAPAS_FIC.length], etapa_atual: i % 8 === 4 ? 'Expedir RPV' : null, situacao_atual: i % 5 === 1 ? 'calculos_homologados' : null, classif_valores: {},
}));
const contar = campo => Object.entries(processosFic.reduce((a, p) => { a[p[campo]] = (a[p[campo]] || 0) + 1; return a; }, {})).map(([k, total]) => ({ k, total })).sort((a, b) => b.total - a.total);
app.get('/api/processos/sync-status', (q, r) => r.json({ ok: true, em_andamento: false, ultima_execucao: { concluido_em: ha(0.1), via_datajud: 3, novas_movimentacoes: 0, falhas: 37 } }));
app.get('/api/processos', (q, r) => { const pp = Number(q.query.por_pagina) || 30, pg = Number(q.query.pagina) || 1; r.json({ ok: true, total: 883, processos: processosFic.slice((pg - 1) * pp, pg * pp) }); });
app.get('/api/triagem', (q, r) => r.json({ ok: true, stats: { movimentacao_pendente: 1, cessoes_credito: 1,
  por_etapa: contar('etapa').map(x => ({ etapa: x.k, total: x.total * 18 })), por_funcao: contar('cliente_cargo').map(x => ({ funcao: x.k, total: x.total * 18 })),
  por_vara: contar('vara').map(x => ({ vara: x.k, total: x.total * 18 })), por_produto: contar('produto_nome').map(x => ({ produto: x.k, total: x.total * 18 })),
  por_polo_passivo: contar('polo_passivo').map(x => ({ polo_passivo: x.k, total: x.total * 18 })), por_tempo: [{ faixa: 'até 30 dias', total: 512 }, { faixa: '31 a 90 dias', total: 201 }, { faixa: '91 a 180 dias', total: 96 }, { faixa: 'mais de 180 dias', total: 74 }] } }));
app.get('/api/classif', (q, r) => r.json({ ok: true, campos: [] }));
app.get('/api/produtos', (q, r) => r.json({ ok: true, produtos: [] }));
app.get('/api/polos-passivos', (q, r) => r.json({ ok: true, polos: [] }));
app.get('/api/clientes', (q, r) => r.json({ ok: true, clientes: [{ id: O(9), nome: 'Ana Beatriz Lima (fictício)', cpf: '***.456.789-**' }] }));
app.get('/api/acervo/teses', (q, r) => r.json({ ok: true, teses: [{ slug: 'fgts-nulidade', label: 'FGTS por nulidade da contratação temporária', situacao: 'ativa' }, { slug: 'piso', label: 'Piso do magistério', situacao: 'em_risco' }] }));
app.get('/api/acervo', (q, r) => r.json({ ok: true, pecas: [{ id: 'pc1', titulo: 'Inicial · FGTS de temporário · Município (fictício)', cliente_nome: 'Ana Beatriz Lima', processo_numero: '0800001-11.2026.8.15.2001' }], precedentes: [{ id: 'pr1', processo_numero: 'RE 765.320', orgao: 'STF', ratio: 'FGTS devido na contratação temporária nula (Tema 916).' }] }));
// Despachos: 60 linhas fictícias em duas varas, para testar filtros e a volta à lista.
const itensDespachos = Array.from({ length: 60 }, (_, i) => ({
  processo_id: i === 0 ? PROC : `00000000-0000-4000-9000-${String(i).padStart(12, '0')}`,
  numero: `08${String(10000 + i * 37).padStart(5, '0')}-${String(10 + (i % 80)).padStart(2, '0')}.2026.8.15.2001`,
  folha: 'cartorio', local: i % 2 ? '2º JEFP/A' : 'Núcleo 4.0', bloco: ['Expedir RPV', 'Pedir conclusão para homologar o cumprimento', 'Conferir: pedir a minuta'][i % 3],
  observacao: 'Linha fictícia ' + (i + 1), dias_parado: 5 + i * 3, concluso: null, ultimo_andamento: 'Juntada de informações', lido_no_pje: true, acervo: null,
}));
app.get('/api/despachos', (q, r) => r.json({ ok: true, varredura: { executada_em: new Date().toISOString() }, itens: itensDespachos, mudancas: [] }));
app.use((q, r) => r.json({ ok: true }));
app.listen(3051, '127.0.0.1', () => console.log('simulação de precatórios em http://127.0.0.1:3051'));
