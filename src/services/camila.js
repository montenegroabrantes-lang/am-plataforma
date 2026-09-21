// Cliente HTTP compartilhado pra API da Camila — extraído de src/routes/estimativas.js pra
// ser reaproveitado também pelo worker de reprocessamento de sincronização (Fase 3 do
// cronograma de 20/09/2026), sem duplicar a leitura de env/timeout em dois lugares.
import axios from 'axios';

export function camila() {
  const baseURL = process.env.CAMILA_API_URL || process.env.CAMILA_ADMIN_URL;
  const apiKey  = process.env.CAMILA_API_KEY;
  if (!baseURL || !apiKey) return null;
  return axios.create({
    baseURL,
    headers: { 'x-api-key': apiKey },
    timeout: 10_000,
  });
}
