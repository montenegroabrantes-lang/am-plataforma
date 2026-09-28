import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/index.js';
import {
  calcularPeriodo, mascararCpf, classificarEnte, montarItem, agrupar, montarSecao,
  levantarReprotocolo, formatarLevantamento, sqlItens, responsavelSugerido, avisoDoJuizo,
  enteDivergeDoTribunal, SQL_HOJE, SQL_ADIADOS, SQL_DOCUMENTOS, SECAO_PRONTOS, SECAO_AGUARDANDO,
} from './levantamento.js';
import { FILA_REPROTOCOLO, FILA_CICLOS, CICLO_NAO_ADIADO, TAREFA_ABERTA } from './regras.js';

// Guarda: estes testes usam banco simulado. Qualquer uso acidental do pool real falha na hora.
for (const metodo of ['query', 'queryOne', 'execute']) {
  db[metodo] = async () => { throw new Error('banco real proibido nos testes'); };
}

const HOJE = '2026-09-28';

// Linha como o SQL real devolveria (só os campos usados), com padrões "saudáveis".
function linha(extra = {}) {
  return {
    tarefa_id: 't-1', secao: SECAO_AGUARDANDO, subtipo: 'ciclo',
    ciclo_inicio: '2024-01-01', ciclo_adiado_ate: null, prazo_data: null, validado_por: null,
    atribuido_a: null, responsavel_nome: null, responsavel_ativo: null,
    cliente_id: 'c-1', cliente_nome: 'MARIA DA SILVA', cliente_cpf: '12345678901',
    cliente_ativo: true, cliente_vinculo_ativo: true, cliente_vinculo_fim: null,
    cliente_cargo: 'PROFESSOR', cliente_orgao: 'SECRETARIA DE EDUCACAO',
    tem_pasta_drive: true, produto_id: 'p-fgts', produto_nome: 'FGTS', intervalo_meses: 25,
    documentos_exigidos: ['identidade', 'cpf', 'residencia', 'contracheque'],
    polo_passivo: 'Estado da Paraíba', polo_processo: null, polo_vinculo_unico: 'Estado da Paraíba',
    polo_cliente: 'Estado da Paraíba', polo_padrao_tese: null, padrao_tese_opcoes: 0,
    qtd_vinculos_ativos: 1, qtd_vinculos: 1,
    vinculos_ativos: [{ id: 'v-1', cargo: 'PROFESSOR', orgao: 'SECRETARIA DE EDUCACAO', polo_passivo: 'Estado da Paraíba' }],
    vinculo_tarefa_id: null,
    anterior_id: 'proc-1', anterior_numero: '0800000-00.2022.8.15.2001', anterior_periodo_fim: '2023-12-01',
    anterior_status: 'ativo', anterior_vara: '1º Juizado Especial da Fazenda Pública da Capital',
    anterior_tribunal: 'TJPB', anterior_comarca: null, anterior_grau: '1', anterior_visibilidade: 'normal',
    cobrindo_qtd: 0, cobrindo_lista: [], processos_mesma_tese: 1,
    resp_tese_config: null, resp_tese_nome: null, resp_tese_ativo: null,
    resp_proc_id: 'u-joao', resp_proc_nome: 'João', resp_proc_ativo: true,
    ...extra,
  };
}

// ── período, 5 anos e intervalo ──

test('período: meses inclusivos até o mês atual, iguais ao CICLO_MESES da tela de Tarefas', () => {
  const cicloMesesTela = (inicio) => { // fórmula SQL de tarefas.js, reescrita em JS
    const [a, m] = inicio.split('-').map(Number);
    return (2026 - a) * 12 + 9 - m + 1;
  };
  for (const inicio of ['2020-01-01', '2021-10-01', '2024-09-01', '2026-09-01']) {
    assert.equal(calcularPeriodo({ cicloInicio: inicio, vinculoAtivo: true, hoje: HOJE }).meses, cicloMesesTela(inicio), inicio);
  }
});

