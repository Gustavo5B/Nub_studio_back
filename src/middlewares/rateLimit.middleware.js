// =========================================================
// RATE LIMIT EN MEMORIA (sin dependencias externas)
// Ventana fija por usuario autenticado (o IP si no hay sesión).
// Suficiente para una sola instancia de Node; si algún día se
// despliega en cluster habría que moverlo a Redis/Postgres.
// =========================================================
import logger from '../config/logger.js';

const buckets = new Map();

// Limpieza periódica para que el Map no crezca sin límite
const CLEANUP_INTERVAL = 10 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) {
    if (now - b.start > b.windowMs * 2) buckets.delete(key);
  }
}, CLEANUP_INTERVAL).unref();

/**
 * Crea un middleware de rate limit.
 * Debe registrarse DESPUÉS de authenticateToken para poder
 * limitar por id de usuario en vez de por IP.
 *
 * @param {object} opts
 * @param {number} opts.windowMs  Ventana en ms (default 60s)
 * @param {number} opts.max       Máximo de peticiones por ventana
 * @param {string} opts.mensaje   Mensaje devuelto con el 429
 * @param {string} opts.nombre    Etiqueta para logs y clave del bucket
 */
export const rateLimit = ({ windowMs = 60_000, max = 10, mensaje, nombre = 'rl' }) => {
  return (req, res, next) => {
    const quien = req.user?.id_usuario ? `u:${req.user.id_usuario}` : `ip:${req.ip}`;
    const key = `${nombre}:${quien}`;
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || now - bucket.start >= windowMs) {
      bucket = { start: now, count: 0, windowMs };
      buckets.set(key, bucket);
    }
    bucket.count++;

    if (bucket.count > max) {
      if (bucket.count === max + 1)
        logger.warn(`Rate limit '${nombre}' excedido por ${quien}`);
      return res.status(429).json({
        success: false,
        message: mensaje || 'Demasiadas solicitudes, intenta de nuevo en un momento.',
      });
    }
    next();
  };
};
