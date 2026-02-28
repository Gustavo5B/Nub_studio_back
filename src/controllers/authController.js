import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
import { pool } from "../config/db.js";
import { generateCode, sendRecoveryCode, sendWelcomeEmail } from "../services/emailService.js";
import { saveActiveSession, revokeOtherSessions } from '../services/sessionService.js';
import crypto from 'crypto';

dotenv.config();

// =========================================================
// 🔒 HELPERS
// =========================================================
const maskEmail = (email) => {
  if (!email) return 'correo oculto';
  const [localPart, domain] = email.split('@');
  if (!domain) return '***@***';
  const maskedLocal = localPart.length > 4
    ? localPart.substring(0, 2) + '***' + localPart.substring(localPart.length - 3)
    : '***';
  const domainParts = domain.split('.');
  const maskedDomain = domainParts.length > 1
    ? domainParts[0].substring(0, 1) + '***.' + domainParts.slice(1).join('.')
    : '***';
  return `${maskedLocal}@${maskedDomain}`;
};

const secureLog = {
  info: (message, metadata = {}) => {
    const sanitized = { ...metadata };
    delete sanitized.contrasena; delete sanitized.password;
    delete sanitized.codigo; delete sanitized.token; delete sanitized.secret;
    console.log(`ℹ️ ${message}`, Object.keys(sanitized).length > 0 ? sanitized : '');
  },
  error: (message, error) => {
    console.error(`❌ ${message}`, { name: error.name, code: error.code });
  },
  security: (action, userId, metadata = {}) => {
    console.log(`🔐 SECURITY [${action}] User:${userId || 'unknown'}`, {
      timestamp: new Date().toISOString(), ...metadata
    });
  }
};

// =========================================================
// 🔑 GENERAR TOKEN — incluye rol
// =========================================================
const generateToken = (user) => {
  return jwt.sign(
    {
      sub: user.id_usuario.toString(),
      jti: crypto.randomUUID(),
      rol: user.rol || 'cliente'   // ← INCLUYE ROL
    },
    process.env.JWT_SECRET,
    {
      algorithm: 'HS256',
      expiresIn: "24h",
      issuer: 'nub-studio',
      audience: 'nub-users'
    }
  );
};

const calcularTiempoBloqueo = (bloqueosTotales) => {
  if (bloqueosTotales === 0) return 15;
  if (bloqueosTotales === 1) return 30;
  return 60;
};

const registrarHistorialLogin = async (usuario, tipo, razon = null) => {
  try {
    await pool.query(
      `INSERT INTO historial_login (id_usuario, correo, tipo_evento, detalles) VALUES ($1, $2, $3, $4)`,
      [usuario?.id_usuario || null, usuario?.correo || 'desconocido', tipo, razon]
    );
  } catch (error) {
    secureLog.error('Error al registrar historial', error);
  }
};

// =========================================================
// 📝 REGISTRO
// =========================================================
export const register = async (req, res) => {
  const { nombre, correo, contrasena } = req.body;
  try {
    secureLog.info('Intento de registro', { email: maskEmail(correo) });

    if (!nombre || !correo || !contrasena)
      return res.status(400).json({ message: "Todos los campos son obligatorios" });

    if (contrasena.length < 8)
      return res.status(400).json({ message: "La contraseña debe tener al menos 8 caracteres" });

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(correo))
      return res.status(400).json({ message: "El formato del correo no es válido" });

    const existingUser = await pool.query(
      "SELECT id_usuario FROM usuarios WHERE correo = $1 LIMIT 1", [correo]
    );
    if (existingUser.rows.length > 0) {
      secureLog.security('REGISTRO_DUPLICADO', null, { email: maskEmail(correo) });
      return res.status(400).json({ message: "El correo ya está registrado." });
    }

    const hash = await bcrypt.hash(contrasena, 12);
    const result = await pool.query(
      "INSERT INTO usuarios (nombre_completo, correo, contraseña_hash, estado, rol) VALUES ($1, $2, $3, $4, $5) RETURNING id_usuario",
      [nombre, correo, hash, "activo", "cliente"]
    );

    const newUserId = result.rows[0].id_usuario;
    secureLog.security('REGISTRO_EXITOSO', newUserId);

    sendWelcomeEmail(correo, nombre)
      .then(() => secureLog.info('Email de bienvenida enviado', { userId: newUserId }))
      .catch((emailError) => secureLog.error('Error enviando email', emailError));

    res.status(201).json({
      message: "Usuario registrado exitosamente ✅",
      user: { id: newUserId, nombre, correo, rol: "cliente" }
    });

  } catch (error) {
    secureLog.error('Error en registro', error);
    if (error.code === '23505')
      return res.status(400).json({ message: "El correo ya está registrado." });
    res.status(500).json({ message: "Error al registrar usuario." });
  }
};

