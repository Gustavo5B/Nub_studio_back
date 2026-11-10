import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { pool } from '../config/db.js';
import logger from '../config/logger.js';

// =========================================================
// GENERAR HASH DEL TOKEN
// =========================================================
export const hashToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

// =========================================================
// GUARDAR SESION ACTIVA
// =========================================================
export const saveActiveSession = async (userId, token, req) => {
  try {
    const tokenHash = hashToken(token);
    const ip = req.headers['x-forwarded-for']?.split(',')[0] ||
               req.socket.remoteAddress ||
               req.connection.remoteAddress ||
               'unknown';
    const userAgent = req.headers['user-agent'] || 'Desconocido';
    // La sesión vence junto con el token (7 días el cliente, 24 h los demás roles)
    const { exp } = jwt.decode(token) ?? {};
    const expiraEn = exp ?? Math.floor(Date.now() / 1000) + 24 * 60 * 60;

    await pool.query(
      `INSERT INTO sesiones_activas 
       (id_usuario, token, token_hash, fecha_expiracion, ip_address, user_agent, activa) 
       VALUES ($1, $2, $3, to_timestamp($6), $4, $5, TRUE)`,
      [userId, token, tokenHash, ip, userAgent, expiraEn]
    );

    logger.info(`Sesion guardada: usuario ${userId}`);
    return true;
  } catch (error) {
    logger.error(`Error al guardar sesion: ${error.message}`);
    return false;
  }
};

// =========================================================
// VERIFICAR SI SESION ES VALIDA
// =========================================================
export const isSessionValid = async (token) => {
  try {
    const tokenHash = hashToken(token);

    const result = await pool.query(
      `SELECT id_sesion FROM sesiones_activas 
       WHERE token_hash = $1 AND activa = TRUE AND fecha_expiracion > NOW()`,
      [tokenHash]
    );

    const isValid = result.rows.length > 0;
    logger.info(`Sesion valida: ${isValid ? 'SI' : 'NO'}`);
    return isValid;
  } catch (error) {
    // No es lo mismo "la sesión no existe" que "no se pudo revisar" (por ejemplo, mientras
    // Neon despierta). Se lanza el error para que el middleware responda 503 y la app no
    // cierre una sesión que sigue siendo válida.
    logger.error(`Error al verificar sesion: ${error.message}`);
    throw error;
  }
};

// =========================================================
// ELIMINAR SESION ESPECIFICA (logout)
// =========================================================
export const removeSession = async (token) => {
  try {
    const tokenHash = hashToken(token);

    await pool.query(
      'DELETE FROM sesiones_activas WHERE token_hash = $1',
      [tokenHash]
    );

    logger.info('Sesion eliminada correctamente');
    return true;
  } catch (error) {
    logger.error(`Error al eliminar sesion: ${error.message}`);
    return false;
  }
};

// =========================================================
// REVOCAR OTRAS SESIONES (excepto la actual)
// =========================================================
export const revokeOtherSessions = async (userId, currentToken) => {
  try {
    const currentTokenHash = hashToken(currentToken);

    const result = await pool.query(
      `DELETE FROM sesiones_activas WHERE id_usuario = $1 AND token_hash != $2`,
      [userId, currentTokenHash]
    );

    logger.info(`${result.rowCount} sesiones revocadas: usuario ${userId}`);
    return result.rowCount;
  } catch (error) {
    logger.error(`Error al revocar sesiones: ${error.message}`);
    throw error;
  }
};

// =========================================================
// LIMPIAR SESIONES EXPIRADAS (cron job)
// =========================================================
export const cleanupExpiredSessions = async () => {
  try {
    const result = await pool.query(
      `DELETE FROM sesiones_activas 
       WHERE fecha_expiracion < NOW() 
       OR ultima_actividad < NOW() - INTERVAL '30 days'`
    );

    logger.info(`${result.rowCount} sesiones antiguas eliminadas`);
    return result.rowCount;
  } catch (error) {
    logger.error(`Error al limpiar sesiones: ${error.message}`);
    return 0;
  }
};