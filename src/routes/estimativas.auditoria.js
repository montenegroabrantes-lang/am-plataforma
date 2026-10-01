import { auditarEscritasProxy } from '../middleware/auditoriaEscrita.js';

// S-13 — ações do router de Estimativas (proxy da Camila) que entram na trilha de auditoria.
// Chave = método + padrão da rota (o mesmo texto de req.route.path). `escalares` = campos de texto
// curto que podem ir para o log; o resto do corpo entra só como nomes de campos e tamanhos
// (ver auditoriaEscrita.js: texto de mensagem a lead nunca é registrado).
export const ROTAS_ESTIMATIVAS = {
  'POST /manual':                                       { acao: 'criar_estimativa_manual' },
  'POST /:id/aprovar':                                  { acao: 'aprovar_estimativa', escalares: ['valor'] },
  'POST /:id/retomar-entrega':                          { acao: 'retomar_entrega_estimativa' },
  'POST /:id/recusar':                                  { acao: 'recusar_estimativa', escalares: ['motivo'] },
  'POST /:id/restaurar-descarte':                       { acao: 'restaurar_descarte_estimativa' },
  'PATCH /:id/dados':                                   { acao: 'corrigir_dados_estimativa' },
  'POST /leads/:contactId/desfecho':                    { acao: 'registrar_desfecho_lead', entidade: 'lead', escalares: ['desfecho', 'valorFechado'] },
  'DELETE /leads/:contactId/desfecho':                  { acao: 'desfazer_desfecho_lead', entidade: 'lead' },
  'POST /onboarding-manual':                            { acao: 'cadastrar_onboarding_manual', entidade: 'onboarding', escalares: ['valorFechado'] },
  'POST /onboardings/:id/sincronizar-camila':           { acao: 'sincronizar_onboarding_camila', entidade: 'onboarding' },
  'POST /onboardings/:id/sincronizar-drive':            { acao: 'sincronizar_onboarding_drive', entidade: 'onboarding' },
  'POST /leads/:contactId/reabordar':                   { acao: 'reabordar_lead', entidade: 'lead' },
  'POST /leads/:contactId/entrega-manual':              { acao: 'entrega_manual_estimativa', entidade: 'lead', escalares: ['valor', 'estimativaId'] },
  'POST /leads/:contactId/passar-atendente':            { acao: 'passar_lead_atendente', entidade: 'lead' },
  'POST /leads/:contactId/mensagem':                    { acao: 'enviar_mensagem_lead', entidade: 'lead' },
  'POST /camila/mudancas':                              { acao: 'registrar_mudanca_camila', entidade: 'camila' },
  'POST /aprendizado-automatico/configuracao':          { acao: 'alterar_aprendizado_automatico', entidade: 'camila' },
  'POST /aprendizado-automatico/:codigo/desativar':     { acao: 'desativar_aprendizado_automatico', entidade: 'camila' },
  'PATCH /pendencias-processuais/:contactId':           { acao: 'atualizar_pendencia_processual', entidade: 'lead' },
  'PATCH /leads/:contactId/continuidade':               { acao: 'alterar_continuidade_lead', entidade: 'lead' },
  'PATCH /leads/:contactId/documentos/:messageId':      { acao: 'conferir_documento_lead', entidade: 'lead' },
  'POST /leads/:contactId/liberar-reenvio':             { acao: 'liberar_reenvio_lead', entidade: 'lead' },
  'POST /leads/:contactId/confirmar-envio':             { acao: 'confirmar_envio_lead', entidade: 'lead' },
  'POST /leads/:contactId/fase-contrato':               { acao: 'alterar_fase_contrato_lead', entidade: 'lead', escalares: ['fase'] },
  'POST /sinteses-aprendizado/:id/decidir':             { acao: 'decidir_sintese_aprendizado', entidade: 'camila', escalares: ['decisao'] },
  'POST /achados-monitoramento/:id/decidir':            { acao: 'decidir_achado_monitoramento', entidade: 'camila', escalares: ['decisao'] },
  'POST /aprendizado-atendimentos/:contactId/decidir':  { acao: 'decidir_aprendizado_atendimento', entidade: 'lead', escalares: ['decisao'] },
};

export const auditarEstimativas = auditarEscritasProxy(ROTAS_ESTIMATIVAS);
