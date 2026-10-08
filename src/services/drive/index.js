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

// Upload de backup (.sql.gz) para pasta de backups no Drive
export async function uploadBackup(nomeArquivo, stream) {
  const drive   = driveClient();
  const pastaId = process.env.GOOGLE_DRIVE_PASTA_BACKUP;

  if (!pastaId) throw new Error('GOOGLE_DRIVE_PASTA_BACKUP não configurada.');

  const arquivo = await drive.files.create({
    requestBody: {
      name:    nomeArquivo,
      parents: [pastaId],
    },
    media: {
      mimeType: 'application/gzip',
      body:     stream,
    },
    fields: 'id, webViewLink',
  });

  return { id: arquivo.data.id, url: arquivo.data.webViewLink };
}

// Remove backups antigos da pasta (mantém os N mais recentes)
export async function limparBackupsAntigos(manter = 7) {
  const drive   = driveClient();
  const pastaId = process.env.GOOGLE_DRIVE_PASTA_BACKUP;
  if (!pastaId) return;

  const res = await drive.files.list({
    q:       `'${pastaId}' in parents and name contains 'backup-' and trashed = false`,
    fields:  'files(id, name, createdTime)',
    orderBy: 'createdTime desc',
  });

  const arquivos = res.data.files || [];
  const antigos  = arquivos.slice(manter);
  for (const f of antigos) {
    await drive.files.delete({ fileId: f.id }).catch(() => {});
  }
}

// ── Pastas da equipe (Pendentes a protocolar → Outorgantes) ─────────────────

// Cria uma pasta com nome livre dentro de `paiId` (sem subpastas).
export async function criarPasta(nome, paiId) {
  const drive = driveClient();
  const pasta = await drive.files.create({
    requestBody: { name: nome, mimeType: 'application/vnd.google-apps.folder', parents: [paiId] },
    fields: 'id, webViewLink',
  });
  return { id: pasta.data.id, url: pasta.data.webViewLink };
}

// Lista as subpastas (não apagadas) de `paiId`, paginando até o fim.
export async function listarSubpastas(paiId) {
  const drive = driveClient();
  const pastas = [];
  let pageToken;
  do {
    const res = await drive.files.list({
      q: `'${paiId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'nextPageToken, files(id, name, webViewLink, createdTime, modifiedTime)',
      pageSize: 1000,
      pageToken,
    });
    pastas.push(...(res.data.files || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return pastas.map(p => ({ id: p.id, nome: p.name, url: p.webViewLink, criada_em: p.createdTime, alterada_em: p.modifiedTime }));
}

// Pais, nome e link de um arquivo/pasta.
export async function dadosDaPasta(id) {
  const drive = driveClient();
  const res = await drive.files.get({ fileId: id, fields: 'id, name, parents, webViewLink, trashed' });
  return { id: res.data.id, nome: res.data.name, pais: res.data.parents || [], url: res.data.webViewLink, apagada: !!res.data.trashed };
}

// Move a pasta `id` de `dePaiId` para `paraPaiId` (não copia; o link continua o mesmo).
export async function moverPasta(id, dePaiId, paraPaiId) {
  const drive = driveClient();
  await drive.files.update({ fileId: id, addParents: paraPaiId, removeParents: dePaiId, fields: 'id, parents' });
}

// Arquivos (não pastas) de `paiId`: nome, tipo e data. Uma página basta para pasta de cliente.
export async function listarArquivos(paiId) {
  const drive = driveClient();
  const res = await drive.files.list({
    q: `'${paiId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name, mimeType, createdTime)',
    pageSize: 200,
  });
  return (res.data.files || []).map(f => ({ id: f.id, nome: f.name, tipo: f.mimeType, criado_em: f.createdTime }));
}

// Conteúdo binário de um arquivo (usado só para ler o texto do comprovante de protocolo).
export async function baixarArquivo(id) {
  const drive = driveClient();
  const res = await drive.files.get({ fileId: id, alt: 'media' }, { responseType: 'arraybuffer' });
  return Buffer.from(res.data);
}
