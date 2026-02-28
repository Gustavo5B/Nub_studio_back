import { Router } from "express";
import { 
  listarArtistas, obtenerArtistaPorId,
  crearArtista, actualizarArtista, eliminarArtista
} from "../controllers/artistasController.js";
import { authenticateToken, requireRole } from '../middlewares/authMiddleware.js';  // ← NUEVO

const router = Router();

// ── PÚBLICAS ──────────────────────────────────────────────
router.get('/',    listarArtistas);
router.get('/:id', obtenerArtistaPorId);

// ── PROTEGIDAS (solo admin) ───────────────────────────────
router.post('/',     authenticateToken, requireRole('admin'), crearArtista);
router.put('/:id',   authenticateToken, requireRole('admin'), actualizarArtista);
router.delete('/:id',authenticateToken, requireRole('admin'), eliminarArtista);

export default router;