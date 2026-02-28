import express from 'express';
import { login, loginWith2FA, verifyLoginCode, closeOtherSessions, checkSession, registroArtista } from '../controllers/authController.js';
import { register, verifyEmail, resendVerificationCode } from '../controllers/registerController.js';
import { authenticateToken } from '../middlewares/authMiddleware.js'; // ← NUEVO IMPORT

const router = express.Router();

// Rutas de registro
router.post("/register", register);
router.post("/verify-email", verifyEmail);
router.post("/resend-code", resendVerificationCode);
router.post("/registro-artista", registroArtista);  // ← NUEVO

// Rutas de login
router.post("/login", login);
router.post("/login-2fa", loginWith2FA);
router.post("/verify-login-code", verifyLoginCode);

// 🔥 NUEVA RUTA: Cerrar otras sesiones (requiere autenticación)
router.post("/close-other-sessions", authenticateToken, closeOtherSessions);
// ✅ NUEVA RUTA: Verificar sesión activa
router.get("/check-session", authenticateToken, checkSession);

export default router;