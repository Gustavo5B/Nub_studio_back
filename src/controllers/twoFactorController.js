import speakeasy from "speakeasy";
import QRCode from "qrcode";
import { pool } from "../config/db.js";
import logger from "../config/logger.js";

// =========================================================
// GENERAR SECRETO Y QR PARA TOTP
// =========================================================
export const setupTOTP = async (req, res) => {
  try {
    const { correo } = req.body;

    if (!correo)
      return res.status(400).json({ message: "Correo requerido" });

    const secret = speakeasy.generateSecret({
      name: `NU-B Studio (${correo})`,
      length: 32,
    });

    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

    await pool.query(
      `UPDATE usuarios SET secret_2fa = $1, requiere_2fa = FALSE WHERE correo = $2`,
      [secret.base32, correo]
    );

    logger.info(`TOTP generado: ${correo}`);
    res.json({ message: "TOTP generado correctamente", secret: secret.base32, qrCode: qrCodeUrl });

  } catch (error) {
    logger.error(`Error en setupTOTP: ${error.message}`);
    res.status(500).json({ message: "Error al configurar TOTP" });
  }
};

// =========================================================
// VERIFICAR CODIGO TOTP Y ACTIVAR 2FA
// =========================================================
export const verifyTOTP = async (req, res) => {
  try {
    const { correo, token } = req.body;

    if (!correo || !token)
      return res.status(400).json({ message: "Correo y codigo requeridos" });

    const result = await pool.query(
      "SELECT id_usuario, secret_2fa FROM usuarios WHERE correo = $1 LIMIT 1",
      [correo]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ message: "Usuario no encontrado" });

    const user = result.rows[0];

    const verified = speakeasy.totp.verify({
      secret: user.secret_2fa,
      encoding: "base32",
      token,
      window: 2,
    });

    if (verified) {
      await pool.query(
        `UPDATE usuarios SET requiere_2fa = TRUE, metodo_2fa = 'TOTP' WHERE correo = $1`,
        [correo]
      );
      logger.info(`TOTP activado: usuario ${user.id_usuario}`);
      res.json({ message: "TOTP verificado y activado correctamente" });
    } else {
      logger.warn(`TOTP codigo incorrecto: usuario ${user.id_usuario}`);
      res.status(401).json({ message: "Codigo TOTP incorrecto" });
    }

  } catch (error) {
    logger.error(`Error en verifyTOTP: ${error.message}`);
    res.status(500).json({ message: "Error al verificar TOTP" });
  }
};

// =========================================================
// VALIDAR TOTP DURANTE LOGIN
// =========================================================
export const validateTOTP = async (req, res) => {
  try {
    const { correo, token } = req.body;

    if (!correo || !token)
      return res.status(400).json({ message: "Correo y codigo requeridos" });

    const result = await pool.query(
      "SELECT id_usuario, secret_2fa FROM usuarios WHERE correo = $1 LIMIT 1",
      [correo]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ message: "Usuario no encontrado" });

    const user = result.rows[0];

    const verified = speakeasy.totp.verify({
      secret: user.secret_2fa,
      encoding: "base32",
      token,
      window: 2,
    });

    if (verified) {
      logger.info(`TOTP validacion exitosa: usuario ${user.id_usuario}`);
      res.json({ valid: true, message: "Codigo valido" });
    } else {
      logger.warn(`TOTP validacion fallida: usuario ${user.id_usuario}`);
      res.status(401).json({ valid: false, message: "Codigo incorrecto" });
    }

  } catch (error) {
    logger.error(`Error en validateTOTP: ${error.message}`);
    res.status(500).json({ message: "Error al validar TOTP" });
  }
};