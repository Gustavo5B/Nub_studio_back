import express from 'express';
import { crearDireccion } from '../controllers/direccionesController.js';
import { authenticateToken, requireRole } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.use(authenticateToken);
router.use(requireRole('cliente'));

router.post('/', crearDireccion);

export default router;