test('período: meses com mais de 5 anos = antes das últimas 60 competências (desde 2021-10)', () => {
  const p = calcularPeriodo({ cicloInicio: '2020-01-01', vinculoAtivo: true, hoje: HOJE });
  assert.equal(p.primeiro_mes_dentro_5_anos, '2021-10');
  assert.equal(p.meses, 81);
  assert.equal(p.meses_mais_5_anos, 21); // 2020-01 .. 2021-09
  assert.equal(p.prescricao_correndo, true);

  const dentro = calcularPeriodo({ cicloInicio: '2021-10-01', vinculoAtivo: true, hoje: HOJE });
  assert.equal(dentro.meses_mais_5_anos, 0);
  assert.equal(dentro.prescricao_correndo, true, 'o mês mais antigo da janela está no período');

  const recente = calcularPeriodo({ cicloInicio: '2024-01-01', vinculoAtivo: true, hoje: HOJE });
  assert.equal(recente.meses_mais_5_anos, 0);
  assert.equal(recente.prescricao_correndo, false);
});

test('período: vínculo encerrado vai só até o fim do vínculo; sem data, até hoje (teto)', () => {
  const encerrado = calcularPeriodo({ cicloInicio: '2011-03-01', vinculoAtivo: false, vinculoFim: '2023-06-15', hoje: HOJE });
  assert.equal(encerrado.fim, '2023-06');
  assert.equal(encerrado.fim_motivo, 'vinculo_encerrado');
  assert.equal(encerrado.meses, 148);
  assert.equal(encerrado.meses_mais_5_anos, 127); // 2011-03 .. 2021-09

  const semData = calcularPeriodo({ cicloInicio: '2024-01-01', vinculoAtivo: false, vinculoFim: null, hoje: HOJE });
  assert.equal(semData.fim, '2026-09');
  assert.equal(semData.fim_motivo, 'vinculo_encerrado_sem_data');

  const antes = calcularPeriodo({ cicloInicio: '2024-01-01', vinculoAtivo: false, vinculoFim: '2023-05-01', hoje: HOJE });
  assert.equal(antes.meses, 0);
  assert.equal(antes.situacao, 'encerrado_antes_do_inicio');
});

test('período: início futuro e sem início', () => {
  const futuro = calcularPeriodo({ cicloInicio: '2027-01-01', vinculoAtivo: true, hoje: HOJE });
  assert.equal(futuro.meses, 0);
  assert.equal(futuro.situacao, 'inicio_no_futuro');
  const sem = calcularPeriodo({ cicloInicio: null, vinculoAtivo: true, hoje: HOJE });
  assert.equal(sem.situacao, 'sem_inicio');
  assert.equal(sem.meses, null);
});

test('período: intervalo da tese com a mesma conta do cron (início + intervalo − 1 <= hoje)', () => {
  const completo = calcularPeriodo({ cicloInicio: '2024-09-01', vinculoAtivo: true, hoje: HOJE, intervaloMeses: 25 });
  assert.equal(completo.completa_intervalo_em, '2026-09');
  assert.equal(completo.intervalo_completo, true);
  const incompleto = calcularPeriodo({ cicloInicio: '2024-10-01', vinculoAtivo: true, hoje: HOJE, intervaloMeses: 25 });
  assert.equal(incompleto.completa_intervalo_em, '2026-10');
  assert.equal(incompleto.intervalo_completo, false);
  const semIntervalo = calcularPeriodo({ cicloInicio: '2024-10-01', vinculoAtivo: true, hoje: HOJE });
  assert.equal(semIntervalo.intervalo_completo, null);
});

// ── CPF ──

