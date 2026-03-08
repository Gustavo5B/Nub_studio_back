import { Router } from 'express';
import { listarEstados } from '../controllers/estadosController.js';

const router = Router();

// ── PÚBLICA ───────────────────────────────────────────────
router.get('/', listarEstados);

export default router;