// =========================================================
// 🔐 LOGIN
// =========================================================
export const login = async (req, res) => {
  try {
    const { correo, contrasena } = req.body;
    secureLog.info('Intento de login', { email: maskEmail(correo) });

    if (!correo || !contrasena)
      return res.status(400).json({ message: "Correo y contraseña son obligatorios." });

    const result = await pool.query(
      "SELECT * FROM usuarios WHERE correo = $1 LIMIT 1", [correo]
    );
    if (result.rows.length === 0) {
      secureLog.security('LOGIN_USUARIO_NO_ENCONTRADO', null, { email: maskEmail(correo) });
      return res.status(404).json({ message: "Usuario no encontrado." });
    }

    const user = result.rows[0];

    // Bloqueo
    if (user.bloqueado_hasta) {
      const ahora = new Date();
      const desbloqueo = new Date(user.bloqueado_hasta);
      if (ahora < desbloqueo) {
        const minutosRestantes = Math.ceil((desbloqueo - ahora) / 60000);
        await registrarHistorialLogin(user, 'BLOQUEO', 'Intento durante bloqueo');
        return res.status(403).json({
          blocked: true,
          message: `🔒 Cuenta bloqueada. Intenta de nuevo en ${minutosRestantes} minuto${minutosRestantes > 1 ? 's' : ''}.`,
          minutesRemaining: minutosRestantes,
          unlockTime: desbloqueo.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
        });
      } else {
        await pool.query(
          'UPDATE usuarios SET bloqueado_hasta = NULL, intentos_fallidos = 0 WHERE id_usuario = $1',
          [user.id_usuario]
        );
        user.bloqueado_hasta = null;
        user.intentos_fallidos = 0;
      }
    }

    // Contraseña
    const match = await bcrypt.compare(contrasena, user.contraseña_hash);
    if (!match) {
      const nuevoIntentos = (user.intentos_fallidos || 0) + 1;
      if (nuevoIntentos >= 3) {
        const tiempoBloqueo = calcularTiempoBloqueo(user.bloqueos_totales || 0);
        await pool.query(
          `UPDATE usuarios SET intentos_fallidos = $1, bloqueado_hasta = NOW() + INTERVAL '${tiempoBloqueo} minutes' WHERE id_usuario = $2`,
          [nuevoIntentos, user.id_usuario]
        );
        await registrarHistorialLogin(user, 'BLOQUEO', `Bloqueado por ${tiempoBloqueo} minutos`);
        return res.status(403).json({
          blocked: true,
          message: `🔒 Cuenta bloqueada por ${tiempoBloqueo} minutos.`,
          minutesBlocked: tiempoBloqueo
        });
      } else {
        await pool.query('UPDATE usuarios SET intentos_fallidos = $1 WHERE id_usuario = $2', [nuevoIntentos, user.id_usuario]);
        await registrarHistorialLogin(user, 'LOGIN_FALLIDO', `Intento ${nuevoIntentos}/3`);
        const intentosRestantes = 3 - nuevoIntentos;
        return res.status(401).json({
          message: `❌ Contraseña incorrecta. Te ${intentosRestantes === 1 ? 'queda' : 'quedan'} ${intentosRestantes} intento${intentosRestantes > 1 ? 's' : ''}.`,
          attemptsRemaining: intentosRestantes
        });
      }
    }

    // Reset intentos
    if (user.intentos_fallidos > 0)
      await pool.query('UPDATE usuarios SET intentos_fallidos = 0 WHERE id_usuario = $1', [user.id_usuario]);

    // Estado
    if (user.estado !== "activo") {
      if (user.estado === "pendiente")
        return res.status(403).json({ message: "Cuenta pendiente de verificación. Revisa tu correo 📧", requiresVerification: true, correo: user.correo });
      return res.status(403).json({ message: "Cuenta inactiva o suspendida." });
    }

    // 2FA
    if (user.requiere_2fa) {
      if (user.metodo_2fa === 'TOTP') {
        await registrarHistorialLogin(user, 'LOGIN_EXITOSO', '2FA TOTP requerido');
        return res.json({ message: "Ingresa el código de tu aplicación autenticadora 📱", requires2FA: true, metodo_2fa: "TOTP", correo: user.correo });
      } else if (user.metodo_2fa === 'GMAIL') {
        const code = generateCode();
        await pool.query('UPDATE usuarios SET secret_2fa=$1 WHERE id_usuario=$2', [code, user.id_usuario]);
        await sendRecoveryCode(user.correo, code);
        await registrarHistorialLogin(user, 'LOGIN_EXITOSO', '2FA Gmail enviado');
        return res.json({ message: "Se envió un código de acceso a tu correo 📧", requires2FA: true, metodo_2fa: "GMAIL", correo: user.correo });
      }
    }

    // Login exitoso
    const token = generateToken(user);
    await saveActiveSession(user.id_usuario, token, req);
    await registrarHistorialLogin(user, 'LOGIN_EXITOSO', 'Login directo');
    secureLog.security('LOGIN_EXITOSO', user.id_usuario, { rol: user.rol });

    res.json({
      message: "Inicio de sesión exitoso ✅",
      access_token: token,
      token_type: "bearer",
      usuario: {
        id: user.id_usuario,
        nombre: user.nombre_completo,
        correo: user.correo,
        estado: user.estado,
        rol: user.rol           // ← INCLUYE ROL
      }
    });

  } catch (error) {
    secureLog.error('Error crítico en login', error);
    res.status(500).json({ message: "Error interno del servidor." });
  }
};

