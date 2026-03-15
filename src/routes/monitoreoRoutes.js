// src/routes/monitoreoRoutes.js
import { Router } from "express";
import { authenticateToken, requireRole } from "../middlewares/authMiddleware.js";
import {
  getResumen, getTablas, getQueriesLentas, getIndices, getConexiones,
  getAlertas, getBloqueos, getConfiguracion, getHerramientas, getHistorial,
  vacuumTabla, vacuumAll, reindexTabla, killPid, eliminarIndice,
} from "../controllers/monitoreoController.js";

const router = Router();

// Todas las rutas requieren token + rol admin
router.use(authenticateToken, requireRole("admin"));

// ── Consultas ─────────────────────────────────────────────
router.get("/resumen",        getResumen);
router.get("/tablas",         getTablas);
router.get("/queries-lentas", getQueriesLentas);
router.get("/indices",        getIndices);
router.get("/conexiones",     getConexiones);
router.get("/alertas",        getAlertas);
router.get("/bloqueos",       getBloqueos);
router.get("/configuracion",  getConfiguracion);
router.get("/herramientas",   getHerramientas);
router.get("/historial",      getHistorial);

// ── Mantenimiento ─────────────────────────────────────────
router.post("/vacuum/:tabla",  vacuumTabla);
router.post("/vacuum-all",     vacuumAll);
router.post("/reindex/:tabla", reindexTabla);

// ── Acciones activas ──────────────────────────────────────
router.post("/kill-pid/:pid",       killPid);
router.delete("/indice/:nombre",    eliminarIndice);

export default router;