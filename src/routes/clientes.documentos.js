import { Router }   from 'express';
import multer        from 'multer';
import { Readable }  from 'stream';
import { db }        from '../db/index.js';
import { registrarAuditoria } from '../middleware/auditoria.js';
import { mensagemComCodigo } from '../middleware/erros.js';
import { uuidValido } from '../utils/validacao.js';
import { uploadPdf } from '../services/drive/index.js';
import { criarPastaDoCliente } from '../services/drive/conciliacao.js';
import { ehPdf, limiteDeUploadDoPerfil, LIMITE_MAXIMO_UPLOAD } from '../utils/arquivoPdf.js';

// Documentos do cliente (upload de PDF para o Drive). Montado por clientes.js em
// /api/clientes/:id/documentos. Vive em arquivo próprio para o teste trocar o Drive por um
// objeto falso (S-24).
//
// S-24 (30/09/2026): só PDF de verdade (confere a assinatura %PDF- do conteúdo, não o nome nem o
// Content-Type que o navegador informa), 1 arquivo por envio, limite de tamanho por perfil e
// auditoria de envio e exclusão (antes o `enviado_por` ficava vazio e nada ia para o log).

const CATS_VALIDAS = ['pessoais', 'vinculo', 'procuracao', 'outro'];

export function criarDocumentosRouter({
  banco = db,
  drive = { criarPastaCliente: (cpf, nome, cliente) => criarPastaDoCliente(cliente), uploadPdf },
  auditar = registrarAuditoria,
} = {}) {
  const router = Router({ mergeParams: true });
  // Rejeita :id malformado antes de bater no banco (o mesmo cuidado do router de clientes).
  router.use((req, res, next) => (uuidValido(req.params.id) ? next() : res.status(400).json({ ok: false, erro: 'ID inválido.' })));
  // O multer não pode ser mais permissivo que o maior limite por perfil; o limite do perfil é
  // conferido logo depois de o arquivo chegar.
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: LIMITE_MAXIMO_UPLOAD, files: 1 } });

  // GET /api/clientes/:id/documentos
  router.get('/', async (req, res) => {
    const rows = await banco.query(
      `SELECT id, nome, categoria, drive_url, criado_em
       FROM documentos WHERE cliente_id = $1 AND deletado = false
       ORDER BY categoria, criado_em DESC`,
      [req.params.id]
    );
    res.json({ ok: true, documentos: rows });
  });

  // POST /api/clientes/:id/documentos — upload PDF para o Drive
  router.post('/', upload.single('arquivo'), async (req, res) => {
    const clienteId = req.params.id;
    const { categoria = 'outro', nome } = req.body;

    if (!CATS_VALIDAS.includes(categoria)) {
      return res.status(400).json({ ok: false, erro: 'Categoria inválida.' });
    }
    if (!req.file) {
      return res.status(400).json({ ok: false, erro: 'Nenhum arquivo enviado.' });
    }
    if (!ehPdf(req.file.buffer)) {
      return res.status(415).json({ ok: false, erro: 'Envie um PDF.' });
    }
    const limite = limiteDeUploadDoPerfil(req.user?.perfil);
    if (req.file.size > limite) {
      return res.status(413).json({ ok: false, erro: `Arquivo grande demais. O limite para o seu perfil é ${Math.round(limite / 1024 / 1024)} MB.` });
    }

    const cliente = await banco.queryOne(
      `SELECT id, nome, cpf, polo_passivo, drive_pasta_id FROM clientes WHERE id = $1`, [clienteId]
    );
    if (!cliente) return res.status(404).json({ ok: false, erro: 'Cliente não encontrado.' });

    let pastaId = cliente.drive_pasta_id;
    if (!pastaId) {
      try {
        const { id, url } = await drive.criarPastaCliente(cliente.cpf || clienteId, cliente.nome, cliente);
        pastaId = id;
        await banco.execute(`UPDATE clientes SET drive_pasta_id=$1, drive_pasta_url=$2 WHERE id=$3`, [id, url, clienteId]);
      } catch (err) {
        // A mensagem do Drive vai só para o log (S-22); o usuário recebe o código.
        return res.status(500).json({ ok: false, erro: mensagemComCodigo('Não foi possível criar a pasta do cliente no Google Drive.', err, req) });
      }
    }

    const nomeArquivo = (nome || `${categoria}_${Date.now()}`).replace(/[^\w\-. ]/g, '_') + '.pdf';
    let driveUrl = null, driveFileId = null;
    try {
      const stream    = Readable.from(req.file.buffer);
      const uploaded  = await drive.uploadPdf(pastaId, nomeArquivo, stream);
      driveUrl        = uploaded.url;
      driveFileId     = uploaded.id;
    } catch (err) {
      return res.status(500).json({ ok: false, erro: mensagemComCodigo('Não foi possível enviar o arquivo ao Google Drive.', err, req) });
    }

    const [doc] = await banco.query(
      `INSERT INTO documentos (cliente_id, nome, categoria, drive_file_id, drive_url, enviado_por)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, nome, categoria, drive_url, criado_em`,
      [clienteId, nome || nomeArquivo, categoria, driveFileId, driveUrl, req.user?.id ?? null]
    );

    await auditar({
      usuarioId: req.user?.id, acao: 'enviar_documento', entidade: 'documento', entidadeId: doc.id,
      valorDepois: { cliente_id: clienteId, categoria, tamanho: req.file.size }, ip: req._ip,
    });

    res.status(201).json({ ok: true, documento: doc });
  });

  // DELETE /api/clientes/:id/documentos/:docId
  router.delete('/:docId', async (req, res) => {
    const r = await banco.execute(
      `UPDATE documentos SET deletado = true WHERE id = $1 AND cliente_id = $2 AND deletado = false RETURNING id, categoria`,
      [req.params.docId, req.params.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ ok: false, erro: 'Documento não encontrado.' });

    await auditar({
      usuarioId: req.user?.id, acao: 'excluir_documento', entidade: 'documento', entidadeId: req.params.docId,
      valorAntes: { cliente_id: req.params.id, categoria: r.rows?.[0]?.categoria ?? null }, ip: req._ip,
    });

    res.json({ ok: true });
  });

  return router;
}

export const documentosRouter = criarDocumentosRouter();
