import 'dotenv/config';
import express            from 'express';
import cors               from 'cors';
import cookieParser       from 'cookie-parser';
import rateLimit          from 'express-rate-limit';
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
import { triagemRouter }       from './routes/triagem.js';
import { monitoramentoRouter } from './routes/monitoramento.js';
import { rankingsRouter }      from './routes/rankings.js';
import { polosPassivosRouter } from './routes/polosPassivos.js';
import { webhookRouter }       from './routes/webhook.js';

// Middleware
import { autenticar } from './middleware/auth.js';
import { auditar }    from './middleware/auditoria.js';

const app  = express();
const PORT = process.env.PORT || 3001;

// Railway (e qualquer reverse proxy) injeta X-Forwarded-For.
// Sem trust proxy, o express-rate-limit rejeita todas as requisições com ValidationError.
app.set('trust proxy', 1);

const allowedOrigin = process.env.FRONTEND_URL || 'http://localhost:3000';
if (!process.env.FRONTEND_URL) {
  console.warn('[WARN] FRONTEND_URL não definida — usando localhost. Defina em produção.');
}
app.use(cors({ origin: allowedOrigin, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(auditar);

let dbOk = false;

// Healthcheck SEMPRE responde — Railway depende disso
app.get('/health', (_req, res) => res.json({ ok: true, db: dbOk, env: process.env.NODE_ENV }));

// Gate: até o DB conectar, rejeita o resto com 503 (não 500 silencioso)
app.use((req, res, next) => {
  if (!dbOk) return res.status(503).json({ ok: false, erro: 'Serviço iniciando — tente novamente em alguns segundos.' });
  next();
});

// Rate limiting no login — máx 20 tentativas por 15 min por IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, erro: 'Muitas tentativas. Aguarde 15 minutos.' },
});

// Rotas públicas
app.use('/api/auth/login', loginLimiter);
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
app.use('/api/triagem',        autenticar, triagemRouter);
app.use('/api/monitoramento', autenticar, monitoramentoRouter);
app.use('/api/rankings',      autenticar, rankingsRouter);
app.use('/api/polos-passivos', autenticar, polosPassivosRouter);
// Webhook público — CNJ faz POST sem sessão do usuário
app.use('/api/webhook',       webhookRouter);

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
    await db.query(`ALTER TABLE processos ADD COLUMN IF NOT EXISTS data_conclusao_bloqueio DATE`).catch(() => {});
    await db.query(`ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS justificativa_cancelamento TEXT`).catch(() => {});
    await db.query(`ALTER TABLE processos ADD COLUMN IF NOT EXISTS periodo_inicio DATE`).catch(() => {});
    await db.query(`ALTER TABLE processos ADD COLUMN IF NOT EXISTS periodo_fim DATE`).catch(() => {});
    await db.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS vinculo_inicio DATE`).catch(() => {});
    await db.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS vinculo_fim DATE`).catch(() => {});
    await db.query(`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS intervalo_meses INTEGER`).catch(() => {});
    await db.query(`ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS observacao TEXT`).catch(() => {});
    await db.query(`
      CREATE TABLE IF NOT EXISTS polos_passivos (
        id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nome      TEXT NOT NULL UNIQUE,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});
    await db.query(`
      INSERT INTO polos_passivos (nome) VALUES
        ('Estado da Paraíba'),('Estado do Ceará'),('Estado do Rio Grande do Norte'),
        ('Estado de Pernambuco'),('Município de João Pessoa'),('Município de Campina Grande'),
        ('Município de Natal'),('Município de Fortaleza'),('Município de Recife'),
        ('União Federal'),('INSS'),('Município — Outro')
      ON CONFLICT (nome) DO NOTHING
    `).catch(() => {});
    // Atualizar descrição de tarefas de ciclo recorrente existentes para incluir período
    await db.query(`
      UPDATE tarefas t
      SET descricao = CONCAT(
        'Protocolar processo — ', pr.nome, ' — ', c.nome,
        ' | Período a solicitar: ',
        TO_CHAR(DATE_TRUNC('month', p.periodo_fim + INTERVAL '1 month'), 'MM/YYYY'),
        ' a ',
        TO_CHAR(DATE_TRUNC('month', p.periodo_fim + (pr.intervalo_meses || ' months')::INTERVAL), 'MM/YYYY')
      )
      FROM cliente_produtos cp
      JOIN clientes c ON c.id = cp.cliente_id
      JOIN produtos pr ON pr.id = cp.produto_id
      JOIN (
        SELECT DISTINCT ON (cliente_id, produto_id) cliente_id, produto_id, periodo_fim
        FROM processos
        WHERE periodo_fim IS NOT NULL
        ORDER BY cliente_id, produto_id, periodo_fim DESC
      ) p ON p.cliente_id = cp.cliente_id AND p.produto_id = cp.produto_id
      WHERE t.cliente_produto_id = cp.id
        AND t.tipo = 'protocolar'
        AND t.status NOT IN ('concluida', 'cancelada')
        AND pr.intervalo_meses IS NOT NULL
        AND t.descricao NOT LIKE '%Período a solicitar%'
    `).catch(e => console.warn('[Migration] Atualização descrição tarefas ciclo:', e.message));

    const { recarregarAiConfig } = await import('./config/ai.js');
    await recarregarAiConfig(db);
  } catch (err) {
    console.error('[FATAL] PostgreSQL falhou:', err.stack || err);
    process.exit(1);
  }

  if (process.env.REDIS_URL) {
    try {
      await conectarRedis();

      // Restart sempre mata qualquer sync em andamento — limpa locks e flags incondicionalmente
      try {
        const { redis } = await import('./cache/redis.js');
        await redis.del('sync:global:lock');
        // Flags de progresso (polos/classif): se o processo morreu no meio, rodando=true ficaria preso
        await redis.del('polos:progress');
        await redis.del('classif:progress');
        console.log('[BOOT] Locks e flags de progresso liberados (restart).');
      } catch (err) {
        console.warn('[BOOT] Falha ao limpar locks:', err.message);
      }

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

iniciar().catch(err => {
  console.error('[FATAL] Erro fatal durante boot:', err);
  process.exit(1);
});
