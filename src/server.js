// =========================================================
// 📦 IMPORTACIONES
// =========================================================
import tecnicasRoutes from "./routes/tecnicasRoutes.js";
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import dotenv from 'dotenv';
import helmet from 'helmet';
import authRoutes from './routes/authRoutes.js';
import recoveryRoutes from './routes/recoveryRoutes.js';
import twoFactorRoutes from './routes/twoFactorRoutes.js';
import gmail2faRoutes from "./routes/gmail2faRoutes.js";
import obrasRoutes from './routes/obrasRoutes.js';
import categoriasRoutes from './routes/categoriasRoutes.js';
import artistasRoutes from './routes/Artistasroutes.js';
import etiquetasRoutes from './routes/etiquetasRoutes.js';
import imagenesRoutes from './routes/imagenesRoutes.js';
import { testConnection } from './config/db.js';
import { cleanupExpiredCodes, sendRecoveryCode, generateCode } from './services/emailService.js';
import { cleanupExpiredSessions } from './services/sessionService.js';
import { sanitizeInput } from './middlewares/sanitize.middleware.js';
import { preventSQLInjection } from './middlewares/sql-injection.middleware.js';
import statsRoutes from "./routes/statsRoutes.js";
import artistaPortalRoutes from './routes/artistaPortalRoutes.js';
import logger from './config/logger.js';

// =========================================================
// CONFIGURACION INICIAL
// =========================================================
dotenv.config();
const app = express();

// =========================================================
// HELMET - HEADERS DE SEGURIDAD
// =========================================================
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// =========================================================
// CONFIGURACION DE CORS
// =========================================================
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:4200',
  'http://localhost:5173',
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      logger.warn(`Bloqueado por CORS: ${origin}`);
      return callback(new Error('Origen no permitido por CORS'), false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// =========================================================
// MIDDLEWARES
// =========================================================
app.use(express.json({ limit: '10mb' }));
app.use(sanitizeInput);
app.use(preventSQLInjection);

// =========================================================
// RUTAS PRINCIPALES
// =========================================================
app.use('/api/auth', authRoutes);
app.use('/api/recovery', recoveryRoutes);
app.use('/api/2fa', twoFactorRoutes);
app.use("/api/gmail-2fa", gmail2faRoutes);
app.use('/api/gmail2fa', gmail2faRoutes);
app.use('/api/imagenes', imagenesRoutes);
app.use('/api/obras', obrasRoutes);
app.use('/api/categorias', categoriasRoutes);
app.use('/api/artistas', artistasRoutes);
app.use('/api/etiquetas', etiquetasRoutes);
app.use('/api/artista-portal', artistaPortalRoutes);
app.use("/api/tecnicas", tecnicasRoutes);
app.use("/api/stats", statsRoutes);

// =========================================================
// RUTA DE PRUEBA DEL SERVIDOR
// =========================================================
app.get('/', (req, res) => {
  res.json({
    message: 'Backend AUTH activo y corriendo correctamente.',
    database: 'PostgreSQL',
    cors: allowedOrigins,
    security: {
      xss: 'enabled',
      sqlInjection: 'enabled',
      csrf: 'not-needed (JWT-based)',
      helmet: 'enabled',
      https: 'enforced'
    },
    timestamp: new Date().toISOString(),
  });
});

// =========================================================
// RUTA DE PRUEBA DE EMAIL (BREVO)
// =========================================================
app.get('/api/test-email', async (req, res) => {
  try {
    const testEmail = 'tucorreo@gmail.com';
    const code = generateCode();

    logger.info(`Probando envio de correo a ${testEmail}...`);
    await sendRecoveryCode(testEmail, code);

    res.json({
      message: `Correo de prueba enviado correctamente a ${testEmail}`,
      code,
    });
  } catch (error) {
    logger.error(`Error al enviar el correo de prueba: ${error.message}`);
    res.status(500).json({
      message: 'Error al enviar correo de prueba',
      error: error.message,
    });
  }
});

// =========================================================
// CRON JOB: Limpieza automatica cada hora
// =========================================================
cron.schedule('0 * * * *', async () => {
  logger.info('Ejecutando limpieza de codigos expirados...');
  try {
    await cleanupExpiredCodes();
    logger.info('Limpieza completada.');
  } catch (err) {
    logger.error(`Error en limpieza automatica: ${err.message}`);
  }
});

// =========================================================
// CRON JOB: Limpieza de sesiones antiguas cada dia
// =========================================================
cron.schedule('0 0 * * *', async () => {
  logger.info('Ejecutando limpieza de sesiones antiguas...');
  try {
    await cleanupExpiredSessions();
    logger.info('Limpieza de sesiones completada.');
  } catch (err) {
    logger.error(`Error en limpieza de sesiones: ${err.message}`);
  }
});

// =========================================================
// INICIO DEL SERVIDOR
// =========================================================
const PORT = process.env.PORT || 4000;

app.listen(PORT, async () => {
  logger.info(`Servidor corriendo en el puerto ${PORT}`);
  logger.info(`CORS habilitado para: ${allowedOrigins.join(', ')}`);
  logger.info('Protecciones activas: XSS, SQL Injection, JWT-Auth, Helmet');

  try {
    await testConnection();
    logger.info('Conexion PostgreSQL verificada correctamente.');
  } catch (error) {
    logger.error(`Error en la conexion PostgreSQL: ${error.message}`);
  }
});
