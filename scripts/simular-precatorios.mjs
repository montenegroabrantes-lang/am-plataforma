// Servidor de simulação para conferir a tela de Precatórios sem banco: usa as rotas reais com um
// banco em memória e dados fictícios. Uso: node scripts/simular-precatorios.mjs (porta 3051).
import express from 'express';
import 'express-async-errors';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { criarPrecatoriosRouter } from '../src/routes/precatorios.js';

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
].map(l => ({ id: randomUUID(), ...base, ...l, criado_em: new Date(), atualizado_em: new Date() }));
const eventos = [];
const comOrigem = l => ({ ...l, origem_numero: l.processo_origem_id ? l.numero_origem : null, origem_visibilidade: 'normal', cliente_nome: null });

const banco = {
  async query(sql, p = []) {
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
app.use((q, r) => r.json({ ok: true }));
app.listen(3051, '127.0.0.1', () => console.log('simulação de precatórios em http://127.0.0.1:3051'));
