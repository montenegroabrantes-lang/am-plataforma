import { google } from 'googleapis';

const CALENDAR_ID = 'primary';

function auth() {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return oauth2;
}

function calendarClient() {
  return google.calendar({ version: 'v3', auth: auth() });
}

export async function criarEventoCalendar({ titulo, dataHora, tipo, vara, tribunal, processoId, descricao: descricaoCustom }) {
  if (!process.env.GOOGLE_REFRESH_TOKEN || process.env.GOOGLE_REFRESH_TOKEN === 'configurar_no_railway') {
    console.warn('[Calendar] GOOGLE_REFRESH_TOKEN não configurado — evento não criado.');
    return null;
  }

  const calendar  = calendarClient();
  const inicio    = new Date(dataHora);
  const fim       = new Date(inicio.getTime() + 60 * 60 * 1000); // +1h

  const descricao = descricaoCustom || [
    tipo    ? `Tipo: ${tipo}`      : '',
    vara    ? `Vara: ${vara}`      : '',
    tribunal ? `Tribunal: ${tribunal}` : '',
    processoId ? `Processo ID: ${processoId}` : '',
  ].filter(Boolean).join('\n');

  const event = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    requestBody: {
      summary:     titulo,
      description: descricao,
      start: { dateTime: inicio.toISOString() },
      end:   { dateTime: fim.toISOString() },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 2880 }, // 48h antes
          { method: 'popup', minutes: 120 },  // 2h antes
        ],
      },
    },
  });

  return event.data.id;
}

export async function atualizarEventoCalendar(eventId, { dataHora }) {
  if (!process.env.GOOGLE_REFRESH_TOKEN || process.env.GOOGLE_REFRESH_TOKEN === 'configurar_no_railway') return;

  const calendar = calendarClient();
  const inicio   = new Date(dataHora);
  const fim      = new Date(inicio.getTime() + 60 * 60 * 1000);

  await calendar.events.patch({
    calendarId: CALENDAR_ID,
    eventId,
    requestBody: {
      start: { dateTime: inicio.toISOString() },
      end:   { dateTime: fim.toISOString() },
    },
  });
}

export async function deletarEventoCalendar(eventId) {
  if (!process.env.GOOGLE_REFRESH_TOKEN || process.env.GOOGLE_REFRESH_TOKEN === 'configurar_no_railway') return;
  const calendar = calendarClient();
  await calendar.events.delete({ calendarId: CALENDAR_ID, eventId });
}
