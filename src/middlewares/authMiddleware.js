import jwt from 'jsonwebtoken';
import { isSessionValid } from '../services/sessionService.js';
import dotenv from 'dotenv';
import logger from '../config/logger.js';

dotenv.config();

export const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      logger.warn('Auth: token no proporcionado');
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
        logger.warn('Auth: token expirado');
        return res.status(401).json({ message: "Tu sesion ha expirado. Por favor inicia sesion nuevamente.", code: "TOKEN_EXPIRED", expired: true });
      }
      if (error.name === 'JsonWebTokenError') {
        logger.warn('Auth: token invalido o manipulado');
        return res.status(401).json({ message: "Token invalido o manipulado", code: "INVALID_TOKEN" });
      }
      logger.error(`Auth: error al verificar token: ${error.message}`);
      return res.status(401).json({ message: "Error al verificar token", code: "VERIFICATION_ERROR" });
    }

    const sessionExists = await isSessionValid(token);
    if (!sessionExists) {
      logger.warn(`Auth: sesion revocada usuario ${decoded.sub}`);
      return res.status(401).json({ message: "Tu sesion ya no es valida. Por favor inicia sesion nuevamente.", code: "SESSION_REVOKED" });
    }

    req.user = {
      id_usuario: parseInt(decoded.sub),
      jti: decoded.jti,
      rol: decoded.rol || 'cliente'
    };

    req.token = token;
    logger.info(`Auth exitosa: usuario ${decoded.sub} rol ${decoded.rol}`);
    next();

  } catch (error) {
    logger.error(`Middleware authentication error: ${error.message}`);
    return res.status(500).json({ message: "Error al verificar autenticacion", code: "AUTH_ERROR" });
  }
};

// Middleware de auth opcional — no falla si no hay token, solo popula req.user si es válido
export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return next();

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET, {
        algorithms: ['HS256'],
        issuer: 'nub-studio',
        audience: 'nub-users'
      });
    } catch {
      return next(); // token inválido/expirado → ignorar, seguir como visitante
    }

    const sessionExists = await isSessionValid(token);
    if (!sessionExists) return next();

    req.user = {
      id_usuario: parseInt(decoded.sub),
      jti: decoded.jti,
      rol: decoded.rol || 'cliente'
    };
    req.token = token;
    next();
  } catch {
    next();
  }
};

// Middleware de roles
export const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user)
      return res.status(401).json({ message: "No autenticado", code: "NO_AUTH" });

    if (!roles.includes(req.user.rol)) {
      logger.warn(`Acceso denegado: usuario ${req.user.id_usuario} rol ${req.user.rol}, requerido ${roles.join('/')}`);
      return res.status(403).json({ message: "Acceso denegado. No tienes permisos suficientes.", code: "FORBIDDEN" });
    }

    next();
  };
};