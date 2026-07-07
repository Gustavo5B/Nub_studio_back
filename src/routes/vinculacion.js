import express from 'express';
import { authenticateToken } from '../middlewares/authMiddleware.js';
import { generarCodigo, vincularCuenta, consultarVinculacion } from '../controllers/vinculacionController.js';

const router = express.Router();

router.post('/api/codigo-vinculacion', authenticateToken, generarCodigo);
router.post('/api/vincular', vincularCuenta);
router.get('/api/vinculacion/:alexaUserId', consultarVinculacion);

export default router;