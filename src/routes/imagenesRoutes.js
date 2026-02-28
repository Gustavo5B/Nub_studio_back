import { Router } from 'express';
import { upload } from '../config/cloudinaryConfig.js';
import {
  subirImagenPrincipal, subirImagenesGaleria,
  eliminarImagenObra, reordenarImagenes
} from '../controllers/imagenesController.js';
import { authenticateToken, requireRole } from '../middlewares/authMiddleware.js';

const router = Router();

router.post('/principal',  authenticateToken, requireRole('admin'), upload.single('imagen'),    subirImagenPrincipal);
router.post('/galeria',    authenticateToken, requireRole('admin'), upload.array('imagenes', 5), subirImagenesGaleria);
router.delete('/:id_imagen', authenticateToken, requireRole('admin'), eliminarImagenObra);
router.put('/reordenar',   authenticateToken, requireRole('admin'), reordenarImagenes);

export default router;