import express from 'express';
import multer  from 'multer';
import {
  getMiPerfil, getMisObras, nuevaObra,
  getObraById, actualizarObraArtista,   // ← nuevas
} from '../controllers/artistaPortalController.js';
import { authenticateToken, requireRole } from '../middlewares/authMiddleware.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Solo se permiten imágenes'), false);
  },
});

router.get('/mi-perfil',  authenticateToken, requireRole('artista'), getMiPerfil);
router.get('/mis-obras',  authenticateToken, requireRole('artista'), getMisObras);
router.post('/nueva-obra',authenticateToken, requireRole('artista'), upload.single('imagen'), nuevaObra);

// ── Editar obra ──────────────────────────────────────────────
router.get('/obra/:id',   authenticateToken, requireRole('artista'), getObraById);
router.put('/obra/:id',   authenticateToken, requireRole('artista'), upload.single('imagen'), actualizarObraArtista);

export default router;