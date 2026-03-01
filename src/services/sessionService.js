import crypto from 'crypto';
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

    await pool.query(
      `INSERT INTO sesiones_activas 
       (id_usuario, token, token_hash, fecha_expiracion, ip_address, user_agent, activa) 
       VALUES ($1, $2, $3, NOW() + INTERVAL '24 hours', $4, $5, TRUE)`,
      [userId, token, tokenHash, ip, userAgent]
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
    logger.error(`Error al verificar sesion: ${error.message}`);
    return false;
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