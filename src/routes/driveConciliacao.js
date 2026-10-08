// Conciliação Drive × tarefas de protocolo (Master): relatório de divergências e vínculo manual
// de pasta da equipe ao cliente. Ver services/drive/conciliacao.js.
import { Router } from 'express';
import { apenasMaster } from '../middleware/auth.js';
import { uuidValido } from '../utils/validacao.js';
import { relatorioConciliacao, vincularPasta, detectarProtocolosNoDrive } from '../services/drive/conciliacao.js';

export const driveConciliacaoRouter = Router();

const ID_DRIVE = /^[A-Za-z0-9_-]{10,100}$/;

driveConciliacaoRouter.get('/', apenasMaster, async (req, res) => {
  try {
    res.json({ ok: true, ...(await relatorioConciliacao()) });
  } catch (err) {
    console.error('[Drive/Conciliação] Relatório falhou:', err.message);
    res.status(502).json({ ok: false, erro: 'Não foi possível consultar o Google Drive agora. Confira a autorização do Google.' });
  }
});

driveConciliacaoRouter.post('/vincular', apenasMaster, async (req, res) => {
  const { cliente_id, pasta_id } = req.body || {};
  if (!uuidValido(cliente_id) || !ID_DRIVE.test(String(pasta_id || ''))) {
    return res.status(400).json({ ok: false, erro: 'Cliente ou pasta inválidos.' });
  }
  try {
    const { pasta } = await vincularPasta(cliente_id, pasta_id, { usuarioId: req.user.id });
    res.json({ ok: true, pasta: { id: pasta.id, nome: pasta.nome, url: pasta.url } });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, erro: err.message });
    console.error('[Drive/Conciliação] Vínculo falhou:', err.message);
    res.status(502).json({ ok: false, erro: 'Não foi possível consultar o Google Drive agora.' });
  }
});

// Roda o detector na hora (além do agendamento de 30 em 30 minutos).
driveConciliacaoRouter.post('/detectar', apenasMaster, async (req, res) => {
  try {
    res.json({ ok: true, ...(await detectarProtocolosNoDrive()) });
  } catch (err) {
    console.error('[Drive/Conciliação] Detector falhou:', err.message);
    res.status(502).json({ ok: false, erro: 'Não foi possível consultar o Google Drive agora.' });
  }
});
