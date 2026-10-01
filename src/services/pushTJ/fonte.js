// De onde o push do TJPB lê os e-mails: IMAP (Gmail ou outro provedor) ou Outlook/Graph.
// Quando os dois estão configurados, o IMAP vence — é o caminho que não depende de
// aplicativo registrado na Microsoft. Worker, inicialização e rota de saúde usam isto.

import { imapConfigurado } from '../imap/leitor.js';
import { outlookConfigurado } from '../outlook/auth.js';

export function fontePush(env = process.env) {
  if (imapConfigurado(env)) return 'imap';
  if (outlookConfigurado(env)) return 'outlook';
  return null;
}

export function remetentePush(env = process.env) {
  return env.PUSH_TJ_REMETENTE || env.OUTLOOK_PUSH_REMETENTE || 'pje@tjpb.jus.br';
}
