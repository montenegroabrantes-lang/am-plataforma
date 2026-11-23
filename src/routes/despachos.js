import { Router } from 'express';
import { db } from '../db/index.js';
import { criarConsultaDespachos, criarDownloadArquivo, criarListaArquivos } from '../services/despachos.js';

// Somente consulta: a lista se atualiza sozinha a cada varredura do PJe.
export const despachosRouter = Router();

despachosRouter.get('/', criarConsultaDespachos(db));

// Arquivos da última varredura (folhas em PDF e listas em planilha).
despachosRouter.get('/arquivos', criarListaArquivos(db));
despachosRouter.get('/arquivos/:id', criarDownloadArquivo(db));