test('CPF mascarado: só os 4 últimos dígitos, mesmo com dado formatado ou malformado', () => {
  assert.equal(mascararCpf('12345678901'), '***.***.*89-01');
  assert.equal(mascararCpf('123.456.789-01'), '***.***.*89-01');
  assert.equal(mascararCpf('4567890'), '***.***.*78-90');
  assert.equal(mascararCpf('123'), null);
  assert.equal(mascararCpf(null), null);
  for (const cpf of ['12345678901', '98765432100']) {
    assert.equal(mascararCpf(cpf).replace(/\D/g, ''), cpf.slice(-4));
  }
});

// ── ente ──

test('ente: grafias do mesmo estado caem no mesmo grupo e apontam a fonte oficial', () => {
  for (const polo of ['Estado da Paraíba', 'ESTADO PARAIBA', 'Governo do Estado da Paraíba']) {
    const e = classificarEnte(polo);
    assert.equal(e.chave, 'ESTADO PB', polo);
    assert.equal(e.nome, 'Estado da Paraíba');
    assert.equal(e.fonte_oficial, 'PB');
  }
  for (const polo of ['Estado de Pernambuco', 'ESTADO PERNANBUCO', 'Governo de Pernambuco']) {
    assert.equal(classificarEnte(polo).fonte_oficial, 'PE', polo);
  }
});

test('ente: município nunca vira estado; "Prefeitura de X" agrupa com "Município de X"; genérico sinalizado', () => {
  assert.equal(classificarEnte('Município do Recife').fonte_oficial, null);
  assert.equal(classificarEnte('Prefeitura Municipal de Campina Grande - Paraíba').fonte_oficial, null);
  assert.equal(classificarEnte('Prefeitura de João Pessoa').chave, classificarEnte('Município de João Pessoa').chave);
  assert.equal(classificarEnte('Município — Outro').generico, true);
  assert.equal(classificarEnte('PBPREV - Paraíba Previdência').fonte_oficial, null);
  assert.equal(classificarEnte('Estado do Ceará').fonte_oficial, null);
  assert.equal(classificarEnte(null).chave, 'SEM POLO');
});

// ── item e flags ──

test('item saudável: sem flags de revisão, responsável sugerido pela mesma regra do cron', () => {
  const item = montarItem(linha(), { hoje: HOJE });
  assert.equal(item.secao, SECAO_AGUARDANDO);
  assert.equal(item.revisao_humana, false);
  assert.deepEqual(item.flags, []);
  assert.equal(item.ente.origem, 'vinculo_unico');
  assert.equal(item.juizo.rotulo, '1º Juizado Especial da Fazenda Pública da Capital (TJPB)');
  assert.deepEqual(item.responsavel_sugerido, { id: 'u-joao', nome: 'João', origem: 'master_do_processo_anterior' });
  assert.equal(item.periodo.meses, 33);
  assert.equal(item.cliente.cpf_mascarado, '***.***.*89-01');
});

test('item: CPF completo nunca aparece na saída', () => {
  const texto = JSON.stringify(montarItem(linha({ cliente_cpf: '52998224725' }), { hoje: HOJE }));
  assert.equal(texto.includes('52998224725'), false);
  assert.equal(texto.includes('529.982.247-25'), false);
  assert.ok(texto.includes('***.***.*47-25'));
});

test('flags: sem polo, 2+ vínculos, vínculo encerrado, sem processo anterior, sem pasta', () => {
  const item = montarItem(linha({
    polo_passivo: null, polo_vinculo_unico: null, polo_cliente: null,
    qtd_vinculos_ativos: 2, qtd_vinculos: 2,
    cliente_vinculo_ativo: false, cliente_vinculo_fim: '2025-06-30',
    anterior_id: null, tem_pasta_drive: false, resp_proc_id: null,
  }), { hoje: HOJE });
  for (const f of ['sem_polo', 'varios_vinculos_ativos', 'vinculo_encerrado', 'vinculo_divergente',
    'sem_processo_anterior', 'sem_pasta_drive', 'sem_responsavel_sugerido']) {
    assert.ok(item.flags.includes(f), f);
  }
  assert.equal(item.revisao_humana, true);
  assert.equal(item.juizo.origem, 'sem_processo_anterior');
  assert.equal(item.periodo.fim, '2025-06');
});

