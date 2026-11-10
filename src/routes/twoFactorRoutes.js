import express from 'express';
import logger from '../config/logger.js';
import { setupTOTP, verifyTOTP, validateTOTP } from '../controllers/twoFactorController.js';

const router = express.Router();

logger.debug('🔧 [2FA ROUTES] Cargando rutas de 2FA...');

// Middleware de debug para ver todas las requests
router.use((req, res, next) => {
  logger.debug(`🔍 [2FA] ${req.method} ${req.path}`);
  next();
});

router.post('/setup-totp', (req, res, next) => {
  logger.debug('📍 Ruta /setup-totp llamada');
  setupTOTP(req, res, next);
});

router.post('/verify-totp', (req, res, next) => {
  logger.debug('📍 Ruta /verify-totp llamada');
  verifyTOTP(req, res, next);
});

router.post('/validate-totp', (req, res, next) => {
  logger.debug('📍 Ruta /validate-totp llamada');
  validateTOTP(req, res, next);
});

logger.debug('✅ [2FA ROUTES] Rutas 2FA registradas:');
logger.debug('   POST /api/2fa/setup-totp');
logger.debug('   POST /api/2fa/verify-totp');
logger.debug('   POST /api/2fa/validate-totp');

export default router;