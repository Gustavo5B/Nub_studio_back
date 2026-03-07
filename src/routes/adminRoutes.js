import { Router } from 'express';
import { authenticateToken, requireRole } from '../middlewares/authMiddleware.js';
import { generarBackup, obtenerHistorial, eliminarBackup } from '../controllers/backupController.js';

const router = Router();

router.use(authenticateToken);
router.use(requireRole('admin'));

router.get('/backup',              generarBackup);
router.get('/backups/historial',   obtenerHistorial);
router.delete('/backups/:id',      eliminarBackup);   // ← añadida

export default router;