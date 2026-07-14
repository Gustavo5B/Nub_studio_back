import { Router } from "express";
import { authenticateToken, requireRole } from "../middlewares/authMiddleware.js";
import {
  listarCupones,
  crearCupon,
  actualizarCupon,
  eliminarCupon,
  validarCupon,
  listarCuponesPublicos,
} from "../controllers/cuponesController.js";

const router = Router();

// Público — cupones activos para mostrar al cliente logueado
router.get("/publicos", authenticateToken, listarCuponesPublicos);

// Cliente — validar código en checkout
router.post("/validar", authenticateToken, requireRole("cliente"), validarCupon);

// Admin — CRUD completo
router.get(   "/",    authenticateToken, requireRole("admin"), listarCupones);
router.post(  "/",    authenticateToken, requireRole("admin"), crearCupon);
router.put(   "/:id", authenticateToken, requireRole("admin"), actualizarCupon);
router.delete("/:id", authenticateToken, requireRole("admin"), eliminarCupon);

export default router;
