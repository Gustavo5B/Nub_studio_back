import { Router } from 'express';
import { getConfiguracionPublica } from '../controllers/configuracionController.js';

const router = Router();

// Valor público de una clave (ej: precio_empaque_reforzado)
router.get('/configuracion/:clave', getConfiguracionPublica);

export default router;