test('flags da fila Re-protocolo: sem responsável/prazo, prazo vencido, responsável inativo, aceite', () => {
  const semNada = montarItem(linha({ secao: SECAO_PRONTOS, subtipo: 'ciclo_aceito' }), { hoje: HOJE });
  assert.ok(semNada.flags.includes('sem_responsavel'));
  assert.ok(semNada.flags.includes('sem_prazo'));
  assert.equal(semNada.aceite, 'automatico');
  assert.equal('responsavel_sugerido' in semNada, false);

  const vencido = montarItem(linha({
    secao: SECAO_PRONTOS, subtipo: 'ciclo_aceito', atribuido_a: 'u-2', responsavel_nome: 'Ana',
    responsavel_ativo: false, prazo_data: '2026-09-01', validado_por: 'u-master',
  }), { hoje: HOJE });
  assert.ok(vencido.flags.includes('prazo_vencido'));
  assert.ok(vencido.flags.includes('responsavel_inativo'));
  assert.equal(vencido.aceite, 'manual');
  assert.deepEqual(vencido.responsavel, { id: 'u-2', nome: 'Ana', ativo: false });
});

test('responsável sugerido espelha o cron: responsável da tese inativo NÃO cai para o do processo', () => {
  assert.equal(responsavelSugerido({ resp_tese_config: 'u-t', resp_tese_ativo: false, resp_proc_id: 'u-p', resp_proc_ativo: true }), null);
  assert.equal(responsavelSugerido({ resp_tese_config: 'u-t', resp_tese_ativo: true, resp_tese_nome: 'T' }).origem, 'configuracao_da_tese');
  assert.equal(responsavelSugerido({ resp_proc_id: 'u-p', resp_proc_ativo: false }), null);
});

test('flags: fim do vínculo antes do ciclo com cadastro "ativo" (caso real dos 2 re-protocolos)', () => {
  const item = montarItem(linha({ ciclo_inicio: '2023-02-01', cliente_vinculo_ativo: true, cliente_vinculo_fim: '2023-01-01' }), { hoje: HOJE });
  assert.ok(item.flags.includes('fim_do_vinculo_antes_do_ciclo'));
  assert.ok(item.flags.includes('vinculo_divergente'));
  assert.equal(item.revisao_humana, true);
  assert.match(item.vinculo.divergencias[0], /antes do início do ciclo/);
});

test('flags: intervalo incompleto é contado à parte (não é revisão humana)', () => {
  const item = montarItem(linha({ ciclo_inicio: '2026-06-01' }), { hoje: HOJE });
  assert.ok(item.flags.includes('intervalo_da_tese_incompleto'));
  assert.equal(item.revisao_humana, false);
  const secao = montarSecao([item, montarItem(linha({ tarefa_id: 't-2', ciclo_inicio: '2022-01-01' }), { hoje: HOJE })]);
  assert.equal(secao.ainda_nao_completaram_intervalo, 1);
  assert.equal(secao.completaram_intervalo, 1);
});

