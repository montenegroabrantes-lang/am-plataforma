import { Router } from 'express';
import { db } from '../db/index.js';
import { criarConsultaDespachos, criarDownloadArquivo, criarListaArquivos, criarMetricasDespachos } from '../services/despachos.js';
import { criarRespostaConferencia, criarReaberturaConferencia } from '../services/despachosConferencias.js';

// A lista se atualiza sozinha a cada varredura do PJe. A única escrita da equipe é a resposta aos
// pedidos de conferência (Confirmar / Descartar), que a rotina passa a respeitar.
export const despachosRouter = Router();

despachosRouter.get('/', criarConsultaDespachos(db));

// Evolução das folhas ao longo dos dias (aba Métricas).
despachosRouter.get('/metricas', criarMetricasDespachos(db));

// Arquivos da última varredura (folhas em PDF e listas em planilha).
despachosRouter.get('/arquivos', criarListaArquivos(db));
despachosRouter.get('/arquivos/:id', criarDownloadArquivo(db));

// Pedidos de conferência: responder e reabrir (quem vê a tela pode responder; fica gravado quem e quando).
despachosRouter.post('/conferencias', criarRespostaConferencia(db));
despachosRouter.delete('/conferencias/:id', criarReaberturaConferencia(db));
