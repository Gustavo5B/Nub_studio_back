import express from 'express';
import { upload } from '../config/cloudinaryConfig.js';
import { 
  listarObras, obtenerObraPorId, obtenerObraPorSlug,
  buscarObras, obtenerObrasPorCategoria, obtenerObrasPorArtista,
  obtenerObrasPorEtiqueta, obtenerObrasDestacadas,
  crearObra, actualizarObra, eliminarObra
} from '../controllers/obrasController.js';
import { 
  validarBusqueda, validarIdObra, validarIdCategoria,
  validarIdArtista, validarSlug
} from '../validators/validators.js';
import { authenticateToken, requireRole } from '../middlewares/authMiddleware.js';  // ← NUEVO

const router = express.Router();

// ── PÚBLICAS (sin token) ──────────────────────────────────
router.get('/',                 validarBusqueda,    listarObras);
router.get('/destacadas',                           obtenerObrasDestacadas);
router.get('/buscar',           validarBusqueda,    buscarObras);
router.get('/categoria/:id',    validarIdCategoria, obtenerObrasPorCategoria);
router.get('/artista/:id',      validarIdArtista,   obtenerObrasPorArtista);
router.get('/etiqueta/:slug',   validarSlug,        obtenerObrasPorEtiqueta);
router.get('/slug/:slug',       validarSlug,        obtenerObraPorSlug);
router.get('/:id',              validarIdObra,      obtenerObraPorId);

// ── PROTEGIDAS (solo admin) ───────────────────────────────
router.post('/',   authenticateToken, requireRole('admin'), upload.single('imagen'), crearObra);
router.put('/:id', authenticateToken, requireRole('admin'), upload.single('imagen'), actualizarObra);
router.delete('/:id', authenticateToken, requireRole('admin'), eliminarObra);

export default router;