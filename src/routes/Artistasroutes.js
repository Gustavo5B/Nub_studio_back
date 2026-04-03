import { Router } from "express";
import { 
  listarArtistas, obtenerArtistaPorId,
  crearArtista, actualizarArtista, eliminarArtista, cambiarEstadoArtista
} from "../controllers/artistasController.js";
import { authenticateToken, requireRole, optionalAuth } from '../middlewares/authMiddleware.js';
import { upload } from '../config/cloudinaryConfig.js';

const router = Router();

// ── PÚBLICAS ──────────────────────────────────────────────
router.get('/',    optionalAuth, listarArtistas);
router.get('/:id', optionalAuth, obtenerArtistaPorId);

// ── PROTEGIDAS (solo admin) ───────────────────────────────
router.post('/',           authenticateToken, requireRole('admin'), upload.single('foto'), crearArtista);
router.put('/:id',         authenticateToken, requireRole('admin'), upload.single('foto'), actualizarArtista);
router.delete('/:id',      authenticateToken, requireRole('admin'), eliminarArtista);
router.patch('/:id/estado', authenticateToken, requireRole('admin'), cambiarEstadoArtista);

export default router;