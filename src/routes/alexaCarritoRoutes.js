import express from 'express';
import { agregarAlCarritoAlexa, getCarritoAlexa } from '../controllers/carritoController.js';

const router = express.Router();


router.post('/', agregarAlCarritoAlexa);
router.get('/', getCarritoAlexa);

export default router;