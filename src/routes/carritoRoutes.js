import express from 'express';
import {
  getCarrito,
  agregarAlCarrito,
  actualizarCantidad,
  eliminarDelCarrito,
} from '../controllers/carritoController.js';
import { authenticateToken, requireRole } from '../middlewares/authMiddleware.js';

const router = express.Router();

// Todas las rutas del carrito requieren autenticación y rol cliente
router.use(authenticateToken);
router.use(requireRole('cliente'));

router.get('/',              getCarrito);
router.post('/',             agregarAlCarrito);
router.put('/:id_carrito',   actualizarCantidad);
router.delete('/:id_carrito', eliminarDelCarrito);

export default router;
