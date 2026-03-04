import bcrypt from "bcrypt";
import dotenv from "dotenv";
import { pool } from "../config/db.js";
import { generateCode, sendRecoveryCode } from "../services/emailService.js";
import logger from "../config/logger.js";

dotenv.config();

// =========================================================
// HELPERS DE SANITIZACION
// =========================================================
const sanitizeEmail = (email) => {
  if (!email || typeof email !== "string") return "";
  return email
    .trim()
    .toLowerCase()
    .replace(/[<>"'`\\]/g, "")
    .substring(0, 255);
};

const isValidEmail = (email) => {
  const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email) && email.length <= 255;
};

const sanitizeCode = (codigo) => {
  if (!codigo || typeof codigo !== "string") return "";
  return codigo
    .trim()
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .substring(0, 6);
};

const isValidCode = (codigo) => /^[A-Z0-9]{6}$/.test(codigo);

const sanitizePassword = (password) => {
  if (!password || typeof password !== "string")
    throw new Error("Contrasena requerida");

  const maliciousPatterns = [
    /<script/i,
    /<\/script/i,
    /javascript:/i,
    /onerror=/i,
    /onclick=/i,
    /<iframe/i,
    /eval\(/i,
    /alert\(/i,
    /onload=/i,
    /<img/i,
    /on\w+\s*=/i,
    /data:/i,
    /vbscript:/i,
    /expression\(/i,
    /url\(/i,
  ];

  for (const pattern of maliciousPatterns) {
    if (pattern.test(password))
      throw new Error("La contrasena contiene caracteres no permitidos");
  }

  return password.trim();
};

const validatePasswordStrength = (password) => {
  const errors = [];

  if (password.length < 8) errors.push("Debe tener al menos 8 caracteres");
  if (password.length > 128)
    errors.push("La contrasena es demasiado larga (maximo 128 caracteres)");
  if (!/[A-Z]/.test(password))
    errors.push("Debe contener al menos una mayuscula");
  if (!/[a-z]/.test(password))
    errors.push("Debe contener al menos una minuscula");
  if (!/[0-9]/.test(password)) errors.push("Debe contener al menos un numero");
  if (!/[@$!%*?&#._-]/.test(password))
    errors.push("Debe contener al menos un caracter especial (@$!%*?&#._-)");

  const commonPasswords = [
    "12345678",
    "password",
    "qwerty123",
    "123456789",
    "abc12345",
    "password123",
    "11111111",
    "qwertyuiop",
    "admin123",
    "letmein123",
    "welcome1",
    "monkey123",
    "dragon123",
    "master123",
    "login123",
    "princess1",
    "sunshine1",
    "football1",
    "iloveyou1",
    "trustno1",
    "password1",
    "superman1",
    "michael1",
    "shadow123",
    "charlie1",
  ];

  if (commonPasswords.includes(password.toLowerCase()))
    errors.push("Contrasena demasiado comun. Elige una mas segura");

  if (/(.)\1{3,}/.test(password))
    errors.push(
      "La contrasena no puede tener mas de 3 caracteres repetidos consecutivos",
    );

  if (/(?:012|123|234|345|456|567|678|789|890){2,}/.test(password))
    errors.push("La contrasena no puede contener secuencias numericas obvias");

  return errors;
};

const maskEmail = (email) => {
  if (!email) return "correo oculto";
  const [localPart, domain] = email.split("@");
  if (!domain) return "***@***";
  const maskedLocal =
    localPart.length > 4
      ? localPart.substring(0, 2) +
        "***" +
        localPart.substring(localPart.length - 2)
      : "***";
  const domainParts = domain.split(".");
  const maskedDomain =
    domainParts.length > 1
      ? domainParts[0].substring(0, 1) + "***." + domainParts.slice(1).join(".")
      : "***";
  return `${maskedLocal}@${maskedDomain}`;
};

const calcularTiempoBloqueoRecuperacion = (bloqueosTotales) => {
  if (bloqueosTotales === 0) return 15;
  if (bloqueosTotales === 1) return 30;
  if (bloqueosTotales === 2) return 60;
  return 120;
};

// =========================================================
// SOLICITAR CODIGO DE RECUPERACION
// =========================================================
export const requestRecoveryCode = async (req, res) => {
  const client = await pool.connect();

  try {
    let { correo } = req.body;

    if (!correo)
      return res.status(400).json({ message: "El correo es obligatorio" });

    correo = sanitizeEmail(correo);

    if (!isValidEmail(correo))
      return res.status(400).json({ message: "Formato de correo invalido" });

    logger.info(`Solicitud de recuperacion: ${maskEmail(correo)}`);

    const userResult = await client.query(
      "SELECT * FROM usuarios WHERE correo = $1",
      [correo],
    );

    if (userResult.rows.length === 0) {
      logger.warn(`Recuperacion: correo no encontrado ${maskEmail(correo)}`);
      return res.json({
        message: "Si el correo existe, recibiras un codigo de recuperacion",
        correo: maskEmail(correo),
      });
    }

    const user = userResult.rows[0];

    if (user.bloqueado_recuperacion_hasta) {
      const ahora = new Date();
      const desbloqueo = new Date(user.bloqueado_recuperacion_hasta);

      if (ahora < desbloqueo) {
        const minutosRestantes = Math.ceil((desbloqueo - ahora) / 60000);
        const horaDesbloqueo = desbloqueo.toLocaleTimeString("es-MX", {
          hour: "2-digit",
          minute: "2-digit",
        });

        logger.warn(
          `Recuperacion bloqueada: usuario ${user.id_usuario}, ${minutosRestantes} min restantes`,
        );

        return res.status(429).json({
          blocked: true,
          message: `Demasiados intentos de recuperacion. Por favor espera ${minutosRestantes} minuto${minutosRestantes > 1 ? "s" : ""} antes de intentar de nuevo.`,
          minutesRemaining: minutosRestantes,
          unlockTime: horaDesbloqueo,
        });
      } else {
        logger.info(`Desbloqueando recuperacion: usuario ${user.id_usuario}`);
        await client.query(
          `UPDATE usuarios SET bloqueado_recuperacion_hasta = NULL WHERE id_usuario = $1`,
          [user.id_usuario],
        );
        user.bloqueado_recuperacion_hasta = null;
      }
    }

    const codigo = generateCode();

    await client.query(
      `INSERT INTO codigos_recuperacion (id_usuario, codigo, fecha_expiracion)
       VALUES ($1, $2, NOW() + INTERVAL '15 minutes')`,
      [user.id_usuario, codigo],
    );

    try {
      await sendRecoveryCode(correo, codigo);
      logger.info(`Codigo de recuperacion enviado: usuario ${user.id_usuario}`);
    } catch (emailError) {
      logger.error(
        `Error al enviar email de recuperacion: ${emailError.message}`,
      );
    }

    res.json({
      message: "Si el correo existe, recibiras un codigo de recuperacion",
      correo: maskEmail(correo),
    });
  } catch (error) {
    logger.error(`Error en requestRecoveryCode: ${error.message}`);
    res.status(500).json({ message: "Error interno del servidor" });
  } finally {
    client.release();
  }
};

// =========================================================
// VALIDAR CODIGO DE RECUPERACION
// =========================================================
export const validateRecoveryCode = async (req, res) => {
  try {
    let { correo, codigo } = req.body;

    if (!correo || !codigo)
      return res
        .status(400)
        .json({ message: "Correo y codigo son obligatorios" });

    correo = sanitizeEmail(correo);
    codigo = sanitizeCode(codigo);

    if (!isValidEmail(correo))
      return res.status(400).json({ message: "Formato de correo invalido" });

    if (!isValidCode(codigo))
      return res
        .status(400)
        .json({ message: "El codigo debe ser de 6 digitos" });

    const result = await pool.query(
      `SELECT cr.* FROM codigos_recuperacion cr
       INNER JOIN usuarios u ON cr.id_usuario = u.id_usuario
       WHERE u.correo = $1 AND cr.codigo = $2 AND cr.usado = FALSE AND cr.fecha_expiracion > NOW()
       ORDER BY cr.fecha_creacion DESC LIMIT 1`,
      [correo, codigo],
    );

    if (result.rows.length === 0) {
      logger.warn(`Codigo de recuperacion invalido: ${maskEmail(correo)}`);
      return res
        .status(401)
        .json({ valid: false, message: "Codigo invalido o expirado" });
    }

    logger.info(`Codigo de recuperacion valido: ${maskEmail(correo)}`);
    res.json({ valid: true, message: "Codigo valido" });
  } catch (error) {
    logger.error(`Error en validateRecoveryCode: ${error.message}`);
    res.status(500).json({ message: "Error interno del servidor" });
  }
};

// =========================================================
// RESTABLECER CONTRASENA
// =========================================================
export const resetPassword = async (req, res) => {
  const client = await pool.connect();

  try {
    let { correo, codigo, nuevaContrasena } = req.body;

    if (!correo || !codigo || !nuevaContrasena)
      return res
        .status(400)
        .json({ message: "Todos los campos son obligatorios" });

    correo = sanitizeEmail(correo);
    if (!isValidEmail(correo))
      return res.status(400).json({ message: "Formato de correo invalido" });

    codigo = sanitizeCode(codigo);
    if (!isValidCode(codigo))
      return res
        .status(400)
        .json({ message: "El codigo debe ser de 6 digitos" });

    try {
      nuevaContrasena = sanitizePassword(nuevaContrasena);
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }

    const passwordErrors = validatePasswordStrength(nuevaContrasena);
    if (passwordErrors.length > 0)
      return res
        .status(400)
        .json({ message: "Contrasena insegura", errors: passwordErrors });

    logger.info(`Restableciendo contrasena: ${maskEmail(correo)}`);

    await client.query("BEGIN");

    const codeResult = await client.query(
      `SELECT cr.*, u.id_usuario, u.contraseña_hash FROM codigos_recuperacion cr
       INNER JOIN usuarios u ON cr.id_usuario = u.id_usuario
       WHERE u.correo = $1 AND cr.codigo = $2 AND cr.usado = FALSE AND cr.fecha_expiracion > NOW()
       ORDER BY cr.fecha_creacion DESC LIMIT 1`,
      [correo, codigo],
    );

    if (codeResult.rows.length === 0) {
      await client.query("ROLLBACK");
      logger.warn(`Reset password codigo invalido: ${maskEmail(correo)}`);
      return res.status(401).json({ message: "Codigo invalido o expirado" });
    }

    const user = codeResult.rows[0];

    const isSamePassword = await bcrypt.compare(
      nuevaContrasena,
      user.contraseña_hash,
    );
    if (isSamePassword) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({
          message: "La nueva contrasena no puede ser igual a la anterior",
        });
    }

    const hashedPassword = await bcrypt.hash(nuevaContrasena, 12);

    await client.query(
      "UPDATE usuarios SET contraseña_hash = $1 WHERE id_usuario = $2",
      [hashedPassword, user.id_usuario],
    );

    await client.query(
      "UPDATE codigos_recuperacion SET usado = TRUE WHERE id_usuario = $1",
      [user.id_usuario],
    );

    await client.query(
      `UPDATE usuarios SET bloqueado_recuperacion_hasta = NULL, intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id_usuario = $1`,
      [user.id_usuario],
    );

    await client.query("COMMIT");

    logger.info(`Contrasena restablecida: usuario ${user.id_usuario}`);
    res.json({ message: "Contrasena actualizada exitosamente", success: true });
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error(`Error en resetPassword: ${error.message}`);
    res.status(500).json({ message: "Error interno del servidor" });
  } finally {
    client.release();
  }
};

// =========================================================
// LIMPIEZA PERIODICA DE CODIGOS EXPIRADOS
// =========================================================
export const cleanupExpiredCodes = async () => {
  try {
    const result = await pool.query(
      "DELETE FROM codigos_recuperacion WHERE fecha_expiracion < NOW() OR usado = TRUE",
    );
    logger.info(`Codigos expirados eliminados: ${result.rowCount}`);
  } catch (error) {
    logger.error(`Error al limpiar codigos: ${error.message}`);
  }
};
