// =========================================================
// 📦 IMPORTACIONES
// =========================================================
import express from "express";
import cors from "cors";
import cron from "node-cron";
import dotenv from "dotenv";
import helmet from "helmet";
import authRoutes from "./routes/authRoutes.js";
import recoveryRoutes from "./routes/recoveryRoutes.js";
import twoFactorRoutes from "./routes/twoFactorRoutes.js";
import gmail2faRoutes from "./routes/gmail2faRoutes.js";
import obrasRoutes from "./routes/obrasRoutes.js";
import categoriasRoutes from "./routes/categoriasRoutes.js";
import artistasRoutes from "./routes/Artistasroutes.js";
import etiquetasRoutes from "./routes/etiquetasRoutes.js";
import imagenesRoutes from "./routes/imagenesRoutes.js";
import statsRoutes from "./routes/statsRoutes.js";
import artistaPortalRoutes from "./routes/artistaPortalRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import reportesRoutes from "./routes/reportesRoutes.js";
import estadosRoutes from "./routes/estadosRoutes.js";
import tecnicasRoutes from "./routes/tecnicasRoutes.js";
import monitoreoRoutes from "./routes/monitoreoRoutes.js";
import estadisticasRoutes from "./routes/estadisticasRoutes.js";
import sobreNosotrosRoutes from "./routes/sobreNosotrosRoutes.js";
import municipiosRoutes from "./routes/municipiosRoutes.js";

import { testConnection } from "./config/db.js";
import {
  cleanupExpiredCodes,
  sendRecoveryCode,
  generateCode,
} from "./services/emailService.js";
import { cleanupExpiredSessions } from "./services/sessionService.js";
import { sanitizeInput } from "./middlewares/sanitize.middleware.js";
import { preventSQLInjection } from "./middlewares/sql-injection.middleware.js";
import logger from "./config/logger.js";
import { iniciarCron } from "./controllers/backupController.js";

// =========================================================
// MANEJO DE ERRORES NO CAPTURADOS
// =========================================================
process.on("uncaughtException", (err) => {
  logger.error(`uncaughtException: ${err.message}`);
});
process.on("unhandledRejection", (reason) => {
  logger.error(`unhandledRejection: ${reason}`);
});

// =========================================================
// CONFIGURACION INICIAL
// =========================================================
dotenv.config();
const app = express();
const isProd = process.env.NODE_ENV === "production";

// =========================================================
// FIX ZAP #1 — HELMET COMPLETO
// Corrige: CSP no configurada, Anti-Clickjacking, HSTS, X-Content-Type
// =========================================================
app.set("trust proxy", false);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https://res.cloudinary.com"],
        connectSrc: ["'self'"],
        fontSrc: [
          "'self'",
          "https://fonts.googleapis.com",
          "https://fonts.gstatic.com",
        ],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    strictTransportSecurity: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    hidePoweredBy: true,
    crossOriginEmbedderPolicy: false,
    noSniff: true,
    frameguard: { action: "deny" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  }),
);

// =========================================================
// FIX ZAP #2 — OCULTAR VERSION DEL SERVIDOR
// =========================================================
app.disable("x-powered-by");

// =========================================================
// CORS
// =========================================================
const allowedOrigins = [
  process.env.FRONTEND_URL,
  "http://localhost:4200",
  "http://localhost:5173",
].filter(Boolean);

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      logger.warn(`Bloqueado por CORS: ${origin}`);
      return callback(new Error("Origen no autorizado por CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: [
      "Content-Disposition",
      "X-Backup-Rows",
      "X-Backup-Tables",
      "X-Backup-Duration",
      "X-Backup-Checksum",
      "X-Backup-Url",
    ],
  }),
);

app.use((err, req, res, next) => {
  if (err.message === "Origen no autorizado por CORS") {
    return res.status(403).json({
      error: "Acceso denegado",
      message: "Origen no autorizado por política CORS",
      origin: req.headers.origin || "desconocido",
    });
  }
  next(err);
});

// =========================================================
// MIDDLEWARES GLOBALES
// =========================================================
app.use(express.json({ limit: "10mb" }));
app.use(sanitizeInput);
app.use(preventSQLInjection);

