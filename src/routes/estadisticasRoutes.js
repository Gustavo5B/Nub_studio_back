// src/routes/estadisticasRoutes.js
import { Router } from "express";
import { authenticateToken, requireRole } from "../middlewares/authMiddleware.js";
import {
  getResumen,
  getPorHora,
  getPorDiaSemana,
  getPorSemana,
  getPorDia,
  getDistribucion,
  getMapaCalor,
  getHistorial,
} from "../controllers/estadisticasController.js";

const router = Router();

router.use(authenticateToken, requireRole("admin"));

router.get("/resumen",         getResumen);
router.get("/por-hora",        getPorHora);
router.get("/por-dia-semana",  getPorDiaSemana);
router.get("/por-semana",      getPorSemana);
router.get("/por-dia",         getPorDia);
router.get("/distribucion",    getDistribucion);
router.get("/mapa-calor",      getMapaCalor);
router.get("/historial",       getHistorial);

export default router;