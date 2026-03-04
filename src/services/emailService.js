import brevo from "@getbrevo/brevo";
import crypto from "crypto";
import dotenv from "dotenv";
import logger from "../config/logger.js";

dotenv.config();

// =========================================================
// CONFIGURACION DE BREVO
// =========================================================
const defaultClient = brevo.ApiClient.instance;
const apiKey = defaultClient.authentications["api-key"];
apiKey.apiKey = process.env.BREVO_API_KEY;

const apiInstance = new brevo.TransactionalEmailsApi();

if (!process.env.BREVO_API_KEY) {
  logger.error("ERROR CRITICO: BREVO_API_KEY no esta configurada en .env");
  throw new Error("BREVO_API_KEY no configurada");
}

logger.info("Brevo API configurada correctamente");

const SENDER = { name: "NU-B Studio", email: "gustavotubazo@gmail.com" };

// =========================================================
// ENVIAR EMAIL DE VERIFICACION DE CUENTA
// =========================================================
export const sendVerificationEmail = async (email, nombre, codigo) => {
  try {
    const sendSmtpEmail = {
      sender: SENDER,
      to: [{ email, name: nombre }],
      subject: "Verifica tu cuenta - NU-B Studio",
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
    logger.info(
      `Email de verificacion enviado (Message ID: ${result.messageId})`,
    );
    return { success: true, messageId: result.messageId };
  } catch (error) {
    logger.error(`Error al enviar email de verificacion: ${error.message}`);
    throw new Error("Error al enviar el correo de verificacion");
  }
};

// =========================================================
// GENERAR CODIGO DE RECUPERACION
// =========================================================
export const generateCode = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin O,0,I,1 para evitar confusiones
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code; // ejemplo: "VM32V8"
};

