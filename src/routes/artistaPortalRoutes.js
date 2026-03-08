import express from 'express';
import multer  from 'multer';
import {
  getMiPerfil, actualizarMiPerfil,
  getMisObras, nuevaObra,
  getObraById, actualizarObraArtista,
} from '../controllers/artistaPortalController.js';
import {
  getRedesSociales, agregarRedSocial,
  actualizarRedSocial, eliminarRedSocial,
} from '../controllers/redesSocialesController.js';
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

// ── Redes Sociales ───────────────────────────────────────────
router.get('/redes-sociales',        authenticateToken, requireRole('artista'), getRedesSociales);
router.post('/redes-sociales',       authenticateToken, requireRole('artista'), agregarRedSocial);
router.put('/redes-sociales/:id',    authenticateToken, requireRole('artista'), actualizarRedSocial);
router.delete('/redes-sociales/:id', authenticateToken, requireRole('artista'), eliminarRedSocial);

export default router;