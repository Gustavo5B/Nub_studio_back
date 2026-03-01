import pkg from 'pg';
const { Pool } = pkg;
import dotenv from "dotenv";
import logger from './logger.js';

dotenv.config();

export const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  ssl: false,
  application_name: 'nuub_studio_backend'
});

export const poolPromise = pool;

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
    logger.error('Verifica que PostgreSQL este corriendo, las credenciales en .env sean correctas y que la base de datos nuub_studio exista');
    return false;
  } finally {
    if (client) client.release();
  }
};

pool.on('connect', () => {
  logger.info('Nueva conexion PostgreSQL establecida');
});

pool.on('error', (err) => {
  logger.error(`Error inesperado en el pool de PostgreSQL: ${err.message}`);
  process.exit(-1);
});

pool.on('remove', () => {
  logger.info('Conexion PostgreSQL removida del pool');
});

export const queryWithRetry = async (sql, params, maxRetries = 3) => {
  let lastError;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await pool.query(sql, params);
      return result;
    } catch (error) {
      lastError = error;
      logger.error(`Intento ${i + 1}/${maxRetries} fallo: ${error.message}`);

      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
      }
    }
  }

  throw lastError;
};

pool.execute = pool.query;