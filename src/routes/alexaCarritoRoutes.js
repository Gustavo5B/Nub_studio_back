import express from 'express';
import { agregarAlCarritoAlexa } from '../controllers/carritoController.js';

const router = express.Router();

// Sin resolveUsuario ni requireRole: esta ruta la llama el Lambda de Alexa,
// no un usuario con sesión web. Se protege con el header x-skill-secret.
router.post('/', agregarAlCarritoAlexa);

export default router;