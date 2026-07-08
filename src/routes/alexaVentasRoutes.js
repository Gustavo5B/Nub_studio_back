import express from 'express';
import { getMisPedidosAlexa } from '../controllers/ventasController.js';

const router = express.Router();
router.get('/mis-pedidos', getMisPedidosAlexa);

export default router;