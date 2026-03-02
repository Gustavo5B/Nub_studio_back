import express from 'express';
import multer  from 'multer';
import {
  getMiPerfil, actualizarMiPerfil,   // ← perfil
  getMisObras, nuevaObra,
  getObraById, actualizarObraArtista,
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

// ── Perfil ───────────────────────────────────────────────────
router.get('/mi-perfil',   authenticateToken, requireRole('artista'), getMiPerfil);
router.put('/mi-perfil',   authenticateToken, requireRole('artista'), upload.single('foto'), actualizarMiPerfil);

// ── Obras ────────────────────────────────────────────────────
router.get('/mis-obras',   authenticateToken, requireRole('artista'), getMisObras);
router.post('/nueva-obra', authenticateToken, requireRole('artista'), upload.single('imagen'), nuevaObra);
router.get('/obra/:id',    authenticateToken, requireRole('artista'), getObraById);
router.put('/obra/:id',    authenticateToken, requireRole('artista'), upload.single('imagen'), actualizarObraArtista);

export default router;