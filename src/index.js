import 'dotenv/config';
import express            from 'express';
import { db }             from './db/index.js';
import { conectarRedis }  from './cache/redis.js';
import { iniciarWorkers } from './workers/index.js';

// Rotas
import { authRouter }      from './routes/auth.js';
import { usuariosRouter }  from './routes/usuarios.js';
import { processosRouter } from './routes/processos.js';
import { movimentacoesRouter } from './routes/movimentacoes.js';
import { credenciaisRouter }   from './routes/credenciais.js';
import { configAiRouter }      from './routes/config.ai.js';

// Middleware
import { autenticar } from './middleware/auth.js';
import { auditar }    from './middleware/auditoria.js';

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(auditar);

// Rotas públicas
app.use('/api/auth', authRouter);

// Rotas protegidas
app.use('/api/usuarios',      autenticar, usuariosRouter);
app.use('/api/processos',     autenticar, processosRouter);
app.use('/api/movimentacoes', autenticar, movimentacoesRouter);
app.use('/api/credenciais',   autenticar, credenciaisRouter);
app.use('/api/config/ai',     autenticar, configAiRouter);

app.get('/health', (_req, res) => res.json({ ok: true, env: process.env.NODE_ENV }));

async function iniciar() {
  try {
    await db.query('SELECT 1');
    console.log('[DB] PostgreSQL conectado.');

    await conectarRedis();
    await iniciarWorkers();

    app.listen(PORT, () => {
      console.log(`[API] AM Plataforma rodando na porta ${PORT}`);
    });
  } catch (err) {
    console.error('[FATAL] Falha ao iniciar:', err.message);
    process.exit(1);
  }
}

iniciar();