test('flags: polo genérico, polo inferido da tese, processo cobrindo o período, ente x tribunal', () => {
  const generico = montarItem(linha({ polo_passivo: 'Município — Outro', polo_vinculo_unico: 'Município — Outro' }), { hoje: HOJE });
  assert.ok(generico.flags.includes('polo_generico'));

  const daTese = montarItem(linha({
    polo_passivo: 'Estado da Paraíba', polo_vinculo_unico: null, polo_cliente: null,
    polo_padrao_tese: 'Estado da Paraíba', padrao_tese_opcoes: 11,
  }), { hoje: HOJE });
  assert.equal(daTese.ente.origem, 'padrao_tese');
  assert.equal(daTese.ente.opcoes_no_padrao_da_tese, 11);
  assert.ok(daTese.flags.includes('polo_inferido_da_tese'));

  const cobrindo = montarItem(linha({
    cobrindo_qtd: 1, cobrindo_lista: [{ numero: '0801111-11.2026.8.15.2001', status: 'ativo', periodo_fim: null, visibilidade: 'normal' }],
  }), { hoje: HOJE });
  assert.ok(cobrindo.flags.includes('processo_cobrindo_periodo'));
  assert.equal(cobrindo.processos_cobrindo_periodo[0].numero, '0801111-11.2026.8.15.2001');

  const pe = montarItem(linha({ polo_passivo: 'Estado de Pernambuco', polo_vinculo_unico: 'Estado de Pernambuco' }), { hoje: HOJE });
  assert.ok(pe.flags.includes('ente_diverge_do_tribunal_anterior'));
  assert.equal(enteDivergeDoTribunal({ fonte_oficial: 'PB' }, 'TJPB'), false);
});

test('juízo: gabinete e núcleo de cumprimento vêm com aviso (não são juízo de origem)', () => {
  assert.match(avisoDoJuizo('Gabinete 09 - Des. Fulano', '1'), /2º grau/);
  assert.match(avisoDoJuizo('Núcleo de Justiça 4.0 de Cumprimento de Sentença Fazendário da Capital', '1'), /cumprimento/);
  assert.match(avisoDoJuizo('3ª Vara', '2'), /2º grau/);
  assert.equal(avisoDoJuizo('5ª Vara de Fazenda Pública da Capital', '1'), null);
  const item = montarItem(linha({ anterior_vara: 'Gabinete 14 - Des. Beltrano' }), { hoje: HOJE });
  assert.ok(item.flags.includes('juizo_nao_e_de_origem'));
});

test('processo anterior restrito: oculto para quem não pode ver restrito, visível para quem pode', () => {
  const r = linha({ anterior_visibilidade: 'restrito', anterior_numero: '0809999-99.2020.8.15.2001', anterior_vara: 'Vara Secreta',
    cobrindo_qtd: 1, cobrindo_lista: [{ numero: '0809999-99.2020.8.15.2001', status: 'ativo', periodo_fim: null, visibilidade: 'restrito' }] });
  const oculto = montarItem(r, { hoje: HOJE, podeVerRestrito: false });
  assert.deepEqual(oculto.processo_anterior, { restrito: true });
  assert.equal(oculto.juizo.origem, 'processo_restrito');
  assert.equal(JSON.stringify(oculto).includes('0809999-99.2020.8.15.2001'), false);
  assert.equal(JSON.stringify(oculto).includes('Vara Secreta'), false);

  const visivel = montarItem(r, { hoje: HOJE, podeVerRestrito: true });
  assert.equal(visivel.processo_anterior.numero, '0809999-99.2020.8.15.2001');
  assert.equal(visivel.juizo.vara, 'Vara Secreta');
});

// ── agrupamento e ordenação ──

