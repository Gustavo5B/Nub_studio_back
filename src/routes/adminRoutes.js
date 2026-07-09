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
import { listarColeccionesAdmin, actualizarColeccionAdmin, obtenerColeccionAdmin } from '../controllers/coleccionesController.js';
import { listarClientes, toggleEstadoCliente } from '../controllers/clientesAdminController.js';
import { getVentasAdmin, cambiarEstadoVenta } from '../controllers/ventasController.js';

const router = Router();

router.use(authenticateToken);
router.use(requireRole('admin'));

router.post('/backup',             generarBackup);       // ← cambiado GET → POST
router.get('/backups/historial',   obtenerHistorial);
router.get('/backups/tablas',      obtenerSaludTablas);  // ← nuevo
router.get('/backups/cron',        obtenerConfigCron);   // ← nuevo
router.post('/backups/cron',       guardarConfigCron);   // ← nuevo
router.delete('/backups/:id',      eliminarBackup);

router.get('/colecciones',              listarColeccionesAdmin);
router.get('/colecciones/:id',          obtenerColeccionAdmin);
router.put('/colecciones/:id',          actualizarColeccionAdmin);

router.get('/clientes',                 listarClientes);
router.put('/clientes/:id/estado',      toggleEstadoCliente);

router.get('/ventas-admin',             getVentasAdmin);
router.put('/ventas-admin/:id/estado',  cambiarEstadoVenta);

export default router;