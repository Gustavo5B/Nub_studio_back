// =========================================================
// MIDDLEWARE DE SANITIZACION CONTRA XSS
// =========================================================
import logger from '../config/logger.js';

const detectXSS = (value) => {
  if (typeof value !== 'string') return false;

  const xssPatterns = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /<iframe/gi,
    /<object/gi,
    /<embed/gi,
    /javascript:/gi,
    /on\w+\s*=/gi,
    /<img[^>]+src[\s]*=[\s]*[\"\'][\s]*javascript:/gi,
    /eval\(/gi,
    /expression\(/gi,
    /<svg[\s\S]*?on\w+/gi,
    /vbscript:/gi,
    /data:text\/html/gi
  ];

  return xssPatterns.some(pattern => pattern.test(value));
};

const sanitizeString = (str) => {
  if (typeof str !== 'string') return str;
  return str
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;')
    .trim();
};

const sanitizeObject = (obj) => {
  if (typeof obj !== 'object' || obj === null) {
    return typeof obj === 'string' ? sanitizeString(obj) : obj;
  }

  const sanitized = Array.isArray(obj) ? [] : {};

  for (const key in obj) {
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      sanitized[key] = sanitizeObject(obj[key]);
    } else if (typeof obj[key] === 'string') {
      sanitized[key] = sanitizeString(obj[key]);
    } else {
      sanitized[key] = obj[key];
    }
  }

  return sanitized;
};

export const sanitizeInput = (req, res, next) => {
  try {
    if (req.body) {
      for (const key in req.body) {
        if (detectXSS(req.body[key])) {
          logger.warn(`XSS detectado en body.${key}: ${req.body[key].substring(0, 100)}`);
          return res.status(400).json({
            error: 'Solicitud rechazada',
            message: 'Se detecto contenido potencialmente malicioso en la solicitud',
            code: 'XSS_DETECTED',
            field: key
          });
        }
      }
    }

    if (req.query) {
      for (const key in req.query) {
        if (detectXSS(req.query[key])) {
          logger.warn(`XSS detectado en query.${key}`);
          return res.status(400).json({
            error: 'Solicitud rechazada',
            message: 'Se detecto contenido potencialmente malicioso en los parametros',
            code: 'XSS_DETECTED',
            field: key
          });
        }
      }
    }

    if (req.params) {
      for (const key in req.params) {
        if (detectXSS(req.params[key])) {
          logger.warn(`XSS detectado en params.${key}`);
          return res.status(400).json({
            error: 'Solicitud rechazada',
            message: 'Se detecto contenido potencialmente malicioso en la ruta',
            code: 'XSS_DETECTED',
            field: key
          });
        }
      }
    }

    next();
  } catch (error) {
    logger.error(`Error en sanitizacion: ${error.message}`);
    return res.status(500).json({
      error: 'Error interno',
      message: 'Error al procesar la solicitud'
    });
  }
};

export { detectXSS, sanitizeString, sanitizeObject };