// =========================================================
// ⭐ LOGIN CON 2FA TOTP
// =========================================================
export const loginWith2FA = async (req, res) => {
  try {
    const { correo, codigo2fa } = req.body;
    if (!correo || !codigo2fa)
      return res.status(400).json({ message: "Correo y código son obligatorios" });

    const result = await pool.query("SELECT * FROM usuarios WHERE correo = $1 LIMIT 1", [correo]);
    if (result.rows.length === 0)
      return res.status(404).json({ message: "Usuario no encontrado." });

    const user = result.rows[0];
    const speakeasy = (await import("speakeasy")).default;
    const verified = speakeasy.totp.verify({ secret: user.secret_2fa, encoding: "base32", token: codigo2fa, window: 2 });

    if (!verified) {
      secureLog.security('2FA_TOTP_INCORRECTO', user.id_usuario);
      return res.status(401).json({ message: "Código 2FA incorrecto ❌" });
    }

    if (user.intentos_fallidos > 0)
      await pool.query('UPDATE usuarios SET intentos_fallidos = 0 WHERE id_usuario = $1', [user.id_usuario]);

    const token = generateToken(user);
    await saveActiveSession(user.id_usuario, token, req);
    await registrarHistorialLogin(user, 'LOGIN_EXITOSO', 'Login con 2FA TOTP');

    res.json({
      message: "Inicio de sesión exitoso ✅",
      access_token: token,
      token_type: "bearer",
      usuario: {
        id: user.id_usuario,
        nombre: user.nombre_completo,
        correo: user.correo,
        estado: user.estado,
        rol: user.rol           // ← INCLUYE ROL
      }
    });
  } catch (error) {
    secureLog.error('Error en loginWith2FA', error);
    res.status(500).json({ message: "Error interno del servidor." });
  }
};

