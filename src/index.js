import 'dotenv/config';
import express            from 'express';
import cors               from 'cors';
import { db }             from './db/index.js';
import { conectarRedis }  from './cache/redis.js';

// Rotas
import { authRouter }          from './routes/auth.js';
import { usuariosRouter }      from './routes/usuarios.js';
import { processosRouter }     from './routes/processos.js';
import { movimentacoesRouter } from './routes/movimentacoes.js';
import { credenciaisRouter }   from './routes/credenciais.js';
import { configAiRouter }      from './routes/config.ai.js';
import { clientesRouter }      from './routes/clientes.js';
import { agendaRouter }        from './routes/agenda.js';
import { tarefasRouter }       from './routes/tarefas.js';
import { financeiroRouter }    from './routes/financeiro.js';
import { pipelineRouter }      from './routes/pipeline.js';
import { relatorioRouter }     from './routes/relatorio.js';
import { produtosRouter }      from './routes/produtos.js';
import { dashboardRouter }     from './routes/dashboard.js';

// Middleware
import { autenticar } from './middleware/auth.js';
import { auditar }    from './middleware/auditoria.js';

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
}));
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
app.use('/api/clientes',      autenticar, clientesRouter);
app.use('/api/agenda',        autenticar, agendaRouter);
app.use('/api/tarefas',       autenticar, tarefasRouter);
app.use('/api/financeiro',    autenticar, financeiroRouter);
app.use('/api/pipeline',      autenticar, pipelineRouter);
app.use('/api/relatorio',     autenticar, relatorioRouter);
app.use('/api/produtos',      autenticar, produtosRouter);
app.use('/api/dashboard',    autenticar, dashboardRouter);

let dbOk = false;
app.get('/health', (_req, res) => res.json({ ok: true, db: dbOk, env: process.env.NODE_ENV }));

// Sobe o servidor imediatamente para o healthcheck passar
app.listen(PORT, () => {
  console.log(`[API] AM Plataforma escutando na porta ${PORT}`);
});

async function iniciar() {
  console.log('[BOOT] Iniciando AM Plataforma...');
  console.log('[BOOT] NODE_ENV:', process.env.NODE_ENV);
  console.log('[BOOT] PORT:', PORT);
  console.log('[BOOT] DATABASE_URL:', process.env.DATABASE_URL ? 'definida' : 'AUSENTE');
  console.log('[BOOT] REDIS_URL:', process.env.REDIS_URL ? 'definida' : 'AUSENTE');

  try {
    await db.query('SELECT 1');
    dbOk = true;
    console.log('[DB] PostgreSQL conectado.');
    const { recarregarAiConfig } = await import('./config/ai.js');
    await recarregarAiConfig(db);
  } catch (err) {
    console.error('[FATAL] PostgreSQL falhou:', err.stack || err);
    process.exit(1);
  }

  if (process.env.REDIS_URL) {
    try {
      await conectarRedis();

      // Restart sempre mata qualquer sync em andamento — limpa o lock incondicionalmente
      try {
        const { redis } = await import('./cache/redis.js');
        await redis.del('sync:global:lock');
        console.log('[BOOT] Lock de sync liberado (restart).');
      } catch { /* não bloqueia o boot */ }

      const { iniciarWorkers } = await import('./workers/index.js');
      await iniciarWorkers();
    } catch (err) {
      console.error('[WARN] Redis/Workers falharam — continuando sem eles:', err.message);
    }
  } else {
    console.log('[WARN] REDIS_URL não definida — workers desativados.');
  }

  console.log('[BOOT] Inicialização concluída.');
}

iniciar();
