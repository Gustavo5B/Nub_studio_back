import { createLogger, format, transports } from 'winston';
const { combine, timestamp, printf, colorize } = format;

const logFormat = printf(({ level, message, timestamp }) => {
  return `${timestamp} [${level}]: ${message}`;
});

const logger = createLogger({
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

export default logger;