test('agrupa por ente + juízo; grupos e itens ordenados pelo mês mais antigo', () => {
  const itens = [
    linha({ tarefa_id: 'a', cliente_id: 'c-a', cliente_nome: 'ANA', ciclo_inicio: '2023-05-01' }),
    linha({ tarefa_id: 'b', cliente_id: 'c-b', cliente_nome: 'BIA', ciclo_inicio: '2021-02-01' }),
    linha({ tarefa_id: 'c', cliente_id: 'c-c', cliente_nome: 'CAIO', ciclo_inicio: '2022-01-01',
      polo_passivo: 'Prefeitura de João Pessoa', polo_vinculo_unico: 'Prefeitura de João Pessoa' }),
    linha({ tarefa_id: 'd', cliente_id: 'c-d', cliente_nome: 'DORA', ciclo_inicio: '2024-03-01',
      polo_passivo: 'Município de João Pessoa', polo_vinculo_unico: 'Município de João Pessoa' }),
    linha({ tarefa_id: 'e', cliente_id: 'c-e', cliente_nome: 'EVA', ciclo_inicio: '2020-07-01',
      polo_passivo: 'Município de João Pessoa', polo_vinculo_unico: 'Município de João Pessoa', anterior_vara: '2ª Vara de Fazenda Pública da Capital' }),
    linha({ tarefa_id: 'f', cliente_id: 'c-f', cliente_nome: 'FABIO', ciclo_inicio: '2025-01-01',
      polo_passivo: 'Município de João Pessoa', polo_vinculo_unico: 'Município de João Pessoa' }),
  ].map(r => montarItem(r, { hoje: HOJE }));
  const grupos = agrupar(itens);
  assert.deepEqual(grupos.map(g => [g.ente.nome, g.juizo.vara, g.total]), [
    ['Município de João Pessoa', '2ª Vara de Fazenda Pública da Capital', 1],   // 2020-07
    ['Estado da Paraíba', '1º Juizado Especial da Fazenda Pública da Capital', 2], // 2021-02
    ['Município de João Pessoa', '1º Juizado Especial da Fazenda Pública da Capital', 3], // 2022-01
  ]);
  // "Prefeitura de João Pessoa" entrou no mesmo grupo; o nome exibido é a grafia mais frequente
  assert.deepEqual(grupos[2].itens.map(i => i.tarefa_id), ['c', 'd', 'f']);
  assert.deepEqual(grupos[1].itens.map(i => i.tarefa_id), ['b', 'a']);
  assert.equal(grupos[1].ciclo_inicio_mais_antigo, '2021-02');
});

test('ordenação estável: mesmo mês desempata por nome e id; sem início vai para o fim', () => {
  const itens = [
    linha({ tarefa_id: 'z', cliente_id: 'c1', cliente_nome: 'BRUNO', ciclo_inicio: '2022-01-01' }),
    linha({ tarefa_id: 'y', cliente_id: 'c2', cliente_nome: 'ALICE', ciclo_inicio: '2022-01-01' }),
    linha({ tarefa_id: 'x', cliente_id: 'c3', cliente_nome: 'AARAO', ciclo_inicio: null }),
  ].map(r => montarItem(r, { hoje: HOJE }));
  assert.deepEqual(agrupar(itens)[0].itens.map(i => i.tarefa_id), ['y', 'z', 'x']);
});

// ── serviço completo com banco simulado ──

function bancoSimulado({ linhas, adiados = 0, documentos = [] }) {
  const chamadas = [];
  return {
    chamadas,
    async queryOne(sql) {
      chamadas.push({ sql });
      if (sql === SQL_HOJE) return { hoje: HOJE };
      if (sql === SQL_ADIADOS) return { adiados };
      throw new Error(`queryOne inesperado: ${sql.slice(0, 60)}`);
    },
    async query(sql, params = []) {
      chamadas.push({ sql, params });
      if (sql === SQL_DOCUMENTOS) return documentos.filter(d => params[0].includes(d.cliente_id));
      if (sql.includes('FROM tarefas t')) return params.length ? linhas.filter(l => l.tarefa_id === params[0]) : linhas;
      throw new Error(`query inesperada: ${sql.slice(0, 60)}`);
    },
    async execute() { throw new Error('escrita proibida'); },
  };
}

test('SQL do levantamento usa exatamente os filtros das filas da tela de Tarefas', () => {
  const sql = sqlItens();
  for (const trecho of [TAREFA_ABERTA, FILA_REPROTOCOLO, FILA_CICLOS, CICLO_NAO_ADIADO]) assert.ok(sql.includes(trecho), trecho);
  assert.ok(sqlItens({ porTarefa: true }).includes('AND t.id = $1'));
  assert.ok(!/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i.test(sql + SQL_ADIADOS + SQL_DOCUMENTOS), 'somente SELECT');
});

