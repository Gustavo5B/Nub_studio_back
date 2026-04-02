import { Router } from 'express';
import multer from 'multer';
import {
  listarColecciones,
  obtenerColeccionPorSlug,
  getMisColecciones,
  crearColeccion,
  actualizarColeccion,
  eliminarColeccion,
} from '../controllers/coleccionesController.js';
import { authenticateToken, requireRole } from '../middlewares/authMiddleware.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Solo se permiten imágenes'), false);
  },
});

// ── Artista autenticado (antes que /:slug para evitar conflicto) ─────────────
router.get('/mis-colecciones',    authenticateToken, requireRole('artista'), getMisColecciones);

// ── Públicas ─────────────────────────────────────────────────
router.get('/',       listarColecciones);
router.get('/:slug',  obtenerColeccionPorSlug);
router.post('/',                  authenticateToken, requireRole('artista'), upload.single('imagen_portada'), crearColeccion);
router.put('/:id',                authenticateToken, requireRole('artista'), upload.single('imagen_portada'), actualizarColeccion);
router.delete('/:id',             authenticateToken, requireRole('artista'), eliminarColeccion);

export default router;
