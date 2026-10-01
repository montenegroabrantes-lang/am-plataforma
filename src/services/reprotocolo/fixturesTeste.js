// Fixtures compartilhadas pelos testes do re-protocolo (não é arquivo de teste).
import { montarItem, SECAO_AGUARDANDO } from './levantamento.js';

export const HOJE = '2026-09-28';

export function linha(extra = {}) {
  return {
    tarefa_id: 't-1', secao: SECAO_AGUARDANDO, subtipo: 'ciclo', ciclo_inicio: '2024-01-01', ciclo_adiado_ate: null,
    cliente_id: 'c-1', cliente_nome: 'MARIA DA SILVA', cliente_cpf: '52998224725', cliente_ativo: true, cliente_vinculo_ativo: true,
    cliente_vinculo_fim: null, cliente_cargo: 'PROFESSOR', cliente_orgao: 'SEC', tem_pasta_drive: true, produto_id: 'p-fgts', produto_nome: 'FGTS',
    intervalo_meses: 25, documentos_exigidos: null, polo_passivo: 'Estado da Paraíba', polo_processo: null, polo_vinculo_unico: 'Estado da Paraíba',
    polo_cliente: 'Estado da Paraíba', polo_padrao_tese: null, padrao_tese_opcoes: 0, qtd_vinculos_ativos: 1, qtd_vinculos: 1, vinculos_ativos: [],
    vinculo_tarefa_id: null, anterior_id: 'proc-1', anterior_numero: '0800000-00.2022.8.15.2001', anterior_periodo_fim: '2023-12-01',
    anterior_status: 'ativo', anterior_vara: '1º Juizado', anterior_tribunal: 'TJPB', anterior_comarca: null, anterior_grau: '1',
    anterior_visibilidade: 'normal', cobrindo_qtd: 0, cobrindo_lista: [], processos_mesma_tese: 1, resp_proc_id: 'u1', resp_proc_nome: 'João',
    resp_proc_ativo: true, ...extra,
  };
}
export const item = (extra, hoje = HOJE) => montarItem(linha(extra), { hoje });
