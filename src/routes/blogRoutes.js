import express from 'express';
import { upload } from '../config/cloudinaryConfig.js';
import { authenticateToken, requireRole, optionalAuth } from '../middlewares/authMiddleware.js';
import {
  listarTodosPostsAdmin,
  cambiarEstadoPost,
  eliminarComentarioAdmin,
  listarComentariosPendientes,
  moderarComentario,
  listarPalabras,
  agregarPalabra,
  eliminarPalabra,
  togglePalabra,
} from '../controllers/blogController.js';

const router = express.Router();

// ── ADMIN — GESTIÓN DE POSTS ──────────────────────────────
router.get(
  '/admin/posts',
  authenticateToken, requireRole('admin'),
  listarTodosPostsAdmin
);
router.patch(
  '/admin/posts/:id/estado',
  authenticateToken, requireRole('admin'),
  cambiarEstadoPost
);

// ── ADMIN — MODERACIÓN DE COMENTARIOS ────────────────────
router.get(
  '/admin/comentarios/pendientes',
  authenticateToken, requireRole('admin'),
  listarComentariosPendientes
);
router.patch(
  '/admin/comentarios/:id/moderar',
  authenticateToken, requireRole('admin'),
  moderarComentario
);
router.delete(
  '/admin/comentarios/:id',
  authenticateToken, requireRole('admin'),
  eliminarComentarioAdmin
);

// ── ADMIN — PALABRAS PROHIBIDAS ───────────────────────────
router.get(
  '/admin/palabras-prohibidas',
  authenticateToken, requireRole('admin'),
  listarPalabras
);
router.post(
  '/admin/palabras-prohibidas',
  authenticateToken, requireRole('admin'),
  agregarPalabra
);
router.delete(
  '/admin/palabras-prohibidas/:id',
  authenticateToken, requireRole('admin'),
  eliminarPalabra
);
router.patch(
  '/admin/palabras-prohibidas/:id',
  authenticateToken, requireRole('admin'),
  togglePalabra
);

export default router;
