import { Router } from 'express';
import { db } from '../db/index.js';
import { criarConsultaDespachos } from '../services/despachos.js';

// Somente consulta: a lista se atualiza sozinha a cada varredura do PJe.
export const despachosRouter = Router();

despachosRouter.get('/', criarConsultaDespachos(db));
