import express from 'express';
import { upload } from '../config/cloudinaryConfig.js';
import { authenticateToken, requireRole, optionalAuth } from '../middlewares/authMiddleware.js';
import {
  // Admin
  listarTodosPostsAdmin,
  cambiarEstadoPost,
  eliminarComentarioAdmin,
  listarComentariosPendientes,
  moderarComentario,
  listarPalabras,
  agregarPalabra,
  eliminarPalabra,
  togglePalabra,
  // Artista / Admin
  crearPost,
  editarPost,
  eliminarPost,
  listarMisPosts,
  // Cliente / Artista
  crearComentario,
  eliminarComentario,
  // Público
  listarPosts,
  obtenerPostPorSlug,
  listarComentarios,
} from '../controllers/blogController.js';

const router = express.Router();

// ── PÚBLICO — POSTS ───────────────────────────────────────
router.get('/posts',       optionalAuth, listarPosts);
router.get('/posts/:slug', optionalAuth, obtenerPostPorSlug);

// ── PÚBLICO — COMENTARIOS ─────────────────────────────────
router.get('/posts/:id/comentarios', optionalAuth, listarComentarios);

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

// ── ARTISTA — MIS POSTS ───────────────────────────────────
router.get(
  '/mis-posts',
  authenticateToken, requireRole('artista'),
  listarMisPosts
);
router.post(
  '/posts',
  authenticateToken, requireRole('admin', 'artista'),
  upload.single('imagen'),
  crearPost
);
router.put(
  '/posts/:id',
  authenticateToken, requireRole('admin', 'artista'),
  upload.single('imagen'),
  editarPost
);
router.delete(
  '/posts/:id',
  authenticateToken, requireRole('admin', 'artista'),
  eliminarPost
);

// ── CLIENTE Y ARTISTA — COMENTARIOS ──────────────────────
router.post(
  '/posts/:id/comentarios',
  authenticateToken, requireRole('cliente', 'artista'),
  upload.single('imagen'),
  crearComentario
);
router.delete(
  '/comentarios/:id',
  authenticateToken, requireRole('cliente', 'artista'),
  eliminarComentario
);

export default router;
