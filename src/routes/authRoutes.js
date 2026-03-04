import express from 'express';
import {
  login,
  loginWith2FA,
  verifyLoginCode,
  closeOtherSessions,
  checkSession,
  registroArtista,
  verificarEmailArtista,
  activarCuenta,
  reenviarActivacion,
} from '../controllers/authController.js';
import { register, verifyEmail, resendVerificationCode } from '../controllers/registerController.js';
import { authenticateToken } from '../middlewares/authMiddleware.js';

const router = express.Router();

// ── Registro clientes normales ───────────────────────────────
router.post("/register",      register);
router.post("/verify-email",  verifyEmail);
router.post("/resend-code",   resendVerificationCode);

// ── Registro público de artistas ────────────────────────────
router.post("/registro-artista", registroArtista);

// ── Activación / verificación de cuenta ─────────────────────
// Artista creado por admin → define su contraseña
router.post("/activar-cuenta",       activarCuenta);
// Artista registro público → verifica su correo
router.post("/verificar-email",      verificarEmailArtista);
// Reenviar link (expiró o no llegó)
router.post("/reenviar-activacion",  reenviarActivacion);

// ── Login ────────────────────────────────────────────────────
router.post("/login",             login);
router.post("/login-2fa",         loginWith2FA);
router.post("/verify-login-code", verifyLoginCode);

// ── Sesiones (requieren autenticación) ──────────────────────
router.post("/close-other-sessions", authenticateToken, closeOtherSessions);
router.get("/check-session",         authenticateToken, checkSession);

export default router;