// =========================================================
// MIDDLEWARE DE PROTECCION CONTRA SQL INJECTION
// =========================================================
import logger from '../config/logger.js';

const detectSQLInjection = (value) => {
  if (typeof value !== 'string') return false;

  const sqlPatterns = [
    /(\b(SELECT|UNION|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE)\b)/gi,
    /'(\s)*(OR|AND)(\s)*'?\d/gi,
    /'(\s)*(OR|AND)(\s)*'?'(\s)*=/gi,
    /'(\s)*OR(\s)*'1'(\s)*=(\s)*'1/gi,
    /'(\s)*OR(\s)*1(\s)*=(\s)*1/gi,
    /--/g,
    /\/\*/g,
    /\*\//g,
    /#/g,
    /;(\s)*(DROP|DELETE|INSERT|UPDATE)/gi,
    /xp_/gi,
    /sp_/gi,
    /WAITFOR(\s)+DELAY/gi,
    /BENCHMARK/gi,
    /SLEEP\(/gi,
    /pg_sleep/gi,
    /INFORMATION_SCHEMA/gi,
    /LOAD_FILE/gi,
    /INTO(\s)+OUTFILE/gi,
    /INTO(\s)+DUMPFILE/gi
  ];

  return sqlPatterns.some(pattern => pattern.test(value));
};

export const preventSQLInjection = (req, res, next) => {
  try {
    if (req.body) {
      for (const key in req.body) {
        if (detectSQLInjection(req.body[key])) {
          logger.warn(`SQL Injection detectado en body.${key}: ${req.body[key]}`);
          return res.status(400).json({
            error: 'Solicitud rechazada',
            message: 'Se detectaron patrones sospechosos en la solicitud',
            code: 'SQL_INJECTION_DETECTED',
            field: key
          });
        }
      }
    }

    if (req.query) {
      for (const key in req.query) {
        if (detectSQLInjection(req.query[key])) {
          logger.warn(`SQL Injection detectado en query.${key}`);
          return res.status(400).json({
            error: 'Solicitud rechazada',
            message: 'Se detectaron patrones sospechosos en los parametros',
            code: 'SQL_INJECTION_DETECTED',
            field: key
          });
        }
      }
    }

    if (req.params) {
      for (const key in req.params) {
        if (detectSQLInjection(req.params[key])) {
          logger.warn(`SQL Injection detectado en params.${key}`);
          return res.status(400).json({
            error: 'Solicitud rechazada',
            message: 'Se detectaron patrones sospechosos en la ruta',
            code: 'SQL_INJECTION_DETECTED',
            field: key
          });
        }
      }
    }

    next();
  } catch (error) {
    logger.error(`Error en validacion SQL: ${error.message}`);
    return res.status(500).json({
      error: 'Error interno',
      message: 'Error al procesar la solicitud'
    });
  }
};

export { detectSQLInjection };