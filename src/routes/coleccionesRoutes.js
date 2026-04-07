import { Router } from 'express';
import multer from 'multer';
import {
  listarColecciones,
  obtenerColeccionPorSlug,
  getMisColecciones,
  crearColeccion,
  actualizarColeccion,
  eliminarColeccion,
} from '../controllers/coleccionesController.js';  // 👈 Verifica: sin 's' al final
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

// ── Artista autenticado ─────────────────────────────────────
router.get('/mis-colecciones', authenticateToken, requireRole('artista'), getMisColecciones);

// ── Públicas ─────────────────────────────────────────────────
router.get('/', listarColecciones);

// 👇 IMPORTANTE: La ruta de slug debe ser específica y usar un prefijo
router.get('/slug/:slug', obtenerColeccionPorSlug);  // ✅ Cambiado a /slug/:slug

// Si necesitas obtener por ID, agrega esta ruta después
// router.get('/:id', obtenerColeccionPorId);

router.post('/', authenticateToken, requireRole('artista'), upload.single('imagen_portada'), crearColeccion);
router.put('/:id', authenticateToken, requireRole('artista'), upload.single('imagen_portada'), actualizarColeccion);
router.delete('/:id', authenticateToken, requireRole('artista'), eliminarColeccion);

export default router;