import express from 'express';
import { getMisPedidos, checkout, webhookPago, cancelarMiPedido } from '../controllers/ventasController.js';
import { authenticateToken, requireRole } from '../middlewares/authMiddleware.js';

const router = express.Router();

// Webhook de MercadoPago — sin autenticación (MP llama directo)
router.post('/webhook', webhookPago);

// Rutas protegidas para clientes
router.use(authenticateToken);
router.use(requireRole('cliente'));

router.get('/mis-pedidos',              getMisPedidos);
router.post('/checkout',                checkout);
router.put('/mis-pedidos/:id/cancelar', cancelarMiPedido);

export default router;
