import bcrypt from "bcrypt";
import crypto from "crypto";
import dotenv from "dotenv";
import { pool } from "../config/db.js";
import { sendVerificationEmail } from "../services/emailService.js";
import logger from "../config/logger.js";

dotenv.config();

// =========================================================
// HELPERS
// =========================================================
const getClientIP = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.connection.remoteAddress || req.socket.remoteAddress || req.ip || 'IP no disponible';
};

const getMexicoDateTime = () => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Mexico_City',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
  const parts = formatter.formatToParts();
  const y = parts.find(p => p.type === 'year').value;
  const mo = parts.find(p => p.type === 'month').value;
  const d = parts.find(p => p.type === 'day').value;
  const h = parts.find(p => p.type === 'hour').value;
  const mi = parts.find(p => p.type === 'minute').value;
  const s = parts.find(p => p.type === 'second').value;
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
};

const generateVerificationCode = () => Math.floor(100000 + Math.random() * 900000).toString();

const sanitizeName = (nombre) => nombre.trim().replace(/[<>"'`]/g, '').substring(0, 100);

const sanitizeEmail = (email) => email.trim().toLowerCase().replace(/[<>"'`]/g, '').substring(0, 255);

const sanitizePassword = (password) => {
  const maliciousPatterns = [
    /<script/i, /<\/script/i, /javascript:/i, /onerror=/i, /onclick=/i,
    /<iframe/i, /eval\(/i, /alert\(/i, /onload=/i, /<img/i, /src=/i
  ];
  for (const pattern of maliciousPatterns) {
    if (pattern.test(password)) throw new Error('Contrasena contiene caracteres no permitidos');
  }
  return password.trim();
};

const isValidName = (nombre) => {
  const nameRegex = /^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/;
  return nameRegex.test(nombre) && nombre.length >= 2 && nombre.length <= 100;
};

const validatePasswordStrength = (password) => {
  const errors = [];
  if (password.length < 8)          errors.push('Debe tener al menos 8 caracteres');
  if (!/[A-Z]/.test(password))      errors.push('Debe contener al menos una mayuscula');
  if (!/[a-z]/.test(password))      errors.push('Debe contener al menos una minuscula');
  if (!/[0-9]/.test(password))      errors.push('Debe contener al menos un numero');
  if (!/[@$!%*?&#]/.test(password)) errors.push('Debe contener al menos un caracter especial (@$!%*?&#)');

  const commonPasswords = [
    '12345678', 'password', 'qwerty123', '123456789', 'abc123',
    'password123', '11111111', 'qwertyuiop', 'password1', 'admin123',
    'letmein', 'welcome123', 'monkey123', 'dragon123', 'master123',
    'sunshine', 'princess', 'football', 'iloveyou', 'trustno1'
  ];
  if (commonPasswords.includes(password.toLowerCase()))
    errors.push('Contrasena demasiado comun. Elige una mas segura');

  return errors;
};

const isValidEmail = (email) => {
  const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email) && email.length <= 255;
};

// =========================================================
// REGISTRO DE USUARIO CON VERIFICACION
// =========================================================
export const register = async (req, res) => {
  let { nombre, correo, contrasena, aceptoTerminos } = req.body;

  try {
    logger.info('Iniciando proceso de registro');

    if (!nombre || !correo || !contrasena)
      return res.status(400).json({ message: "Todos los campos son obligatorios" });

    if (!aceptoTerminos || aceptoTerminos !== true)
      return res.status(400).json({ message: "Debes aceptar los Terminos y Condiciones para continuar" });

    nombre = sanitizeName(nombre);
    if (!isValidName(nombre))
      return res.status(400).json({ message: "El nombre solo puede contener letras y espacios (2-100 caracteres)" });

    correo = sanitizeEmail(correo);
    if (!isValidEmail(correo))
      return res.status(400).json({ message: "El formato del correo no es valido" });

    try {
      contrasena = sanitizePassword(contrasena);
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }

    const passwordErrors = validatePasswordStrength(contrasena);
    if (passwordErrors.length > 0)
      return res.status(400).json({ message: "Contrasena insegura", errors: passwordErrors });

    const existingUser = await pool.query(
      "SELECT id_usuario FROM usuarios WHERE correo = $1 LIMIT 1", [correo]
    );
    if (existingUser.rows.length > 0) {
      logger.warn(`Registro duplicado: ${correo}`);
      return res.status(400).json({ message: "El correo ya esta registrado." });
    }

    const hash = await bcrypt.hash(contrasena, 12);
    const codigoVerificacion = generateVerificationCode();

    const result = await pool.query(
      `INSERT INTO usuarios (nombre_completo, correo, contraseña_hash, estado, rol)
       VALUES ($1, $2, $3, $4, $5) RETURNING id_usuario`,
      [nombre, correo, hash, "pendiente", "usuario"]
    );

    const userId = result.rows[0].id_usuario;

    await pool.query(
      `INSERT INTO codigos_2fa_email (id_usuario, codigo, fecha_expiracion)
       VALUES ($1, $2, NOW() + INTERVAL '24 hours')`,
      [userId, codigoVerificacion]
    );

    logger.info(`Registro exitoso: usuario ${userId}`);

    try {
      await sendVerificationEmail(correo, nombre, codigoVerificacion);
      logger.info(`Codigo de verificacion enviado: usuario ${userId}`);
    } catch (emailError) {
      logger.error(`Error al enviar email de verificacion: ${emailError.message}`);
      await pool.query("DELETE FROM usuarios WHERE id_usuario = $1", [userId]);
      return res.status(500).json({ message: "No se pudo enviar el correo de verificacion. Intenta nuevamente." });
    }

    res.status(201).json({
      message: "Registro exitoso. Revisa tu correo para verificar tu cuenta",
      requiresVerification: true,
      user: { id: userId, nombre, correo, terminos_aceptados: true, version_terminos: '1.0' }
    });

  } catch (error) {
    logger.error(`Error en registro: ${error.message}`);
    if (error.code === '23505')
      return res.status(400).json({ message: "El correo ya esta registrado." });
    res.status(500).json({ message: "Error al registrar usuario." });
  }
};

// =========================================================
// VERIFICAR CODIGO DE EMAIL
// =========================================================
export const verifyEmail = async (req, res) => {
  try {
    let { correo, codigo } = req.body;

    if (!correo || !codigo)
      return res.status(400).json({ message: "Correo y codigo son obligatorios" });

    correo = sanitizeEmail(correo);
    codigo = codigo.trim();

    if (!/^\d{6}$/.test(codigo))
      return res.status(400).json({ message: "Codigo invalido. Debe ser de 6 digitos" });

    const result = await pool.query(`
      SELECT u.id_usuario, u.nombre_completo, c2fa.codigo, c2fa.fecha_expiracion
      FROM usuarios u
      INNER JOIN codigos_2fa_email c2fa ON u.id_usuario = c2fa.id_usuario
      WHERE u.correo = $1 AND u.estado = $2 AND c2fa.usado = FALSE
      ORDER BY c2fa.fecha_creacion DESC LIMIT 1
    `, [correo, 'pendiente']);

    if (result.rows.length === 0)
      return res.status(404).json({ message: "Usuario no encontrado o ya verificado" });

    const user = result.rows[0];

    if (user.codigo !== codigo) {
      logger.warn(`Codigo de verificacion incorrecto: usuario ${user.id_usuario}`);
      return res.status(401).json({ message: "Codigo de verificacion incorrecto" });
    }

    if (new Date() > new Date(user.fecha_expiracion)) {
      logger.warn(`Codigo de verificacion expirado: usuario ${user.id_usuario}`);
      return res.status(401).json({ message: "El codigo ha expirado. Solicita uno nuevo." });
    }

    await pool.query(`UPDATE usuarios SET estado = $1 WHERE id_usuario = $2`, ['activo', user.id_usuario]);
    await pool.query(`UPDATE codigos_2fa_email SET usado = TRUE WHERE id_usuario = $1`, [user.id_usuario]);

    logger.info(`Cuenta verificada: usuario ${user.id_usuario}`);

    const { sendWelcomeEmail } = await import('../services/emailService.js');
    sendWelcomeEmail(correo, user.nombre_completo)
      .then(() => logger.info(`Email de bienvenida enviado: usuario ${user.id_usuario}`))
      .catch((err) => logger.error(`Error enviando email de bienvenida: ${err.message}`));

    res.json({ message: "Cuenta verificada exitosamente. Ya puedes iniciar sesion.", verified: true });

  } catch (error) {
    logger.error(`Error en verificacion: ${error.message}`);
    res.status(500).json({ message: "Error al verificar cuenta" });
  }
};

// =========================================================
// REENVIAR CODIGO DE VERIFICACION
// =========================================================
export const resendVerificationCode = async (req, res) => {
  try {
    let { correo } = req.body;

    if (!correo)
      return res.status(400).json({ message: "El correo es obligatorio" });

    correo = sanitizeEmail(correo);

    const result = await pool.query(
      `SELECT id_usuario, nombre_completo FROM usuarios WHERE correo = $1 AND estado = $2 LIMIT 1`,
      [correo, 'pendiente']
    );

    if (result.rows.length === 0)
      return res.status(404).json({ message: "Usuario no encontrado o ya verificado" });

    const user = result.rows[0];
    const nuevoCodigoVerificacion = generateVerificationCode();

    await pool.query(`UPDATE codigos_2fa_email SET usado = TRUE WHERE id_usuario = $1`, [user.id_usuario]);
    await pool.query(
      `INSERT INTO codigos_2fa_email (id_usuario, codigo, fecha_expiracion) VALUES ($1, $2, NOW() + INTERVAL '24 hours')`,
      [user.id_usuario, nuevoCodigoVerificacion]
    );

    const { sendVerificationEmail } = await import('../services/emailService.js');
    await sendVerificationEmail(correo, user.nombre_completo, nuevoCodigoVerificacion);

    logger.info(`Codigo reenviado: usuario ${user.id_usuario}`);
    res.json({ message: "Codigo reenviado exitosamente" });

  } catch (error) {
    logger.error(`Error reenviando codigo: ${error.message}`);
    res.status(500).json({ message: "Error al reenviar codigo" });
  }
};