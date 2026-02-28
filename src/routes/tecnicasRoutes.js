// src/routes/tecnicasRoutes.js
import { Router } from "express";
import { listarTecnicas, obtenerTecnicaPorId } from "../controllers/tecnicasController.js";

const router = Router();

// GET /api/tecnicas          → todas las técnicas
// GET /api/tecnicas?categoria=2 → filtradas por categoría
router.get("/", listarTecnicas);

// GET /api/tecnicas/:id
router.get("/:id", obtenerTecnicaPorId);

export default router;