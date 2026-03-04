import { Router } from 'express';
import { authenticateToken, requireRole } from '../middlewares/authMiddleware.js';
import { generarBackup } from '../controllers/backupController.js';

const router = Router();

// Todas las rutas admin requieren token + rol admin
router.use(authenticateToken);
router.use(requireRole('admin'));

// Backup
router.get('/backup', generarBackup);

// Aquí puedes agregar más rutas admin en el futuro

export default router;