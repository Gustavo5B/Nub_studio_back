import { pool, pools } from "../config/db.js";
import { generateCode, sendGmail2FACode } from "../services/emailService.js";
import logger from "../config/logger.js";

// =========================================================
// HELPERS
// =========================================================
const sanitizeEmail = (email) => {
  if (!email || typeof email !== 'string') return '';
  return email.trim().toLowerCase().replace(/[<>"'`\\]/g, '').substring(0, 255);
};

const isValidEmail = (email) => {
  const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email) && email.length <= 255;
};

const sanitizeCode = (codigo) => {
  if (!codigo || typeof codigo !== 'string') return '';
  return codigo.trim().toUpperCase().substring(0, 9);
};

const isValidCode = (codigo) => {
  return /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(codigo);
};

const maskEmail = (email) => {
  if (!email) return 'correo oculto';
  const [localPart, domain] = email.split('@');
  if (!domain) return '***@***';
  const maskedLocal = localPart.length > 4
    ? localPart.substring(0, 2) + '***' + localPart.substring(localPart.length - 2)
    : '***';
  const domainParts = domain.split('.');
  const maskedDomain = domainParts.length > 1
    ? domainParts[0].substring(0, 1) + '***.' + domainParts.slice(1).join('.')
    : '***';
  return `${maskedLocal}@${maskedDomain}`;
};

// =========================================================
// 1. CONFIGURAR GMAIL-2FA
// pool base — no hay sesión todavía
// =========================================================
export const configurarGmail2FA = async (req, res) => {
  try {
    let { correo } = req.body;

    if (!correo)
      return res.status(400).json({ success: false, message: "Correo requerido" });

    correo = sanitizeEmail(correo);

    if (!isValidEmail(correo))
      return res.status(400).json({ success: false, message: "Formato de correo invalido" });

    logger.info(`Configurando Gmail-2FA: ${maskEmail(correo)}`);

    const code = generateCode();

    try {
      const result = await pool.query(
        `UPDATE usuarios SET secret_2fa = $1 WHERE correo = $2`,
        [code, correo]
      );
      if (result.rowCount === 0) {
        logger.warn(`Gmail-2FA: usuario no encontrado ${maskEmail(correo)}`);
        return res.status(404).json({ success: false, message: "Usuario no encontrado" });
      }
    } catch (dbError) {
      logger.error(`Error al guardar codigo en BD: ${dbError.message}`);
      return res.status(500).json({ success: false, message: "Error al procesar la solicitud" });
    }

    try {
      await sendGmail2FACode(correo, code);
      logger.info(`Email 2FA enviado: ${maskEmail(correo)}`);
    } catch (emailError) {
      logger.error(`Error al enviar email 2FA: ${emailError.message}`);
      await pool.query(`UPDATE usuarios SET secret_2fa = NULL WHERE correo = $1`, [correo]);
      return res.status(500).json({ success: false, message: "No se pudo enviar el email. Verifica tu correo e intenta de nuevo." });
    }

    res.json({ success: true, message: "Codigo de verificacion enviado a tu correo.", email: maskEmail(correo) });

  } catch (error) {
    logger.error(`Error en configurarGmail2FA: ${error.message}`);
    res.status(500).json({ success: false, message: "Error interno del servidor." });
  }
};

// =========================================================
// 2. VERIFICAR CODIGO Y ACTIVAR GMAIL-2FA
// pool base — no hay sesión todavía
// =========================================================
export const verificarGmail2FA = async (req, res) => {
  try {
    let { correo, codigo } = req.body;

    if (!correo || !codigo)
      return res.status(400).json({ success: false, message: "Correo y codigo son requeridos" });

    correo = sanitizeEmail(correo);
    codigo = sanitizeCode(codigo);

    if (!isValidEmail(correo))
      return res.status(400).json({ success: false, message: "Formato de correo invalido" });

    if (!isValidCode(codigo))
      return res.status(400).json({ success: false, message: "El codigo debe tener formato XXXX-XXXX" });

    const result = await pool.query(
      `SELECT id_usuario FROM usuarios WHERE correo = $1 AND secret_2fa = $2`,
      [correo, codigo]
    );

    if (result.rows.length === 0) {
      logger.warn(`Gmail-2FA codigo invalido: ${maskEmail(correo)}`);
      return res.status(401).json({ success: false, message: "Codigo invalido o expirado" });
    }

    const userId = result.rows[0].id_usuario;

    await pool.query(
      `UPDATE usuarios SET requiere_2fa = TRUE, secret_2fa = NULL WHERE correo = $1`,
      [correo]
    );

    logger.info(`Gmail-2FA activado: usuario ${userId}`);
    res.json({ success: true, message: "Gmail-2FA activado correctamente" });

  } catch (error) {
    logger.error(`Error en verificarGmail2FA: ${error.message}`);
    res.status(500).json({ success: false, message: "Error interno del servidor." });
  }
};

// =========================================================
// 3. ENVIAR CODIGO AL INICIAR SESION
// pool base — no hay sesión todavía
// =========================================================
export const enviarCodigoLoginGmail = async (req, res) => {
  try {
    let { correo } = req.body;

    if (!correo)
      return res.status(400).json({ success: false, message: "Correo requerido" });

    correo = sanitizeEmail(correo);

    if (!isValidEmail(correo))
      return res.status(400).json({ success: false, message: "Formato de correo invalido" });

    const userCheck = await pool.query(
      `SELECT id_usuario FROM usuarios WHERE correo = $1 AND requiere_2fa = TRUE`,
      [correo]
    );

    if (userCheck.rows.length === 0) {
      logger.warn(`Gmail-2FA login: usuario no encontrado ${maskEmail(correo)}`);
      return res.status(404).json({ success: false, message: "Usuario no encontrado o Gmail-2FA no esta activo" });
    }

    const code = generateCode();

    await pool.query(`UPDATE usuarios SET secret_2fa = $1 WHERE correo = $2`, [code, correo]);

    try {
      await sendGmail2FACode(correo, code);
    } catch (emailError) {
      logger.error(`Error al enviar email de login: ${emailError.message}`);
      await pool.query(`UPDATE usuarios SET secret_2fa = NULL WHERE correo = $1`, [correo]);
      return res.status(500).json({ success: false, message: "No se pudo enviar el codigo. Intenta de nuevo." });
    }

    logger.info(`Gmail-2FA login codigo enviado: usuario ${userCheck.rows[0].id_usuario}`);
    res.json({ success: true, message: "Codigo de acceso enviado a tu correo.", email: maskEmail(correo) });

  } catch (error) {
    logger.error(`Error en enviarCodigoLoginGmail: ${error.message}`);
    res.status(500).json({ success: false, message: "Error interno del servidor." });
  }
};

// =========================================================
// 4. VERIFICAR CODIGO DURANTE LOGIN
// pool base — no hay sesión todavía
// =========================================================
export const verificarCodigoLoginGmail = async (req, res) => {
  try {
    let { correo, codigo } = req.body;

    if (!correo || !codigo)
      return res.status(400).json({ success: false, message: "Correo y codigo son requeridos" });

    correo = sanitizeEmail(correo);
    codigo = sanitizeCode(codigo);

    if (!isValidEmail(correo))
      return res.status(400).json({ success: false, message: "Formato de correo invalido" });

    if (!isValidCode(codigo))
      return res.status(400).json({ success: false, message: "El codigo debe tener formato XXXX-XXXX" });

    const result = await pool.query(
      `SELECT id_usuario, nombre_completo, correo, estado FROM usuarios WHERE correo = $1 AND secret_2fa = $2`,
      [correo, codigo]
    );

    if (result.rows.length === 0) {
      logger.warn(`Gmail-2FA login codigo invalido: ${maskEmail(correo)}`);
      return res.status(401).json({ success: false, message: "Codigo invalido o expirado" });
    }

    const user = result.rows[0];

    if (user.estado !== 'activo') {
      logger.warn(`Gmail-2FA login cuenta inactiva: usuario ${user.id_usuario}`);
      return res.status(403).json({ success: false, message: "La cuenta no esta activa" });
    }

    await pool.query(`UPDATE usuarios SET secret_2fa = NULL WHERE id_usuario = $1`, [user.id_usuario]);

    const jwt = (await import("jsonwebtoken")).default;
    const crypto = (await import("crypto")).default;

    const token = jwt.sign(
      { sub: user.id_usuario.toString(), jti: crypto.randomUUID() },
      process.env.JWT_SECRET,
      { algorithm: 'HS256', expiresIn: "24h", issuer: 'nub-studio', audience: 'nub-users' }
    );

    try {
      const { saveActiveSession } = await import('../services/sessionService.js');
      await saveActiveSession(user.id_usuario, token, req);
    } catch (sessionError) {
      logger.error(`Error al guardar sesion: ${sessionError.message}`);
    }

    logger.info(`Gmail-2FA login exitoso: usuario ${user.id_usuario}`);

    res.json({
      success: true,
      message: "Inicio de sesion exitoso",
      access_token: token,
      token_type: "bearer",
      usuario: { id: user.id_usuario, nombre: user.nombre_completo, correo: user.correo }
    });

  } catch (error) {
    logger.error(`Error en verificarCodigoLoginGmail: ${error.message}`);
    res.status(500).json({ success: false, message: "Error interno del servidor." });
  }
};

// =========================================================
// 5. DESACTIVAR GMAIL-2FA — sí tiene req.user
// =========================================================
export const desactivarGmail2FA = async (req, res) => {
  try {
    const db = pools[req.user.rol] || pool;
    const userId = req.user?.id_usuario;

    if (!userId)
      return res.status(401).json({ success: false, message: "No autorizado" });

    const result = await db.query(
      `UPDATE usuarios SET requiere_2fa = FALSE, secret_2fa = NULL WHERE id_usuario = $1`,
      [userId]
    );

    if (result.rowCount === 0)
      return res.status(404).json({ success: false, message: "Usuario no encontrado" });

    logger.info(`Gmail-2FA desactivado: usuario ${userId}`);
    res.json({ success: true, message: "Gmail-2FA desactivado correctamente" });

  } catch (error) {
    logger.error(`Error en desactivarGmail2FA: ${error.message}`);
    res.status(500).json({ success: false, message: "Error interno del servidor." });
  }
};

// =========================================================
// 6. VERIFICAR ESTADO DE GMAIL-2FA — sí tiene req.user
// =========================================================
export const estadoGmail2FA = async (req, res) => {
  try {
    const db = pools[req.user.rol] || pool;
    const userId = req.user?.id_usuario;

    if (!userId)
      return res.status(401).json({ success: false, message: "No autorizado" });

    const result = await db.query(
      `SELECT requiere_2fa FROM usuarios WHERE id_usuario = $1`,
      [userId]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ success: false, message: "Usuario no encontrado" });

    res.json({ success: true, gmail2faActivo: result.rows[0].requiere_2fa === true });

  } catch (error) {
    logger.error(`Error en estadoGmail2FA: ${error.message}`);
    res.status(500).json({ success: false, message: "Error interno del servidor." });
  }
};