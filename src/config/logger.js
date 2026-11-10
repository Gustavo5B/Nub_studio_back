import { createLogger, format, transports } from 'winston';
const { combine, timestamp, printf, colorize } = format;

const logFormat = printf(({ level, message, timestamp }) => {
  return `${timestamp} [${level}]: ${message}`;
});

const base = createLogger({
  level: 'debug',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat
  ),
  transports: [
    new transports.Console({
      format: combine(colorize({ all: true }), timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), logFormat)
    }),
    new transports.File({
      filename: 'logs/errors.log',
      level: 'warn'  // guarda warn y error (tus detecciones de ataques)
    }),
    new transports.File({
      filename: 'logs/combined.log' // guarda todo
    }),
  ],
});

// =========================================================
// PROTECCIÓN CONTRA INYECCIÓN EN LOGS (CWE-117, regla S5145 de SonarCloud)
// Muchos mensajes incluyen datos que manda el usuario (correo, título, id...). Si uno
// trae saltos de línea, podría "falsificar" líneas nuevas en el log. Todo lo que se
// escribe pasa por aquí: los saltos de línea se cambian por un espacio y se quitan los
// demás caracteres de control. Así queda protegido cualquier log, también los futuros.
// =========================================================
const CARACTERES_DE_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export const limpiarParaLog = (valor) =>
  String(valor)
    .replace(/\n|\r/g, ' ')
    .replace(CARACTERES_DE_CONTROL, '');

// Algunas llamadas pasan más de un valor, por ejemplo logger.error('Fallo:', err.message).
// Antes winston descartaba esos valores extra; ahora se agregan al mensaje.
const comoTexto = (valor) => {
  if (valor instanceof Error) return valor.message;
  if (valor !== null && typeof valor === 'object') {
    try {
      return JSON.stringify(valor);
    } catch {
      return '[objeto]';
    }
  }
  return String(valor);
};

const escribir = (nivel) => (mensaje, ...extra) =>
  base[nivel](limpiarParaLog([mensaje, ...extra].map(comoTexto).join(' ')));

const logger = {
  error: escribir('error'),
  warn: escribir('warn'),
  info: escribir('info'),
  debug: escribir('debug'),
};

export default logger;
