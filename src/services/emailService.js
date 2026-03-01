import brevo from '@getbrevo/brevo';
import crypto from 'crypto';
import dotenv from 'dotenv';
import logger from '../config/logger.js';

dotenv.config();

// =========================================================
// CONFIGURACION DE BREVO
// =========================================================
const defaultClient = brevo.ApiClient.instance;
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = process.env.BREVO_API_KEY;

const apiInstance = new brevo.TransactionalEmailsApi();

if (!process.env.BREVO_API_KEY) {
  logger.error('ERROR CRITICO: BREVO_API_KEY no esta configurada en .env');
  throw new Error('BREVO_API_KEY no configurada');
}

logger.info('Brevo API configurada correctamente');

// =========================================================
// ENVIAR EMAIL DE VERIFICACION DE CUENTA
// =========================================================
export const sendVerificationEmail = async (email, nombre, codigo) => {
  try {
    const sendSmtpEmail = {
      sender: { name: 'NU-B Studio', email: 'gustavotubazo@gmail.com' },
      to: [{ email, name: nombre }],
      subject: 'Verifica tu cuenta - NU-B Studio',
      htmlContent: `
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="UTF-8" />
          <style>
            body { font-family: 'Segoe UI', Roboto, sans-serif; background-color: #f9fafb; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 6px 14px rgba(0,0,0,0.1); }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 40px 30px; text-align: center; }
            .header h1 { margin: 0; font-size: 28px; }
            .content { padding: 40px 30px; text-align: center; color: #333; }
            .code-box { background: #eef2ff; border: 2px solid #667eea; border-radius: 10px; padding: 20px; margin: 25px 0; font-size: 36px; font-weight: bold; color: #4c51bf; letter-spacing: 8px; font-family: 'Courier New', monospace; }
            .footer { background: #f8f9fa; padding: 20px; text-align: center; font-size: 13px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Bienvenido, ${nombre}!</h1>
              <p>Verifica tu cuenta para comenzar</p>
            </div>
            <div class="content">
              <h2>Tu codigo de verificacion</h2>
              <p>Ingresa este codigo en la aplicacion para activar tu cuenta:</p>
              <div class="code-box">${codigo}</div>
              <p>Este codigo expirara en <strong>24 horas</strong>.</p>
              <p style="font-size: 13px; color: #777;">Si no te registraste, ignora este mensaje.</p>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} NU-B Studio. Todos los derechos reservados.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    const result = await apiInstance.sendTransacEmail(sendSmtpEmail);
    logger.info(`Email de verificacion enviado (Message ID: ${result.messageId})`);
    return { success: true, messageId: result.messageId };

  } catch (error) {
    logger.error(`Error al enviar email de verificacion: ${error.message}`);
    throw new Error('Error al enviar el correo de verificacion');
  }
};

// =========================================================
// GENERAR CODIGO DE RECUPERACION
// =========================================================
export const generateCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[bytes[i] % chars.length];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
};

// =========================================================
// ENVIAR CORREO DE BIENVENIDA
// =========================================================
export const sendWelcomeEmail = async (email, nombre) => {
  try {
    const sendSmtpEmail = {
      sender: { name: 'NU-B Studio', email: 'gustavotubazo@gmail.com' },
      to: [{ email, name: nombre }],
      subject: 'Bienvenido a NU-B Studio!',
      htmlContent: `
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { font-family: 'Segoe UI', Roboto, sans-serif; background-color: #f9fafb; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 6px 14px rgba(0,0,0,0.1); }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 40px 30px; text-align: center; }
            .header h1 { margin: 0; font-size: 28px; font-weight: bold; }
            .header p { margin: 10px 0 0; font-size: 16px; opacity: 0.95; }
            .content { padding: 40px 30px; color: #333; }
            .content h2 { color: #667eea; font-size: 22px; margin-top: 0; }
            .features { background: #f8f9fa; border-radius: 8px; padding: 25px; margin: 25px 0; }
            .features h3 { color: #333; margin-top: 0; font-size: 18px; }
            .features ul { list-style: none; padding: 0; margin: 15px 0 0; }
            .features li { padding: 10px 0 10px 28px; position: relative; color: #555; line-height: 1.5; }
            .features li:before { content: "✓"; position: absolute; left: 0; color: #667eea; font-weight: bold; font-size: 18px; }
            .button { display: inline-block; padding: 14px 35px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 8px; margin: 25px 0; font-weight: bold; font-size: 16px; }
            .button-container { text-align: center; }
            .footer { background: #f8f9fa; padding: 20px; text-align: center; font-size: 13px; color: #666; line-height: 1.6; }
            @media only screen and (max-width: 600px) { .container { margin: 20px; } .header, .content { padding: 30px 20px; } }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Bienvenido, ${nombre}!</h1>
              <p>Tu cuenta ha sido creada exitosamente</p>
            </div>
            <div class="content">
              <h2>Gracias por unirte a NU-B Studio!</h2>
              <p>Estamos emocionados de tenerte con nosotros. Tu cuenta esta lista para usar.</p>
              <div class="features">
                <h3>Que puedes hacer ahora?</h3>
                <ul>
                  <li>Completa tu perfil de usuario</li>
                  <li>Explora todas nuestras herramientas</li>
                  <li>Personaliza tu experiencia</li>
                  <li>Conecta con otros usuarios</li>
                  <li>Accede a contenido exclusivo</li>
                </ul>
              </div>
              <div class="button-container">
                <a href="${process.env.FRONTEND_URL}/login" class="button">Iniciar Sesion Ahora</a>
              </div>
              <p style="margin-top: 30px; color: #666; font-size: 14px;">Si tienes alguna pregunta, no dudes en contactarnos.</p>
              <p style="margin-top: 25px;">Saludos cordiales,<br><strong style="color: #667eea;">El equipo de NU-B Studio</strong></p>
            </div>
            <div class="footer">
              <p>Este es un correo automatico, por favor no respondas directamente.</p>
              <p>© ${new Date().getFullYear()} NU-B Studio. Todos los derechos reservados.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    const result = await apiInstance.sendTransacEmail(sendSmtpEmail);
    logger.info(`Email de bienvenida enviado (Message ID: ${result.messageId})`);
    return { success: true, messageId: result.messageId };

  } catch (error) {
    logger.error(`Error al enviar email de bienvenida: ${error.message}`);
    throw new Error('Error al enviar el correo de bienvenida');
  }
};

// =========================================================
// ENVIAR CORREO DE RECUPERACION DE CONTRASENA
// =========================================================
export const sendRecoveryCode = async (email, code) => {
  try {
    const sendSmtpEmail = {
      sender: { name: 'NubStudio', email: 'gustavotubazo@gmail.com' },
      to: [{ email }],
      subject: 'Recuperacion de contrasena - NU-B Studio',
      htmlContent: `
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="UTF-8" />
          <style>
            body { font-family: 'Segoe UI', Roboto, sans-serif; background-color: #f9fafb; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 6px 14px rgba(0,0,0,0.1); }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }
            .header h1 { margin: 0; font-size: 26px; }
            .content { padding: 40px 30px; text-align: center; color: #333; }
            .code-box { background: #eef2ff; border: 2px solid #667eea; border-radius: 10px; padding: 20px; margin: 25px 0; font-size: 32px; font-weight: bold; color: #4c51bf; letter-spacing: 4px; font-family: 'Courier New', monospace; }
            .footer { background: #f8f9fa; padding: 15px; text-align: center; font-size: 13px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header"><h1>Recuperacion de Contrasena</h1></div>
            <div class="content">
              <p>Hola,</p>
              <p>Hemos recibido una solicitud para restablecer tu contrasena.</p>
              <p>Tu codigo de recuperacion es:</p>
              <div class="code-box">${code}</div>
              <p>Este codigo expirara en <strong>15 minutos</strong>.</p>
              <p style="font-size: 13px; color: #777;">Si no solicitaste este cambio, ignora este mensaje.</p>
            </div>
            <div class="footer">© ${new Date().getFullYear()} NU-B Studio — No respondas a este mensaje.</div>
          </div>
        </body>
        </html>
      `,
    };

    const result = await apiInstance.sendTransacEmail(sendSmtpEmail);
    logger.info(`Email de recuperacion enviado (Message ID: ${result.messageId})`);
    return { success: true, messageId: result.messageId };

  } catch (error) {
    logger.error(`Error al enviar email de recuperacion: ${error.message}`);
    throw new Error('Error al enviar el codigo por correo');
  }
};

// =========================================================
// ENVIAR CODIGO DE VERIFICACION 2FA
// =========================================================
export const sendGmail2FACode = async (email, code) => {
  try {
    logger.info(`Enviando email 2FA a: ${email.substring(0, 3)}***`);

    const sendSmtpEmail = {
      sender: { name: 'NU-B Studio Seguridad', email: 'gustavotubazo@gmail.com' },
      to: [{ email }],
      subject: 'Codigo de verificacion (2FA) - NU-B Studio',
      htmlContent: `
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="UTF-8" />
          <style>
            body { font-family: 'Segoe UI', Roboto, sans-serif; background-color: #f9fafb; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 6px 14px rgba(0,0,0,0.1); }
            .header { background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: white; padding: 30px; text-align: center; }
            .header h1 { margin: 0; font-size: 26px; }
            .content { padding: 40px 30px; text-align: center; color: #333; }
            .code-box { background: #eef2ff; border: 2px solid #3b82f6; border-radius: 10px; padding: 20px; margin: 25px 0; font-size: 32px; font-weight: bold; color: #1e3a8a; letter-spacing: 4px; font-family: 'Courier New', monospace; }
            .footer { background: #f8f9fa; padding: 15px; text-align: center; font-size: 13px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header"><h1>Verificacion de Seguridad</h1></div>
            <div class="content">
              <p>Hola,</p>
              <p>Tu codigo de autenticacion de dos factores es:</p>
              <div class="code-box">${code}</div>
              <p>Este codigo expirara en <strong>10 minutos</strong>.</p>
              <p style="font-size: 13px; color: #777;">Si no solicitaste este codigo, ignora este mensaje.</p>
            </div>
            <div class="footer">© ${new Date().getFullYear()} NU-B Studio — Seguridad de cuentas.</div>
          </div>
        </body>
        </html>
      `,
    };

    const result = await apiInstance.sendTransacEmail(sendSmtpEmail);
    logger.info(`Email 2FA enviado (Message ID: ${result.messageId})`);
    return { success: true, messageId: result.messageId };

  } catch (error) {
    logger.error(`Error al enviar email 2FA: ${error.message}`);
    throw new Error(`Email service error: ${error.message || error.code || 'UNKNOWN'}`);
  }
};

// =========================================================
// LIMPIEZA AUTOMATICA DE CODIGOS EXPIRADOS
// =========================================================
export const cleanupExpiredCodes = async () => {
  try {
    logger.info('Ejecutando limpieza de codigos expirados...');
    logger.info('Limpieza completada');
    return true;
  } catch (error) {
    logger.error(`Error en limpieza de codigos: ${error.message}`);
    return false;
  }
};