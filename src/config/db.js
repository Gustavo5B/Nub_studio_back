import pkg from 'pg';
const { Pool } = pkg;
import dotenv from "dotenv";
import logger from './logger.js';

dotenv.config();

// Pool base (auth, sesiones, crons) — Neon requiere SSL
export const pool = new Pool({
  host:     process.env.DB_HOST,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port:     parseInt(process.env.DB_PORT, 10) || 5432,
  max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000,
  ssl: { rejectUnauthorized: false },
  application_name: 'nuub_studio_backend',
});

// Pools por rol — todos usan DB_HOST (pooler) para compatibilidad con Render/Vercel
export const pools = {
  admin: new Pool({
    host:     process.env.DB_HOST,
    database: process.env.DB_NAME,
    port:     parseInt(process.env.DB_PORT, 10) || 5432,
    user:     'usr_admin',
    password: process.env.DB_PASS_ADMIN,
    max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000,
    ssl: { rejectUnauthorized: false },
    application_name: 'nuub_studio_admin',
  }),
  artista: new Pool({
    host:     process.env.DB_HOST,
    database: process.env.DB_NAME,
    port:     parseInt(process.env.DB_PORT, 10) || 5432,
    user:     'usr_artista',
    password: process.env.DB_PASS_ARTISTA,
    max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000,
    ssl: { rejectUnauthorized: false },
    application_name: 'nuub_studio_artista',
  }),
  cliente: new Pool({
    host:     process.env.DB_HOST,
    database: process.env.DB_NAME,
    port:     parseInt(process.env.DB_PORT, 10) || 5432,
    user:     'usr_cliente',
    password: process.env.DB_PASS_CLIENTE,
    max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000,
    ssl: { rejectUnauthorized: false },
    application_name: 'nuub_studio_cliente',
  }),
  visitante: new Pool({
    host:     process.env.DB_HOST,
    database: process.env.DB_NAME,
    port:     parseInt(process.env.DB_PORT, 10) || 5432,
    user:     'usr_visitante',
    password: process.env.DB_PASS_VISITANTE,
    max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000,
    ssl: { rejectUnauthorized: false },
    application_name: 'nuub_studio_visitante',
  }),
};

// Errores de pools por rol
Object.entries(pools).forEach(([rol, p]) => {
  p.on('error', (err) => logger.error(`Error pool ${rol}: ${err.message}`));
});

export const testConnection = async () => {
  let client;
  try {
    client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    logger.info(`Conectado a PostgreSQL (${process.env.DB_NAME})`);
    logger.info(`Host: ${process.env.DB_HOST}:${process.env.DB_PORT}`);
    logger.info(`Server time: ${result.rows[0].now}`);
    return true;
  } catch (error) {
    logger.error(`Error de conexion a PostgreSQL: ${error.message}`);
    return false;
  } finally {
    if (client) client.release();
  }
};

pool.on('connect', () => logger.info('Nueva conexion PostgreSQL establecida'));
pool.on('error',   (err) => logger.error(`Error en el pool de PostgreSQL: ${err.message}`));
pool.on('remove',  () => logger.info('Conexion PostgreSQL removida del pool'));

export const queryWithRetry = async (sql, params, maxRetries = 3) => {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try { return await pool.query(sql, params); }
    catch (error) {
      lastError = error;
      logger.error(`Intento ${i + 1}/${maxRetries} fallo: ${error.message}`);
      if (i < maxRetries - 1)
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
    }
  }
  throw lastError;
};

pool.execute = pool.query;