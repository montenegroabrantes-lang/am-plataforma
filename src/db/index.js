import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
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
