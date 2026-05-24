import { google } from 'googleapis';

function auth() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
}

function driveClient() {
  const oauth2 = auth();
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.drive({ version: 'v3', auth: oauth2 });
}

// Cria pasta do cliente: Raiz → {CPF} — {Nome}
export async function criarPastaCliente(cpf, nome) {
  const drive    = driveClient();
  const pastaRaiz = process.env.GOOGLE_DRIVE_PASTA_RAIZ;

  const pasta = await drive.files.create({
    requestBody: {
      name:     `${cpf} — ${nome}`,
      mimeType: 'application/vnd.google-apps.folder',
      parents:  [pastaRaiz],
    },
    fields: 'id, webViewLink',
  });

  return {
    id:  pasta.data.id,
    url: pasta.data.webViewLink,
  };
}

// Cria subpasta dentro da pasta do cliente (ex: "Documentos", "Petições")
export async function criarSubpasta(pastaClienteId, nome) {
  const drive = driveClient();

  const pasta = await drive.files.create({
    requestBody: {
      name:     nome,
      mimeType: 'application/vnd.google-apps.folder',
      parents:  [pastaClienteId],
    },
    fields: 'id, webViewLink',
  });

  return { id: pasta.data.id, url: pasta.data.webViewLink };
}

// Faz upload de um PDF para a pasta do cliente
export async function uploadPdf(pastaId, nomeArquivo, bufferOuStream) {
  const drive = driveClient();

  const arquivo = await drive.files.create({
    requestBody: {
      name:    nomeArquivo,
      parents: [pastaId],
    },
    media: {
      mimeType: 'application/pdf',
      body:     bufferOuStream,
    },
    fields: 'id, webViewLink',
  });

  return { id: arquivo.data.id, url: arquivo.data.webViewLink };
}
