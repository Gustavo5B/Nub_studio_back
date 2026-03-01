import { Router } from "express";
import { 
  listarArtistas, obtenerArtistaPorId,
  crearArtista, actualizarArtista, eliminarArtista
} from "../controllers/artistasController.js";
import { authenticateToken, requireRole } from '../middlewares/authMiddleware.js';
import { upload } from '../config/cloudinaryConfig.js'; // ← NUEVO

const router = Router();

// ── PÚBLICAS ──────────────────────────────────────────────
router.get('/',    listarArtistas);
router.get('/:id', obtenerArtistaPorId);

// ── PROTEGIDAS (solo admin) ───────────────────────────────
router.post('/',      authenticateToken, requireRole('admin'), upload.single('foto'), crearArtista);
router.put('/:id',    authenticateToken, requireRole('admin'), upload.single('foto'), actualizarArtista);
router.delete('/:id', authenticateToken, requireRole('admin'), eliminarArtista);

export default router;