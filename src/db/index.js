import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

// DATE (OID 1082) é dia de calendário, sem hora. O parser padrão devolve um Date à
// meia-noite local do servidor (UTC no Railway), que serializado vira 'YYYY-MM-DDT00:00:00.000Z'
// e no navegador do Brasil (UTC-3) exibe o dia ANTERIOR. Devolver a string crua resolve.
pg.types.setTypeParser(1082, v => v);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 40,
  idleTimeoutMillis: 60_000,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 60_000, // mata queries travadas após 60s
});

pool.on('error', (err) => {
  console.error('[DB] Erro inesperado no pool:', err.message);
});

// Wrapper que retorna rows diretamente
export const db = {
  async query(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows;
  },
  async queryOne(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows[0] ?? null;
  },
  async execute(sql, params = []) {
    const result = await pool.query(sql, params);
    return result;
  },
  pool,
};
