import { Router } from "express";
import { listarMateriales } from "../controllers/materialesController.js";

const router = Router();

// GET /api/materiales
router.get("/", listarMateriales);

export default router;