test('seções corretas, totais por seção e nenhuma escrita no banco', async () => {
  const banco = bancoSimulado({
    adiados: 3,
    linhas: [
      linha({ tarefa_id: 'p1', secao: SECAO_PRONTOS, subtipo: 'ciclo_aceito', atribuido_a: 'u1', responsavel_nome: 'João', responsavel_ativo: true, prazo_data: '2026-10-06' }),
      linha({ tarefa_id: 'a1', cliente_id: 'c-2', cliente_nome: 'JOSE', cliente_cpf: '11122233344' }),
      linha({ tarefa_id: 'a2', cliente_id: 'c-3', cliente_nome: 'LUCIA', cliente_cpf: '55566677788', ciclo_inicio: '2019-01-01' }),
    ],
  });
  const bruto = await levantarReprotocolo({ conexao: banco });
  const saida = formatarLevantamento(bruto, { detalhe: 'itens' });
  assert.equal(saida.somente_leitura, true);
  assert.equal(saida.prontos.total, 1);
  assert.equal(saida.aguardando_autorizacao.total, 2);
  assert.equal(saida.aguardando_autorizacao.ciclos_adiados_fora_da_fila, 3);
  assert.equal(saida.aguardando_autorizacao.itens_com_meses_acima_5_anos, 1);
  assert.equal(saida.aguardando_autorizacao.meses_mais_5_anos_total, 33); // 2019-01 .. 2021-09
  assert.equal(saida.prontos.grupos[0].itens[0].responsavel.nome, 'João');
  assert.equal(banco.chamadas.some(c => /\b(INSERT|UPDATE|DELETE)\b/.test(c.sql)), false);
});

test('nunca mistura clientes: documentos e tarefas ficam com o cliente certo (mesmo com nomes iguais)', async () => {
  const banco = bancoSimulado({
    linhas: [
      linha({ tarefa_id: 't-a', cliente_id: 'c-a', cliente_nome: 'MARIA DA SILVA', cliente_cpf: '11111111111', tem_pasta_drive: true }),
      linha({ tarefa_id: 't-b', cliente_id: 'c-b', cliente_nome: 'MARIA DA SILVA', cliente_cpf: '22222222222', tem_pasta_drive: false,
        anterior_numero: '0802222-22.2023.8.15.2001', anterior_vara: '4ª Vara de Fazenda Pública da Capital' }),
    ],
    documentos: [
      { cliente_id: 'c-a', categoria: 'pessoais', quantidade: 2, primeiro_registro: '2026-01-10', ultimo_registro: '2026-03-02' },
      { cliente_id: 'c-z', categoria: 'vinculo', quantidade: 9, primeiro_registro: '2026-01-10', ultimo_registro: '2026-03-02' },
    ],
  });
  const saida = formatarLevantamento(await levantarReprotocolo({ conexao: banco }), { detalhe: 'itens' });
  const docs = saida.documentacao.clientes;
  assert.equal(docs.length, 2);
  const a = docs.find(c => c.cliente_id === 'c-a');
  const b = docs.find(c => c.cliente_id === 'c-b');
  assert.equal(a.documentos_registrados_no_am.total, 2);
  assert.equal(b.documentos_registrados_no_am.total, 0);
  assert.deepEqual(a.tarefas.map(t => t.tarefa_id), ['t-a']);
  assert.deepEqual(b.tarefas.map(t => t.tarefa_id), ['t-b']);
  assert.equal(a.cpf_mascarado, '***.***.*11-11');
  assert.equal(b.cpf_mascarado, '***.***.*22-22');
  assert.equal(a.pasta_drive_vinculada, true);
  assert.equal(b.pasta_drive_vinculada, false);
  // O documento de um cliente fora do levantamento (c-z) nunca é pedido nem somado
  const consultaDocs = banco.chamadas.find(c => c.sql === SQL_DOCUMENTOS);
  assert.deepEqual([...consultaDocs.params[0]].sort(), ['c-a', 'c-b']);
  assert.equal(saida.documentacao.totais.documentos_registrados_no_am, 2);
  // Cada item mantém o processo anterior da própria linha
  const itens = saida.aguardando_autorizacao.grupos.flatMap(g => g.itens);
  assert.equal(itens.find(i => i.tarefa_id === 't-b').processo_anterior.numero, '0802222-22.2023.8.15.2001');
  assert.equal(itens.find(i => i.tarefa_id === 't-a').processo_anterior.numero, '0800000-00.2022.8.15.2001');
});

