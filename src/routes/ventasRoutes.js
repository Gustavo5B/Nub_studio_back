import express from 'express';
import { getMisPedidos } from '../controllers/ventasController.js';
import { authenticateToken, requireRole } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.use(authenticateToken);
router.use(requireRole('cliente'));

router.get('/mis-pedidos', getMisPedidos);

export default router;
