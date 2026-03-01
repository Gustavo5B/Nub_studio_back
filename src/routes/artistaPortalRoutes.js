// back_auth_mysql/src/routes/artistaPortalRoutes.js
import express from 'express';
import multer from 'multer';
import { getMiPerfil, getMisObras, nuevaObra } from '../controllers/artistaPortalController.js';
import { authenticateToken, requireRole } from '../middlewares/authMiddleware.js';

const router = express.Router();

// Multer en memoria para subir a Cloudinary
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB máx
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Solo se permiten imágenes'), false);
  },
});

// GET /api/artista-portal/mi-perfil
router.get('/mi-perfil', authenticateToken, requireRole('artista'), getMiPerfil);

// GET /api/artista-portal/mis-obras
router.get('/mis-obras', authenticateToken, requireRole('artista'), getMisObras);

// POST /api/artista-portal/nueva-obra
router.post('/nueva-obra', authenticateToken, requireRole('artista'), upload.single('imagen'), nuevaObra);

export default router;