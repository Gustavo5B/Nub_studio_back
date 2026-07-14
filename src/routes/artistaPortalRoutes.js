import express from 'express';
import multer  from 'multer';
import {
  getMiPerfil, actualizarMiPerfil,
  agregarFotoPersonal, eliminarFotoPersonal,
  getMisObras, nuevaObra,
  getObraById, actualizarObraArtista,
  getMisColecciones,
  subirObrasLote,
  getMisVentas,
  setDescuentoObra,
} from '../controllers/artistaPortalController.js';
import {
  getTamañosDeObra, asignarTamañoObra,
  actualizarTamañoObra, eliminarTamañoObra,
} from '../controllers/tamañosController.js';
import {
  getObrasMarcos, asignarMarcoObra, eliminarMarcoObra,
} from '../controllers/marcosController.js';
import {
  getRedesSociales, agregarRedSocial,
  actualizarRedSocial, eliminarRedSocial,
} from '../controllers/redesSocialesController.js';
import { authenticateToken, requireRole } from '../middlewares/authMiddleware.js';
import { detectXSS } from '../middlewares/sanitize.middleware.js';
import { detectSQLInjection } from '../middlewares/sql-injection.middleware.js';
import logger from '../config/logger.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Solo se permiten imágenes'), false);
  },
});

// ── Middleware post-multer: revisa campos de texto en multipart ──
const sanitizeMultipart = (req, res, next) => {
  if (!req.body) return next();
  const camposTexto = ['titulo', 'descripcion', 'tecnica', 'nombre_artistico', 'biografia'];
  for (const campo of camposTexto) {
    const valor = req.body[campo];
    if (typeof valor !== 'string') continue;
    if (detectXSS(valor)) {
      logger.warn(`XSS detectado en multipart.${campo}: ${valor.substring(0, 100)}`);
      return res.status(400).json({
        error: 'Solicitud rechazada',
        message: 'Se detecto contenido potencialmente malicioso en la solicitud',
        code: 'XSS_DETECTED',
        field: campo,
      });
    }
    if (detectSQLInjection(valor)) {
      logger.warn(`SQL Injection detectado en multipart.${campo}`);
      return res.status(400).json({
        error: 'Solicitud rechazada',
        message: 'Se detectaron patrones sospechosos en la solicitud',
        code: 'SQL_INJECTION_DETECTED',
        field: campo,
      });
    }
  }
  next();
};

// ── Perfil ───────────────────────────────────────────────────
router.get('/mi-perfil', authenticateToken, requireRole('artista'), getMiPerfil);
router.put('/mi-perfil', authenticateToken, requireRole('artista'),
  upload.fields([{ name: 'foto_portada', maxCount: 1 }, { name: 'foto_logo', maxCount: 1 }]),
  sanitizeMultipart, actualizarMiPerfil);

// ── Fotos personales ─────────────────────────────────────────
router.post('/fotos-personales',       authenticateToken, requireRole('artista'), upload.single('foto'), agregarFotoPersonal);
router.delete('/fotos-personales/:id', authenticateToken, requireRole('artista'), eliminarFotoPersonal);

// ── Colecciones del artista ────────────────────────────────────
router.get('/mis-colecciones', authenticateToken, requireRole('artista'), getMisColecciones);
// Subida de obras en lote a una colección (la validación XSS/SQLi del
// JSON `obras` se hace dentro del controlador, campo por campo)
router.post('/colecciones/:id/obras-lote', authenticateToken, requireRole('artista'),
  upload.array('imagenes', 10), subirObrasLote);

// ── Ventas del artista ─────────────────────────────────────────
router.get('/mis-ventas', authenticateToken, requireRole('artista'), getMisVentas);

// ── Obras ────────────────────────────────────────────────────
router.get('/mis-obras',   authenticateToken, requireRole('artista'), getMisObras);
router.post('/nueva-obra', authenticateToken, requireRole('artista'),
  upload.single('imagen'), sanitizeMultipart, nuevaObra);
router.get('/obra/:id',    authenticateToken, requireRole('artista'), getObraById);
router.put('/obra/:id',    authenticateToken, requireRole('artista'),
  upload.single('imagen'), sanitizeMultipart, actualizarObraArtista);

// ── Redes Sociales ───────────────────────────────────────────
router.get('/redes-sociales',        authenticateToken, requireRole('artista'), getRedesSociales);
router.post('/redes-sociales',       authenticateToken, requireRole('artista'), agregarRedSocial);
router.put('/redes-sociales/:id',    authenticateToken, requireRole('artista'), actualizarRedSocial);
router.delete('/redes-sociales/:id', authenticateToken, requireRole('artista'), eliminarRedSocial);

// Descuentos en obras propias
router.patch('/obras/:id/descuento', authenticateToken, requireRole('artista'), setDescuentoObra);

// Tamaños de obra (artista gestiona sus propias obras)
router.get(   '/obra/:id_obra/tamanos',     authenticateToken, requireRole('artista'), getTamañosDeObra);
router.post(  '/obra/:id_obra/tamanos',     authenticateToken, requireRole('artista'), asignarTamañoObra);
router.put(   '/obra-tamano/:id',           authenticateToken, requireRole('artista'), actualizarTamañoObra);
router.delete('/obra-tamano/:id',           authenticateToken, requireRole('artista'), eliminarTamañoObra);

// Marcos por obra+tamaño
router.get(   '/obra-tamano/:id_obra_tamano/marcos', authenticateToken, requireRole('artista'), getObrasMarcos);
router.post(  '/obra-tamano/:id_obra_tamano/marcos', authenticateToken, requireRole('artista'), asignarMarcoObra);
router.delete('/obra-marco/:id',                     authenticateToken, requireRole('artista'), eliminarMarcoObra);

export default router;