import { Router } from 'express';
import { authenticateToken, requireRole } from '../middlewares/authMiddleware.js';
import {
  generarBackup,
  obtenerHistorial,
  eliminarBackup,
  obtenerSaludTablas,
  obtenerConfigCron,
  guardarConfigCron,
} from '../controllers/backupController.js';
import { listarColeccionesAdmin, actualizarColeccionAdmin } from '../controllers/coleccionesController.js';

const router = Router();

router.use(authenticateToken);
router.use(requireRole('admin'));

router.post('/backup',             generarBackup);       // ← cambiado GET → POST
router.get('/backups/historial',   obtenerHistorial);
router.get('/backups/tablas',      obtenerSaludTablas);  // ← nuevo
router.get('/backups/cron',        obtenerConfigCron);   // ← nuevo
router.post('/backups/cron',       guardarConfigCron);   // ← nuevo
router.delete('/backups/:id',      eliminarBackup);

router.get('/colecciones',         listarColeccionesAdmin);
router.put('/colecciones/:id',     actualizarColeccionAdmin);

export default router;