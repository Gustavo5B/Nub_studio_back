// Pruebas del middleware de sesión (#147 del repo móvil).
// Un fallo de la base al revisar la sesión responde 503, no 401: la app solo cierra la
// sesión con 401, así que un tropiezo de la base ya no saca a la persona usuaria.
import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';

const isSessionValid = jest.fn();
jest.unstable_mockModule('../../src/services/sessionService.js', () => ({ isSessionValid }));
jest.unstable_mockModule('../../src/config/logger.js', () => ({
  default: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

process.env.JWT_SECRET = 'secreto-solo-para-pruebas';
const { authenticateToken } = await import('../../src/middlewares/authMiddleware.js');

const token = jwt.sign({ sub: '4', jti: 'abc', rol: 'cliente' }, process.env.JWT_SECRET, {
  algorithm: 'HS256',
  expiresIn: '7d',
  issuer: 'nub-studio',
  audience: 'nub-users',
});

function correr() {
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  const next = jest.fn();
  return authenticateToken(req, res, next).then(() => ({ req, res, next }));
}

beforeEach(() => jest.clearAllMocks());

describe('authenticateToken', () => {
  it('deja pasar una sesión válida', async () => {
    isSessionValid.mockResolvedValue(true);
    const { req, next } = await correr();
    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual({ id_usuario: 4, jti: 'abc', rol: 'cliente' });
  });

  it('responde 401 SESSION_REVOKED si la sesión ya no existe', async () => {
    isSessionValid.mockResolvedValue(false);
    const { res, next } = await correr();
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'SESSION_REVOKED' }));
  });

  it('responde 503 si la base falla al revisar la sesión', async () => {
    isSessionValid.mockRejectedValue(new Error('Connection terminated unexpectedly'));
    const { res, next } = await correr();
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'SESSION_CHECK_FAILED' })
    );
  });
});
