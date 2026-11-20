// =========================================================
// LÍMITE DE INTENTOS DE LOGIN POR IP (plan de mejora del rendimiento, acción 2)
// Cada intento ocupa a bcrypt unos 240 ms. Una ráfaga desde una misma IP (fuerza bruta
// o un cliente con un error) llena los hilos de Node aunque cada cuenta se bloquee tras
// 3 contraseñas incorrectas, porque puede probar muchas cuentas distintas.
//
// Cómo cuenta:
// - Cada intento suma 1 al llegar, así una ráfaga se corta antes de llegar a bcrypt.
// - Si el intento sale bien (estado menor a 400), se resta: solo quedan los fallidos.
//   Así varias personas detrás de la misma IP (por ejemplo, la red de la escuela)
//   no se bloquean entre ellas por iniciar sesión bien.
//
// De dónde sale la IP:
// - El servidor tiene `trust proxy` en false, así que en Render `req.ip` es la del proxy
//   y sería la misma para todos. Por eso se usa el primer valor de X-Forwarded-For, que
//   es el que el código ya usa para guardar la IP de cada sesión (sessionService).
// - Ese encabezado lo puede escribir el cliente: con una IP falsa se puede evadir el
//   límite, pero nunca bloquear a todos los usuarios a la vez. Contra fuerza bruta a una
//   cuenta sigue el bloqueo de la cuenta tras 3 intentos.
// - Una conexión local directa (sin X-Forwarded-For y desde 127.0.0.1 o ::1) no se
//   limita: es el entorno de pruebas y desarrollo, donde corre la prueba de esfuerzo.
//   Desde internet no se puede llegar con una dirección local, y en Render todas las
//   peticiones pasan por el proxy con ese encabezado.
// =========================================================
import logger from '../config/logger.js';

const QUINCE_MINUTOS = 15 * 60 * 1000;
const DIRECCIONES_LOCALES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export const MENSAJE_LIMITE =
  'Demasiados intentos de inicio de sesión desde esta red. Espera unos minutos e inténtalo de nuevo.';

const enteroPositivo = (valor, porDefecto) => {
  const n = Number.parseInt(valor, 10);
  return Number.isInteger(n) && n > 0 ? n : porDefecto;
};

export const ipCliente = (req) => {
  const reenviada = req.headers['x-forwarded-for'];
  if (reenviada) return String(reenviada).split(',')[0].trim();
  return req.socket?.remoteAddress || req.ip || 'desconocida';
};

const esConexionLocalDirecta = (req) =>
  !req.headers['x-forwarded-for'] && DIRECCIONES_LOCALES.has(req.socket?.remoteAddress);

export const crearLimiteLogin = ({ ventanaMs, maximo, ahora = Date.now }) => {
  const contadores = new Map();

  const middleware = (req, res, next) => {
    if (esConexionLocalDirecta(req)) return next();

    const ip = ipCliente(req);
    const t = ahora();
    let ventana = contadores.get(ip);
    if (!ventana || t - ventana.inicio >= ventanaMs) {
      ventana = { inicio: t, intentos: 0, avisado: false };
      contadores.set(ip, ventana);
    }

    if (ventana.intentos >= maximo) {
      if (!ventana.avisado) {
        ventana.avisado = true;
        logger.warn(`Límite de intentos de login alcanzado por la IP ${ip}`);
      }
      res.set('Retry-After', String(Math.ceil((ventana.inicio + ventanaMs - t) / 1000)));
      return res.status(429).json({ success: false, code: 'DEMASIADOS_INTENTOS', message: MENSAJE_LIMITE });
    }

    ventana.intentos++;
    res.on('finish', () => {
      if (res.statusCode < 400 && ventana.intentos > 0) ventana.intentos--;
    });
    next();
  };

  // Borra las ventanas vencidas para que el mapa no crezca sin límite.
  middleware.limpiar = () => {
    const t = ahora();
    for (const [ip, ventana] of contadores) {
      if (t - ventana.inicio >= ventanaMs) contadores.delete(ip);
    }
  };
  middleware.tamano = () => contadores.size;
  return middleware;
};

export const VENTANA_LOGIN_MS = enteroPositivo(process.env.LOGIN_LIMITE_VENTANA_MS, QUINCE_MINUTOS);
export const MAXIMO_FALLIDOS_LOGIN = enteroPositivo(process.env.LOGIN_LIMITE_MAXIMO, 20);

const limiteLogin = crearLimiteLogin({ ventanaMs: VENTANA_LOGIN_MS, maximo: MAXIMO_FALLIDOS_LOGIN });
setInterval(limiteLogin.limpiar, 10 * 60 * 1000).unref();

export default limiteLogin;