// =========================================================
// FIX ZAP #3 — CABECERAS DE CACHE
// Corrige: Reexaminar las Directivas de Control de Caché
// =========================================================
app.use((req, res, next) => {
  if (req.path.startsWith("/api/auth") || req.path.startsWith("/api/admin")) {
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, private",
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
  next();
});

// =========================================================
// RUTAS
// =========================================================
app.use("/api/auth", authRoutes);
app.use("/api/recovery", recoveryRoutes);
app.use("/api/2fa", twoFactorRoutes);
app.use("/api/gmail-2fa", gmail2faRoutes);
app.use("/api/imagenes", imagenesRoutes);
app.use("/api/obras", obrasRoutes);
app.use("/api/categorias", categoriasRoutes);
app.use("/api/artistas", artistasRoutes);
app.use("/api/etiquetas", etiquetasRoutes);
app.use("/api/artista-portal", artistaPortalRoutes);
app.use("/api/tecnicas", tecnicasRoutes);
app.use("/api/stats", statsRoutes);
app.use("/api/admin/monitoreo", monitoreoRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/reportes", reportesRoutes);
app.use("/api/estados", estadosRoutes);
app.use("/api/estadisticas", estadisticasRoutes);
app.use("/api/sobre-nosotros", sobreNosotrosRoutes);
app.use("/api/municipios", municipiosRoutes);

// =========================================================
// RUTA DE PRUEBA
// FIX ZAP #4 — No exponer info interna en produccion
// =========================================================
app.get("/", (req, res) => {
  res.json({
    message: "Backend activo y corriendo correctamente.",
    ...(isProd
      ? {}
      : {
          database: "PostgreSQL",
          cors: allowedOrigins,
          security: {
            xss: "enabled",
            sqlInjection: "enabled",
            csrf: "not-needed (JWT-based)",
            helmet: "enabled",
          },
        }),
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/test-email", async (req, res) => {
  if (isProd) return res.status(404).json({ message: "Not found" });
  try {
    const testEmail = "tucorreo@gmail.com";
    const code = generateCode();
    logger.info(`Probando envio de correo a ${testEmail}...`);
    await sendRecoveryCode(testEmail, code);
    res.json({ message: `Correo de prueba enviado a ${testEmail}`, code });
  } catch (error) {
    logger.error(`Error al enviar el correo de prueba: ${error.message}`);
    res.status(500).json({ message: "Error al enviar correo de prueba" });
  }
});

// =========================================================
// FIX ZAP #5 — MANEJO GLOBAL DE ERRORES
// Corrige: Divulgacion de error de aplicacion
// =========================================================
app.use((err, req, res, next) => {
  logger.error(`Error no manejado: ${err.message}`);
  res.status(err.status || 500).json({
    error: "Error interno del servidor",
    ...(isProd ? {} : { detail: err.message }),
  });
});

// =========================================================
// CRONS DE SISTEMA
// =========================================================
cron.schedule("0 * * * *", async () => {
  logger.info("Limpieza de codigos expirados...");
  try {
    await cleanupExpiredCodes();
    logger.info("Limpieza completada.");
  } catch (err) {
    logger.error(`Error en limpieza: ${err.message}`);
  }
});

cron.schedule("0 0 * * *", async () => {
  logger.info("Limpieza de sesiones antiguas...");
  try {
    await cleanupExpiredSessions();
    logger.info("Sesiones limpiadas.");
  } catch (err) {
    logger.error(`Error limpieza sesiones: ${err.message}`);
  }
});

// =========================================================
// INICIO DEL SERVIDOR
// =========================================================
const PORT = process.env.PORT || 4000;

app.listen(PORT, async () => {
  logger.info(`Servidor corriendo en el puerto ${PORT}`);
  logger.info(`CORS habilitado para: ${allowedOrigins.join(", ")}`);
  logger.info(
    "Protecciones activas: XSS, SQL Injection, JWT-Auth, Helmet, CSP, HSTS",
  );

  try {
    await testConnection();
    logger.info("Conexion PostgreSQL verificada correctamente.");
  } catch (error) {
    logger.error(`Error en la conexion PostgreSQL: ${error.message}`);
  }

  try {
    await iniciarCron();
    logger.info("Cron de backups inicializado.");
  } catch (err) {
    logger.warn(`Cron de backups no pudo inicializarse: ${err.message}`);
  }
});