test('documentação: regra de atualização explicitamente pendente, vocabulários não comparados', async () => {
  const banco = bancoSimulado({ linhas: [linha(), linha({ tarefa_id: 't-2', cliente_id: 'c-2', produto_nome: 'ADICIONAL NOTURNO', documentos_exigidos: null })] });
  const { documentacao } = formatarLevantamento(await levantarReprotocolo({ conexao: banco }), { detalhe: 'itens' });
  assert.equal(documentacao.regra_de_atualizacao.definida, false);
  assert.equal(documentacao.regra_de_atualizacao.situacao, 'pendente');
  assert.ok(documentacao.limitacoes.some(l => /vocabulários diferentes/.test(l)));
  assert.deepEqual(documentacao.totais.teses_com_checklist, ['FGTS']);
  assert.deepEqual(documentacao.totais.teses_sem_checklist, ['ADICIONAL NOTURNO']);
  const c1 = documentacao.clientes.find(c => c.cliente_id === 'c-1');
  assert.deepEqual(c1.exigidos_pela_tese, [{ tese: 'FGTS', categorias: ['identidade', 'cpf', 'residencia', 'contracheque'] }]);
  assert.equal('comparacao' in c1, false);
  assert.equal(JSON.stringify(documentacao).includes('vencido"'), false);
});

test('formato: resumo sem itens; limite por seção; filtro de ente não muda os totais', async () => {
  const linhas = Array.from({ length: 5 }, (_, i) => linha({
    tarefa_id: `t${i}`, cliente_id: `c${i}`, cliente_nome: `CLIENTE ${i}`, ciclo_inicio: `202${i}-01-01`,
    ...(i >= 3 ? { polo_passivo: 'Município de Bayeux', polo_vinculo_unico: 'Município de Bayeux' } : {}),
  }));
  const bruto = await levantarReprotocolo({ conexao: bancoSimulado({ linhas }) });

  const resumo = formatarLevantamento(bruto, { detalhe: 'resumo' });
  assert.equal(resumo.aguardando_autorizacao.total, 5);
  assert.ok(resumo.aguardando_autorizacao.grupos.every(g => !('itens' in g)));
  assert.equal('clientes' in resumo.documentacao, false);

  const limitado = formatarLevantamento(bruto, { detalhe: 'itens', limite: 2 });
  assert.equal(limitado.aguardando_autorizacao.itens_listados, 2);
  assert.equal(limitado.aguardando_autorizacao.itens_omitidos, 3);
  assert.equal(limitado.documentacao.clientes.length, 2);

  const filtrado = formatarLevantamento(bruto, { detalhe: 'itens', ente: 'bayeux' });
  assert.equal(filtrado.aguardando_autorizacao.total, 5, 'total continua sendo o da fila inteira');
  assert.equal(filtrado.aguardando_autorizacao.filtro_ente.itens, 2);
  assert.deepEqual(filtrado.aguardando_autorizacao.grupos.map(g => g.ente.nome), ['Município de Bayeux']);

  const soProntos = formatarLevantamento(bruto, { secao: 'prontos' });
  assert.equal(soProntos.aguardando_autorizacao, undefined);
  assert.equal(soProntos.prontos.total, 0);
});
