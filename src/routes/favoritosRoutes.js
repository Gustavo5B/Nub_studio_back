import express from 'express';
import {
  getFavoritos,
  toggleFavorito,
  eliminarFavorito,
  checkFavorito,
} from '../controllers/favoritosController.js';
import { authenticateToken, requireRole } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.use(authenticateToken);
router.use(requireRole('cliente'));

router.get('/',                getFavoritos);
router.get('/check/:id_obra',  checkFavorito);
router.post('/:id_obra',       toggleFavorito);
router.delete('/:id_obra',     eliminarFavorito);

export default router;