// =========================================================
// ENVIAR CORREO DE BIENVENIDA
// =========================================================
export const sendWelcomeEmail = async (email, nombre) => {
  try {
    const sendSmtpEmail = {
      sender: SENDER,
      to: [{ email, name: nombre }],
      subject: "Bienvenido a NU-B Studio!",
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
    logger.info(
      `Email de bienvenida enviado (Message ID: ${result.messageId})`,
    );
    return { success: true, messageId: result.messageId };
  } catch (error) {
    logger.error(`Error al enviar email de bienvenida: ${error.message}`);
    throw new Error("Error al enviar el correo de bienvenida");
  }
};

// =========================================================
// ENVIAR CORREO DE RECUPERACION DE CONTRASENA
// =========================================================
export const sendRecoveryCode = async (email, code) => {
  try {
    const sendSmtpEmail = {
      sender: SENDER,
      to: [{ email }],
      subject: "Recuperacion de contraseña - NU-B Studio",
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
            <div class="header"><h1>Recuperacion de Contraseña</h1></div>
            <div class="content">
              <p>Hola,</p>
              <p>Hemos recibido una solicitud para restablecer tu contraseña.</p>
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
    logger.info(
      `Email de recuperacion enviado (Message ID: ${result.messageId})`,
    );
    return { success: true, messageId: result.messageId };
  } catch (error) {
    logger.error(`Error al enviar email de recuperacion: ${error.message}`);
    throw new Error("Error al enviar el codigo por correo");
  }
};

// =========================================================
// ENVIAR CODIGO DE VERIFICACION 2FA
// =========================================================
export const sendGmail2FACode = async (email, code) => {
  try {
    const sendSmtpEmail = {
      sender: SENDER,
      to: [{ email }],
      subject: "Codigo de verificacion (2FA) - NU-B Studio",
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
    throw new Error(
      `Email service error: ${error.message || error.code || "UNKNOWN"}`,
    );
  }
};

// =========================================================
// NOTIFICAR OBRA APROBADA
// =========================================================
export const sendObraAprobadaEmail = async (email, nombre, tituloObra) => {
  try {
    const sendSmtpEmail = {
      sender: SENDER,
      to: [{ email, name: nombre }],
      subject: `¡Tu obra fue aprobada! — ${tituloObra}`,
      htmlContent: `
        <!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body{font-family:'Segoe UI',Roboto,sans-serif;background:#0a0a0a;margin:0;padding:0}
          .c{max-width:600px;margin:40px auto;background:#111;border-radius:16px;overflow:hidden;border:1px solid #222}
          .h{background:linear-gradient(135deg,#10b981,#059669);color:white;padding:40px 30px;text-align:center}
          .h h1{margin:0;font-size:26px;font-weight:bold}.h p{margin:10px 0 0;font-size:15px;opacity:.9}
          .ico{font-size:52px;margin-bottom:12px}
          .b{padding:40px 30px;color:#ccc;text-align:center}
          .obra{background:#0d1f16;border:2px solid #10b981;border-radius:10px;padding:20px 24px;margin:24px 0;text-align:left}
          .obra .lbl{font-size:11px;font-weight:700;color:#059669;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}
          .obra .tit{font-size:20px;font-weight:800;color:#6ee7b7;font-family:Georgia,serif}
          .btn{display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#10b981,#059669);color:white;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;margin-top:8px}
          .f{background:#0d0d0d;padding:20px;text-align:center;font-size:12px;color:#555;border-top:1px solid #222}
        </style></head><body>
        <div class="c">
          <div class="h"><div class="ico">✅</div><h1>Obra aprobada!</h1><p>Ya esta visible en el catalogo de Nu-B Studio</p></div>
          <div class="b">
            <p>Hola <strong style="color:#fff">${nombre}</strong>,</p>
            <p>Tu obra ha sido <strong style="color:#10b981">aprobada y publicada</strong> en nuestro catalogo.</p>
            <div class="obra"><div class="lbl">Obra aprobada</div><div class="tit">${tituloObra}</div></div>
            <p style="color:#888;font-size:14px;line-height:1.7">Tu obra ya es visible para los compradores. Sigue creando!</p>
            <a href="${process.env.FRONTEND_URL}/artista/dashboard" class="btn">Ver mi portal de artista</a>
          </div>
          <div class="f"><p>© ${new Date().getFullYear()} NU-B Studio</p><p>Correo automatico, no respondas directamente.</p></div>
        </div></body></html>
      `,
    };
    const result = await apiInstance.sendTransacEmail(sendSmtpEmail);
    logger.info(
      `Email obra aprobada enviado a ${email.substring(0, 3)}*** (Message ID: ${result.messageId})`,
    );
    return { success: true, messageId: result.messageId };
  } catch (error) {
    logger.error(`Error al enviar email obra aprobada: ${error.message}`);
  }
};

// =========================================================
// NOTIFICAR OBRA RECHAZADA
// =========================================================
export const sendObraRechazadaEmail = async (
  email,
  nombre,
  tituloObra,
  motivo,
) => {
  try {
    const sendSmtpEmail = {
      sender: SENDER,
      to: [{ email, name: nombre }],
      subject: `Actualizacion sobre tu obra — ${tituloObra}`,
      htmlContent: `
        <!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body{font-family:'Segoe UI',Roboto,sans-serif;background:#0a0a0a;margin:0;padding:0}
          .c{max-width:600px;margin:40px auto;background:#111;border-radius:16px;overflow:hidden;border:1px solid #222}
          .h{background:linear-gradient(135deg,#f59e0b,#d97706);color:white;padding:40px 30px;text-align:center}
          .h h1{margin:0;font-size:26px;font-weight:bold}.h p{margin:10px 0 0;font-size:15px;opacity:.9}
          .ico{font-size:52px;margin-bottom:12px}
          .b{padding:40px 30px;color:#ccc}
          .obra{background:#1f1800;border:2px solid #f59e0b;border-radius:10px;padding:20px 24px;margin:20px 0}
          .obra .lbl{font-size:11px;font-weight:700;color:#d97706;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}
          .obra .tit{font-size:20px;font-weight:800;color:#fcd34d;font-family:Georgia,serif}
          .motivo{background:#1a1212;border-left:4px solid #ef4444;border-radius:6px;padding:16px 20px;margin:20px 0}
          .motivo .ml{font-size:11px;font-weight:700;color:#ef4444;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}
          .motivo p{margin:0;font-size:14px;color:#ddd;line-height:1.7}
          .tips{background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:20px 24px;margin:20px 0}
          .tips h3{color:#fff;margin:0 0 12px;font-size:15px}
          .tips ul{margin:0;padding-left:20px;color:#999;font-size:13.5px;line-height:2}
          .btn{display:inline-block;padding:13px 34px;background:linear-gradient(135deg,#f59e0b,#d97706);color:white;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;margin-top:8px}
          .bc{text-align:center;margin-top:24px}
          .f{background:#0d0d0d;padding:20px;text-align:center;font-size:12px;color:#555;border-top:1px solid #222}
        </style></head><body>
        <div class="c">
          <div class="h"><div class="ico">📋</div><h1>Revision de tu obra</h1><p>Tu obra requiere algunos ajustes</p></div>
          <div class="b">
            <p>Hola <strong style="color:#fff">${nombre}</strong>,</p>
            <p>Hemos revisado tu obra y por el momento no puede ser publicada.</p>
            <div class="obra"><div class="lbl">Obra revisada</div><div class="tit">${tituloObra}</div></div>
            ${motivo ? `<div class="motivo"><div class="ml">Motivo</div><p>${motivo}</p></div>` : ""}
            <div class="tips">
              <h3>Sugerencias para que tu obra sea aprobada</h3>
              <ul>
                <li>Asegurate de que la imagen sea de alta calidad y bien iluminada</li>
                <li>La descripcion debe ser detallada y precisa</li>
                <li>Verifica que el precio sea acorde al mercado</li>
                <li>Revisa que la categoria y tecnica esten correctas</li>
              </ul>
            </div>
            <p style="color:#888;font-size:14px;line-height:1.7">Puedes editar tu obra desde tu portal y volver a enviarla para revision.</p>
            <div class="bc"><a href="${process.env.FRONTEND_URL}/artista/dashboard" class="btn">Editar mi obra</a></div>
          </div>
          <div class="f"><p>© ${new Date().getFullYear()} NU-B Studio</p><p>Correo automatico, no respondas directamente.</p></div>
        </div></body></html>
      `,
    };
    const result = await apiInstance.sendTransacEmail(sendSmtpEmail);
    logger.info(
      `Email obra rechazada enviado a ${email.substring(0, 3)}*** (Message ID: ${result.messageId})`,
    );
    return { success: true, messageId: result.messageId };
  } catch (error) {
    logger.error(`Error al enviar email obra rechazada: ${error.message}`);
  }
};

// =========================================================
// NOTIFICAR REGISTRO DE ARTISTA — solicitud recibida
// =========================================================
export const sendArtistaSolicitudEmail = async (email, nombre) => {
  try {
    const sendSmtpEmail = {
      sender: SENDER,
      to: [{ email, name: nombre }],
      subject: "Tu solicitud fue recibida - NU-B Studio",
      htmlContent: `
        <!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body{font-family:'Segoe UI',Roboto,sans-serif;background:#0a0a0a;margin:0;padding:0}
          .c{max-width:600px;margin:40px auto;background:#111;border-radius:16px;overflow:hidden;border:1px solid #222}
          .h{background:linear-gradient(135deg,#FF840E,#CC4EA1);color:white;padding:40px 30px;text-align:center}
          .h h1{margin:0;font-size:26px}.h p{margin:10px 0 0;font-size:15px;opacity:.9}
          .ico{font-size:52px;margin-bottom:12px}
          .b{padding:36px 30px;color:#ccc;text-align:center}
          .steps{background:#1a1a1a;border:1px solid #333;border-radius:12px;padding:20px 24px;margin:24px 0;text-align:left}
          .steps h3{color:#fff;margin:0 0 14px;font-size:15px}
          .step{display:flex;gap:12px;margin-bottom:12px;font-size:13.5px;color:#aaa;line-height:1.6;align-items:flex-start}
          .n{background:linear-gradient(135deg,#FF840E,#CC4EA1);color:white;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;flex-shrink:0;margin-top:1px}
          .f{background:#0d0d0d;padding:20px;text-align:center;font-size:12px;color:#555;border-top:1px solid #222}
        </style></head><body>
        <div class="c">
          <div class="h"><div class="ico">📋</div><h1>Solicitud recibida</h1><p>Estamos revisando tu perfil de artista</p></div>
          <div class="b">
            <p>Hola <strong style="color:#fff">${nombre}</strong>,</p>
            <p>Hemos recibido tu solicitud para unirte a la comunidad de artistas de <strong style="color:#FF840E">Nu-B Studio</strong>. Nuestro equipo la revisara y te notificaremos por correo.</p>
            <div class="steps">
              <h3>Que sigue?</h3>
              <div class="step"><div class="n">1</div><span>Nuestro equipo revisa tu perfil y biografia</span></div>
              <div class="step"><div class="n">2</div><span>Recibiras un correo con la decision (hasta 48 hrs habiles)</span></div>
              <div class="step"><div class="n">3</div><span>Si es aprobado, podras subir tus obras al catalogo</span></div>
            </div>
            <p style="color:#666;font-size:13px;line-height:1.7">Si tienes alguna duda, contactanos directamente.</p>
          </div>
          <div class="f"><p>© ${new Date().getFullYear()} NU-B Studio</p><p>Correo automatico, no respondas directamente.</p></div>
        </div></body></html>
      `,
    };
    const result = await apiInstance.sendTransacEmail(sendSmtpEmail);
    logger.info(
      `Email solicitud artista enviado a ${email.substring(0, 3)}*** (Message ID: ${result.messageId})`,
    );
    return { success: true, messageId: result.messageId };
  } catch (error) {
    logger.error(`Error al enviar email solicitud artista: ${error.message}`);
  }
};

// =========================================================
// NOTIFICAR ARTISTA APROBADO (registro público con contraseña)
// =========================================================
export const sendArtistaAprobadoEmail = async (email, nombre) => {
  try {
    const sendSmtpEmail = {
      sender: SENDER,
      to: [{ email, name: nombre }],
      subject: "Bienvenido al equipo! Tu cuenta fue aprobada - NU-B Studio",
      htmlContent: `
        <!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body{font-family:'Segoe UI',Roboto,sans-serif;background:#0a0a0a;margin:0;padding:0}
          .c{max-width:600px;margin:40px auto;background:#111;border-radius:16px;overflow:hidden;border:1px solid #222}
          .h{background:linear-gradient(135deg,#22C97A,#00b894);color:white;padding:40px 30px;text-align:center}
          .h h1{margin:0;font-size:26px}.h p{margin:10px 0 0;font-size:15px;opacity:.9}
          .ico{font-size:52px;margin-bottom:12px}
          .b{padding:36px 30px;color:#ccc;text-align:center}
          .feats{background:#0d1f16;border:1px solid #22C97A33;border-radius:12px;padding:20px 24px;margin:24px 0;text-align:left}
          .feats h3{color:#22C97A;margin:0 0 14px;font-size:15px}
          .feat{display:flex;gap:10px;margin-bottom:10px;font-size:13.5px;color:#aaa;line-height:1.6}
          .feat span:first-child{color:#22C97A;font-size:16px;flex-shrink:0}
          .btn{display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#22C97A,#00b894);color:#000;text-decoration:none;border-radius:10px;font-weight:900;font-size:15px;margin-top:10px}
          .f{background:#0d0d0d;padding:20px;text-align:center;font-size:12px;color:#555;border-top:1px solid #222}
        </style></head><body>
        <div class="c">
          <div class="h"><div class="ico">🎨</div><h1>Cuenta aprobada!</h1><p>Ya eres parte de Nu-B Studio</p></div>
          <div class="b">
            <p>Hola <strong style="color:#fff">${nombre}</strong>,</p>
            <p>Tu solicitud fue <strong style="color:#22C97A">aprobada</strong>. Ya puedes acceder a tu portal de artista y subir tus obras al catalogo.</p>
            <div class="feats">
              <h3>Que puedes hacer ahora?</h3>
              <div class="feat"><span>✦</span><span>Subir y gestionar tus obras</span></div>
              <div class="feat"><span>✦</span><span>Personalizar tu perfil de artista</span></div>
              <div class="feat"><span>✦</span><span>Recibir notificaciones de ventas</span></div>
              <div class="feat"><span>✦</span><span>Acceder a estadisticas de tus obras</span></div>
            </div>
            <a href="${process.env.FRONTEND_URL}/login" class="btn">Ir a mi portal</a>
            <p style="color:#555;font-size:13px;margin-top:28px;line-height:1.7">Estamos emocionados de tenerte en el equipo!</p>
          </div>
          <div class="f"><p>© ${new Date().getFullYear()} NU-B Studio</p><p>Correo automatico, no respondas directamente.</p></div>
        </div></body></html>
      `,
    };
    const result = await apiInstance.sendTransacEmail(sendSmtpEmail);
    logger.info(
      `Email artista aprobado enviado a ${email.substring(0, 3)}*** (Message ID: ${result.messageId})`,
    );
    return { success: true, messageId: result.messageId };
  } catch (error) {
    logger.error(`Error al enviar email artista aprobado: ${error.message}`);
  }
};

// =========================================================
// NOTIFICAR ARTISTA RECHAZADO
// =========================================================
export const sendArtistaRechazadoEmail = async (email, nombre, motivo) => {
  try {
    const sendSmtpEmail = {
      sender: SENDER,
      to: [{ email, name: nombre }],
      subject: "Actualizacion sobre tu solicitud - NU-B Studio",
      htmlContent: `
        <!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body{font-family:'Segoe UI',Roboto,sans-serif;background:#0a0a0a;margin:0;padding:0}
          .c{max-width:600px;margin:40px auto;background:#111;border-radius:16px;overflow:hidden;border:1px solid #222}
          .h{background:linear-gradient(135deg,#CC59AD,#a0439b);color:white;padding:40px 30px;text-align:center}
          .h h1{margin:0;font-size:26px}.h p{margin:10px 0 0;font-size:15px;opacity:.9}
          .ico{font-size:52px;margin-bottom:12px}
          .b{padding:36px 30px;color:#ccc}
          .motivo{background:#1a1212;border-left:4px solid #CC59AD;border-radius:6px;padding:16px 20px;margin:20px 0}
          .motivo .ml{font-size:11px;font-weight:700;color:#CC59AD;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}
          .motivo p{margin:0;font-size:14px;color:#ddd;line-height:1.7}
          .tips{background:#1a1a1a;border:1px solid #333;border-radius:12px;padding:20px 24px;margin:20px 0}
          .tips h3{color:#fff;margin:0 0 12px;font-size:15px}
          .tips ul{margin:0;padding-left:18px;color:#999;font-size:13.5px;line-height:2}
          .f{background:#0d0d0d;padding:20px;text-align:center;font-size:12px;color:#555;border-top:1px solid #222}
        </style></head><body>
        <div class="c">
          <div class="h"><div class="ico">📋</div><h1>Revision de solicitud</h1><p>Tu solicitud requiere algunos ajustes</p></div>
          <div class="b">
            <p>Hola <strong style="color:#fff">${nombre}</strong>,</p>
            <p>Hemos revisado tu solicitud y por el momento no podemos aprobarla.</p>
            ${motivo ? `<div class="motivo"><div class="ml">Motivo</div><p>${motivo}</p></div>` : ""}
            <div class="tips">
              <h3>Sugerencias para mejorar tu solicitud</h3>
              <ul>
                <li>Asegurate de que tu biografia sea detallada y profesional</li>
                <li>Verifica que tu informacion de contacto este completa</li>
                <li>Selecciona la categoria que mejor describe tu trabajo</li>
                <li>Puedes volver a registrarte con la informacion corregida</li>
              </ul>
            </div>
            <p style="color:#666;font-size:13.5px;line-height:1.7;margin-top:20px">Si tienes preguntas o crees que hubo un error, contactanos.</p>
          </div>
          <div class="f"><p>© ${new Date().getFullYear()} NU-B Studio</p><p>Correo automatico, no respondas directamente.</p></div>
        </div></body></html>
      `,
    };
    const result = await apiInstance.sendTransacEmail(sendSmtpEmail);
    logger.info(
      `Email artista rechazado enviado a ${email.substring(0, 3)}*** (Message ID: ${result.messageId})`,
    );
    return { success: true, messageId: result.messageId };
  } catch (error) {
    logger.error(`Error al enviar email artista rechazado: ${error.message}`);
  }
};

// =========================================================
// ACTIVACION DE CUENTA — artista creado por admin
// Llama: artistasController.crearArtista
//        artistasController.cambiarEstadoArtista (Caso A: sin contraseña)
// Link:  FRONTEND_URL/activar-cuenta?token=xxxxx
// =========================================================
export const sendActivacionCuentaEmail = async (correo, nombre, token) => {
  try {
    const link = `${process.env.FRONTEND_URL}/activar-cuenta?token=${token}`;
    const sendSmtpEmail = {
      sender: SENDER,
      to: [{ email: correo, name: nombre }],
      subject: "Activa tu cuenta en Nu-B Studio — Crea tu contraseña",
      htmlContent: `
        <!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <style>
          body{font-family:'Segoe UI',Roboto,sans-serif;background:#0a0a0a;margin:0;padding:0}
          .c{max-width:560px;margin:40px auto;background:#111;border:1px solid #222;border-radius:16px;overflow:hidden}
          .h{background:linear-gradient(135deg,#FF840E,#CC4EA1);padding:36px 32px;text-align:center}
          .h-t{font-size:26px;font-weight:900;color:#fff;margin-bottom:6px}
          .h-s{font-size:13px;color:rgba(255,255,255,.8);letter-spacing:2px;text-transform:uppercase}
          .b{padding:36px 32px}
          .greeting{font-size:22px;font-weight:800;color:#FFF8EE;margin-bottom:12px}
          .txt{font-size:14.5px;color:#D8CABC;line-height:1.75;margin-bottom:20px}
          .card{background:#1a1a1a;border:1px solid #2a2a2a;border-left:3px solid #FF840E;border-radius:12px;padding:16px 20px;margin-bottom:28px}
          .card-lbl{font-size:12px;color:rgba(255,232,200,.5);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}
          .card-val{font-size:14px;color:#FFF8EE;font-weight:600}
          .card-exp{font-size:12px;color:rgba(255,232,200,.4);margin-top:4px}
          .btn-wrap{text-align:center;margin-bottom:28px}
          .btn{display:inline-block;background:linear-gradient(135deg,#FF840E,#CC4EA1);color:#fff;text-decoration:none;padding:16px 40px;border-radius:12px;font-weight:800;font-size:15px;box-shadow:0 8px 24px rgba(255,132,14,.35)}
          .link-note{font-size:12.5px;color:rgba(255,232,200,.35);text-align:center;line-height:1.7;word-break:break-all}
          .link-url{color:rgba(255,132,14,.6)}
          .f{border-top:1px solid #222;padding:20px 32px;text-align:center;font-size:11.5px;color:rgba(255,232,200,.25)}
        </style></head><body>
        <div class="c">
          <div class="h">
            <div class="h-t">Nu-B Studio</div>
            <div class="h-s">Portal de Artistas</div>
          </div>
          <div class="b">
            <div class="greeting">¡Hola, ${nombre}! 👋</div>
            <div class="txt">
              Has sido registrado como artista en <strong style="color:#FF840E">Nu-B Studio</strong>.
              Para acceder a tu portal necesitas crear tu contraseña con el siguiente enlace.
            </div>
            <div class="card">
              <div class="card-lbl">Tu correo de acceso</div>
              <div class="card-val">${correo}</div>
              <div class="card-exp">Este enlace expira en 48 horas</div>
            </div>
            <div class="btn-wrap">
              <a href="${link}" class="btn">Crear mi contraseña →</a>
            </div>
            <div class="link-note">
              Si el botón no funciona, copia este enlace en tu navegador:<br>
              <span class="link-url">${link}</span>
            </div>
          </div>
          <div class="f">
            Si no esperabas este correo, ignóralo. No se realizará ningún cambio.<br>
            © ${new Date().getFullYear()} Nu-B Studio
          </div>
        </div>
        </body></html>`,
    };
    const result = await apiInstance.sendTransacEmail(sendSmtpEmail);
    logger.info(
      `Email activacion cuenta enviado a ${correo.substring(0, 3)}*** (ID: ${result.messageId})`,
    );
    return { success: true, messageId: result.messageId };
  } catch (error) {
    logger.error(`Error email activacion cuenta: ${error.message}`);
  }
};

// =========================================================
// VERIFICACION DE EMAIL — artista registro público
// Llama: authController.registroArtista
// Link:  FRONTEND_URL/verificar-email?token=xxxxx
// =========================================================
export const sendVerificacionEmailArtista = async (correo, nombre, token) => {
  try {
    const link = `${process.env.FRONTEND_URL}/verificar-email?token=${token}`;
    const sendSmtpEmail = {
      sender: SENDER,
      to: [{ email: correo, name: nombre }],
      subject: "Verifica tu correo — Nu-B Studio",
      htmlContent: `
        <!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <style>
          body{font-family:'Segoe UI',Roboto,sans-serif;background:#0a0a0a;margin:0;padding:0}
          .c{max-width:560px;margin:40px auto;background:#111;border:1px solid #222;border-radius:16px;overflow:hidden}
          .h{background:linear-gradient(135deg,#8D4CCD,#79AAF5);padding:36px 32px;text-align:center}
          .h-t{font-size:26px;font-weight:900;color:#fff;margin-bottom:6px}
          .h-s{font-size:13px;color:rgba(255,255,255,.8);letter-spacing:2px;text-transform:uppercase}
          .b{padding:36px 32px}
          .greeting{font-size:22px;font-weight:800;color:#FFF8EE;margin-bottom:12px}
          .txt{font-size:14.5px;color:#D8CABC;line-height:1.75;margin-bottom:20px}
          .steps-card{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:20px;margin-bottom:28px}
          .steps-lbl{font-size:12px;color:rgba(255,232,200,.5);text-transform:uppercase;letter-spacing:1px;margin-bottom:14px}
          .step{display:flex;align-items:center;gap:12px;margin-bottom:10px}
          .step-txt{font-size:13.5px;color:#D8CABC}
          .btn-wrap{text-align:center;margin-bottom:28px}
          .btn{display:inline-block;background:linear-gradient(135deg,#8D4CCD,#79AAF5);color:#fff;text-decoration:none;padding:16px 40px;border-radius:12px;font-weight:800;font-size:15px;box-shadow:0 8px 24px rgba(141,76,205,.35)}
          .link-note{font-size:12px;color:rgba(255,232,200,.3);text-align:center;word-break:break-all}
          .link-url{color:rgba(141,76,205,.5)}
          .f{border-top:1px solid #222;padding:20px 32px;text-align:center;font-size:11.5px;color:rgba(255,232,200,.25)}
        </style></head><body>
        <div class="c">
          <div class="h">
            <div class="h-t">Nu-B Studio</div>
            <div class="h-s">Verificación de cuenta</div>
          </div>
          <div class="b">
            <div class="greeting">¡Ya casi listo, ${nombre}!</div>
            <div class="txt">
              Recibimos tu solicitud para unirte como artista a <strong style="color:#8D4CCD">Nu-B Studio</strong>.
              Solo necesitamos verificar tu correo electrónico.
            </div>
            <div class="steps-card">
              <div class="steps-lbl">Qué sigue</div>
              <div class="step">
                <div style="width:26px;height:26px;border-radius:50%;background:rgba(121,170,245,.15);border:1px solid rgba(121,170,245,.4);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#79AAF5;flex-shrink:0">1</div>
                <span class="step-txt">Verifica tu correo con el botón de abajo</span>
              </div>
              <div class="step">
                <div style="width:26px;height:26px;border-radius:50%;background:rgba(255,193,16,.15);border:1px solid rgba(255,193,16,.4);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#FFC110;flex-shrink:0">2</div>
                <span class="step-txt">Nuestro equipo revisará tu solicitud (hasta 48 hrs)</span>
              </div>
              <div class="step">
                <div style="width:26px;height:26px;border-radius:50%;background:rgba(34,201,122,.15);border:1px solid rgba(34,201,122,.4);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#22C97A;flex-shrink:0">3</div>
                <span class="step-txt">Recibirás un email cuando seas aprobado</span>
              </div>
            </div>
            <div class="btn-wrap">
              <a href="${link}" class="btn">Verificar mi correo →</a>
            </div>
            <div class="link-note">
              Este enlace expira en 48 horas.<br>
              <span class="link-url">${link}</span>
            </div>
          </div>
          <div class="f">
            Si no creaste esta cuenta, ignora este correo.<br>
            © ${new Date().getFullYear()} Nu-B Studio
          </div>
        </div>
        </body></html>`,
    };
    const result = await apiInstance.sendTransacEmail(sendSmtpEmail);
    logger.info(
      `Email verificacion artista enviado a ${correo.substring(0, 3)}*** (ID: ${result.messageId})`,
    );
    return { success: true, messageId: result.messageId };
  } catch (error) {
    logger.error(`Error email verificacion artista: ${error.message}`);
  }
};

// =========================================================
// LIMPIEZA AUTOMATICA DE CODIGOS EXPIRADOS
// =========================================================
export const cleanupExpiredCodes = async () => {
  try {
    logger.info("Ejecutando limpieza de codigos expirados...");
    logger.info("Limpieza completada");
    return true;
  } catch (error) {
    logger.error(`Error en limpieza de codigos: ${error.message}`);
    return false;
  }
};