// =========================================================
// ✅ VERIFICAR CÓDIGO GMAIL 2FA
// =========================================================
export const verifyLoginCode = async (req, res) => {
  try {
    const { correo, codigo } = req.body;
    if (!correo || !codigo)
      return res.status(400).json({ message: "Correo y código son obligatorios" });

    const result = await pool.query(
      "SELECT * FROM usuarios WHERE correo = $1 AND requiere_2fa = TRUE LIMIT 1", [correo]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ message: "Usuario no encontrado o sin Gmail 2FA" });

    const user = result.rows[0];
    if (!user.secret_2fa || user.secret_2fa !== codigo) {
      secureLog.security('CODIGO_GMAIL_INVALIDO', user.id_usuario);
      return res.status(401).json({ message: "Código inválido ❌" });
    }

    await pool.query("UPDATE usuarios SET secret_2fa = NULL WHERE id_usuario = $1", [user.id_usuario]);
    if (user.intentos_fallidos > 0)
      await pool.query('UPDATE usuarios SET intentos_fallidos = 0 WHERE id_usuario = $1', [user.id_usuario]);

    const token = generateToken(user);
    await saveActiveSession(user.id_usuario, token, req);
    await registrarHistorialLogin(user, 'LOGIN_EXITOSO', 'Login con Gmail 2FA');

    res.json({
      message: "✅ Verificación exitosa. Sesión iniciada.",
      access_token: token,
      token_type: "bearer",
      usuario: {
        id: user.id_usuario,
        nombre: user.nombre_completo,
        correo: user.correo,
        estado: user.estado,
        rol: user.rol           // ← INCLUYE ROL
      }
    });
  } catch (error) {
    secureLog.error('Error en verifyLoginCode', error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
};

// =========================================================
// 🔥 REVOCAR OTRAS SESIONES
// =========================================================
export const closeOtherSessions = async (req, res) => {
  try {
    const userId = req.user.id_usuario;
    const currentToken = req.headers.authorization?.split(' ')[1];
    if (!currentToken)
      return res.status(400).json({ message: "No se encontró token actual" });

    const sessionsRevoked = await revokeOtherSessions(userId, currentToken);
    secureLog.security('SESIONES_REVOCADAS', userId, { cantidad: sessionsRevoked });

    res.json({ message: `✅ Se cerraron ${sessionsRevoked} sesión(es) en otros dispositivos`, sessionsRevoked });
  } catch (error) {
    secureLog.error('Error al revocar sesiones', error);
    res.status(500).json({ message: "Error al cerrar otras sesiones" });
  }
};

// =========================================================
// ✅ VERIFICAR SESIÓN
// =========================================================
export const checkSession = async (req, res) => {
  try {
    res.json({ valid: true, message: "Sesión válida", rol: req.user.rol });
  } catch (error) {
    secureLog.error('Error al verificar sesión', error);
    res.status(500).json({ message: "Error al verificar sesión" });
  }
};
// =========================================================
// 🎨 REGISTRO DE ARTISTA
// =========================================================
export const registroArtista = async (req, res) => {
  try {
    const { nombre_completo, correo, contrasena, nombre_artistico, telefono, biografia, id_categoria_principal } = req.body;

    if (!nombre_completo || !correo || !contrasena || !biografia || !id_categoria_principal)
      return res.status(400).json({ message: "Faltan campos obligatorios" });

    if (contrasena.length < 8)
      return res.status(400).json({ message: "La contraseña debe tener al menos 8 caracteres" });

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(correo))
      return res.status(400).json({ message: "El formato del correo no es válido" });

    // Verificar duplicado
    const existeUsuario = await pool.query(
      "SELECT id_usuario FROM usuarios WHERE correo = $1 LIMIT 1", [correo]
    );
    if (existeUsuario.rows.length > 0)
      return res.status(400).json({ message: "El correo ya está registrado" });

    const hash = await bcrypt.hash(contrasena, 12);

    // Crear usuario con rol artista
    const resUsuario = await pool.query(
      `INSERT INTO usuarios (nombre_completo, correo, contraseña_hash, rol, estado, activo)
       VALUES ($1, $2, $3, 'artista', 'activo', TRUE)
       RETURNING id_usuario`,
      [nombre_completo, correo, hash]
    );
    const id_usuario = resUsuario.rows[0].id_usuario;

    // Crear artista vinculado al usuario
    await pool.query(
      `INSERT INTO artistas (id_usuario, nombre_completo, nombre_artistico, correo, telefono, biografia, id_categoria_principal, estado, activo, eliminado)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendiente', TRUE, FALSE)`,
      [id_usuario, nombre_completo, nombre_artistico || null, correo, telefono || null, biografia, id_categoria_principal]
    );

    secureLog.security('REGISTRO_ARTISTA', id_usuario, { email: maskEmail(correo) });

    res.status(201).json({
      success: true,
      message: "Solicitud enviada. El equipo de Nu-B Studio revisará tu perfil."
    });

  } catch (error) {
    secureLog.error('Error en registro de artista', error);
    if (error.code === '23505')
      return res.status(400).json({ message: "El correo ya está registrado" });
    res.status(500).json({ message: "Error al procesar la solicitud" });
  }
};