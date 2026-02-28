import jwt from 'jsonwebtoken';
import { isSessionValid } from '../services/sessionService.js';
import dotenv from 'dotenv';

dotenv.config();

const secureLog = {
  info: (message, metadata = {}) => {
    const sanitized = { ...metadata };
    delete sanitized.token; delete sanitized.codigo;
    delete sanitized.password; delete sanitized.contrasena;
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

export const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      secureLog.security('AUTH_NO_TOKEN', null);
      return res.status(401).json({ message: "Token no proporcionado", code: "NO_TOKEN" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET, {
        algorithms: ['HS256'],
        issuer: 'nub-studio',
        audience: 'nub-users'
      });
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        secureLog.security('TOKEN_EXPIRED', null);
        return res.status(401).json({ message: "Tu sesión ha expirado. Por favor inicia sesión nuevamente.", code: "TOKEN_EXPIRED", expired: true });
      }
      if (error.name === 'JsonWebTokenError') {
        secureLog.security('INVALID_TOKEN', null);
        return res.status(401).json({ message: "Token inválido o manipulado", code: "INVALID_TOKEN" });
      }
      secureLog.error('Token verification error', error);
      return res.status(401).json({ message: "Error al verificar token", code: "VERIFICATION_ERROR" });
    }

    const sessionExists = await isSessionValid(token);
    if (!sessionExists) {
      secureLog.security('SESSION_REVOKED', decoded.sub);
      return res.status(401).json({ message: "Tu sesión ya no es válida. Por favor inicia sesión nuevamente.", code: "SESSION_REVOKED" });
    }

    // ✅ Ahora incluye rol desde el JWT
    req.user = {
      id_usuario: parseInt(decoded.sub),
      jti: decoded.jti,
      rol: decoded.rol || 'cliente'   // ← NUEVO
    };

    req.token = token;
    secureLog.security('AUTH_SUCCESS', decoded.sub, { rol: decoded.rol });
    next();

  } catch (error) {
    secureLog.error('Middleware authentication error', error);
    return res.status(500).json({ message: "Error al verificar autenticación", code: "AUTH_ERROR" });
  }
};

// ✅ NUEVO: Middleware de roles
export const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "No autenticado", code: "NO_AUTH" });
    }
    if (!roles.includes(req.user.rol)) {
      secureLog.security('ACCESO_DENEGADO', req.user.id_usuario, { rol: req.user.rol, requerido: roles });
      return res.status(403).json({ message: "Acceso denegado. No tienes permisos suficientes.", code: "FORBIDDEN" });
    }
    next();
  };
};