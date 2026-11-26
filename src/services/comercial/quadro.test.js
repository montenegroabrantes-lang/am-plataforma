import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarQuadro, cartaoDoLead, cartaoDoFechamento, LIMITES_DIAS } from './quadro.js';

const agora = new Date('2026-11-25T12:00:00Z');
const ha = dias => new Date(agora - dias * 86_400_000).toISOString();

test('lead: só entra da proposta em diante, sem desfecho e sem fechamento ativo', () => {
  assert.equal(cartaoDoLead({ contact_id: 1, etapa: 'simulou' }, agora), null);
  assert.equal(cartaoDoLead({ contact_id: 1, etapa: 'perdido' }, agora), null);
  assert.equal(cartaoDoLead({ etapa: 'proposta_enviada' }, agora), null);
  assert.equal(cartaoDoLead({ contact_id: 1, etapa: 'assinado', onboarding: { status: 'protocolo_pendente' } }, agora), null);
  assert.equal(cartaoDoLead({ contact_id: 1, etapa: 'assinado', onboarding: { status: 'cancelado' } }, agora).coluna, 'ativar');
});

test('lead: dias contam do último contato; atraso pelo limite da coluna; link para a estimativa', () => {
  const c = cartaoDoLead({ contact_id: 'a b', nome: 'Maria', etapa: 'proposta_enviada', valor: 100, proposta_enviada_em: ha(20), ultima_cliente_em: ha(6), ultima_equipe_em: ha(9) }, agora);
  assert.deepEqual([c.coluna, c.dias, c.atrasado, c.limite_dias], ['proposta', 6, true, LIMITES_DIAS.proposta]);
  assert.equal(c.link, '/estimativas?aba=leads&lead=a%20b');
  assert.equal(cartaoDoLead({ contact_id: 1, etapa: 'proposta_enviada', proposta_enviada_em: ha(5) }, agora).atrasado, false);
  assert.equal(cartaoDoLead({ contact_id: 1, etapa: 'contrato_enviado' }, agora).dias, null);
  assert.equal(cartaoDoLead({ contact_id: 1, etapa: 'documentos_completos' }, agora).proximo_passo, 'Preparar o contrato');
  assert.equal(cartaoDoLead({ contact_id: 1, etapa: 'contrato_enviado', aguardando_nossa_resposta: true }, agora).proximo_passo, 'Responder o cliente');
});

test('fechamento: cadastro conta do fechamento e leva à ficha', () => {
  const c = cartaoDoFechamento({ id: 'o1', status: 'cadastro_pendente', nome: 'José', fechado_em: ha(60), responsavel_cadastro_nome: 'Ana' }, [], agora);
  assert.deepEqual([c.coluna, c.dias, c.atrasado, c.responsavel, c.link], ['cadastro', 60, true, 'Ana', '/onboardings/o1']);
  assert.equal(cartaoDoFechamento({ id: 'x', status: 'cancelado' }, [], agora), null);
});

test('fechamento: protocolo conta do cadastro concluído e avisa o que já está no Drive', () => {
  const tarefas = [
    { tipo: 'cadastro_cliente', status: 'concluida', concluida_em: ha(10) },
    { tipo: 'protocolar', status: 'concluida' },
    { tipo: 'protocolar', status: 'pendente', drive_protocolo_detectado_em: ha(1) },
    { tipo: 'protocolar', status: 'cancelada' },
  ];
  const c = cartaoDoFechamento({ id: 'o2', status: 'protocolo_pendente', cliente_nome: 'JOSÉ', fechado_em: ha(40), responsavel_protocolo_nome: 'Bia' }, tarefas, agora);
  assert.deepEqual([c.dias, c.atrasado, c.responsavel], [10, true, 'Bia']);
  assert.equal(c.detalhe, '1 de 2 ações protocoladas · 1 já no Drive, falta o número');
  assert.equal(c.proximo_passo, 'Informar o número do processo');
  assert.equal(c.link, '/tarefas?onboarding_id=o2&tipo=protocolar');
});

test('quadro: sete colunas na ordem, mais parados primeiro, contagem de atrasados', () => {
  const q = montarQuadro({
    agora,
    leads: [{ contact_id: 1, etapa: 'proposta_enviada', proposta_enviada_em: ha(2) }, { contact_id: 2, etapa: 'entregue_manual', entregue_em: ha(9) }, { contact_id: 3, etapa: 'abordado' }],
    fechamentos: [{ id: 'o1', status: 'cadastro_pendente', fechado_em: ha(1) }, { id: 'o2', status: 'concluido', atualizado_em: ha(3) }],
    tarefas: [{ onboarding_id: 'o1', tipo: 'protocolar', status: 'bloqueada' }],
  });
  assert.deepEqual(q.map(c => [c.id, c.total, c.atrasados]), [['proposta', 2, 1], ['documentos', 0, 0], ['contrato', 0, 0], ['ativar', 0, 0], ['cadastro', 1, 0], ['protocolo', 0, 0], ['concluido', 1, 0]]);
  assert.deepEqual(q[0].cartoes.map(c => c.dias), [9, 2]);
  assert.equal(q[6].cartoes[0].atrasado, false);
});
