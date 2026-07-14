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
import { listarColeccionesAdmin, actualizarColeccionAdmin, obtenerColeccionAdmin, cambiarActivaColeccionAdmin } from '../controllers/coleccionesController.js';
import { listarClientes, toggleEstadoCliente } from '../controllers/clientesAdminController.js';
import { getVentasAdmin, cambiarEstadoVenta } from '../controllers/ventasController.js';
import { listarCupones, crearCupon, actualizarCupon, eliminarCupon } from '../controllers/cuponesController.js';
import { setDescuentoObraAdmin } from '../controllers/obrasController.js';
import { listarTamañosAdmin, crearTamaño, actualizarTamaño, eliminarTamaño } from '../controllers/tamañosController.js';
import { listarMarcosAdmin, crearMarco, actualizarMarco, eliminarMarco } from '../controllers/marcosController.js';
import { getConfiguracion, updateConfiguracion } from '../controllers/configuracionController.js';
import { getPendientes, getHistorial, getDetalleArtista, crearLiquidacion } from '../controllers/liquidacionesController.js';

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
router.put('/colecciones/:id/activa',   cambiarActivaColeccionAdmin);
router.put('/colecciones/:id',          actualizarColeccionAdmin);

router.get('/clientes',                 listarClientes);
router.put('/clientes/:id/estado',      toggleEstadoCliente);

router.get('/ventas-admin',             getVentasAdmin);
router.put('/ventas-admin/:id/estado',  cambiarEstadoVenta);

// Descuentos en obras (admin puede modificar cualquier obra)
router.patch('/obras/:id/descuento', setDescuentoObraAdmin);

// Cupones de descuento
router.get(   '/cupones',     listarCupones);
router.post(  '/cupones',     crearCupon);
router.put(   '/cupones/:id', actualizarCupon);
router.delete('/cupones/:id', eliminarCupon);

// Tamaños disponibles (catálogo global)
router.get(   '/tamanos',     listarTamañosAdmin);
router.post(  '/tamanos',     crearTamaño);
router.put(   '/tamanos/:id', actualizarTamaño);
router.delete('/tamanos/:id', eliminarTamaño);

// Tipos de marco (catálogo global)
router.get(   '/marcos',     listarMarcosAdmin);
router.post(  '/marcos',     crearMarco);
router.put(   '/marcos/:id', actualizarMarco);
router.delete('/marcos/:id', eliminarMarco);

// Configuración del sistema
router.get(  '/configuracion',        getConfiguracion);
router.patch('/configuracion/:clave', updateConfiguracion);

// Liquidaciones a artistas
router.get( '/liquidaciones/pendientes',      getPendientes);
router.get( '/liquidaciones/historial',       getHistorial);
router.get( '/liquidaciones/artista/:id',     getDetalleArtista);
router.post('/liquidaciones',                 crearLiquidacion);

export default router;