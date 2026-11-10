// Pruebas de la duración de la sesión y de sesiones_activas (#147 del repo móvil).
// La base de datos se simula: no se conecta a Neon ni a ninguna base real.
import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';

const pool = { query: jest.fn() };
jest.unstable_mockModule('../../src/config/db.js', () => ({ pool, pools: {} }));
jest.unstable_mockModule('../../src/config/logger.js', () => ({
  default: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

const { duracionSesion } = await import('../../src/config/sesion.js');
const { saveActiveSession, isSessionValid } = await import('../../src/services/sessionService.js');

const SECRETO = 'secreto-solo-para-pruebas';
const req = { headers: { 'user-agent': 'jest' }, socket: { remoteAddress: '127.0.0.1' } };

beforeEach(() => jest.clearAllMocks());

describe('duracionSesion', () => {
  it('da 7 días al cliente', () => {
    expect(duracionSesion('cliente')).toBe('7d');
  });

  it.each(['artista', 'admin', undefined, 'otro'])('deja 24 horas al rol %s', (rol) => {
    expect(duracionSesion(rol)).toBe('24h');
  });
});

describe('saveActiveSession', () => {
  it('guarda la sesión con la misma fecha de vencimiento que el token', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const token = jwt.sign({ sub: '4' }, SECRETO, { expiresIn: duracionSesion('cliente') });
    const { exp, iat } = jwt.decode(token);

    await expect(saveActiveSession(4, token, req)).resolves.toBe(true);

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('to_timestamp($6)');
    expect(params[5]).toBe(exp);
    expect(exp - iat).toBe(7 * 24 * 60 * 60);
  });
});

describe('isSessionValid', () => {
  it('responde true o false según exista la sesión', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id_sesion: 1 }] });
    await expect(isSessionValid('token')).resolves.toBe(true);
    pool.query.mockResolvedValueOnce({ rows: [] });
    await expect(isSessionValid('token')).resolves.toBe(false);
  });

  it('lanza el error si la base falla, en lugar de decir que la sesión no existe', async () => {
    pool.query.mockRejectedValueOnce(new Error('Connection terminated unexpectedly'));
    await expect(isSessionValid('token')).rejects.toThrow('Connection terminated');
  });
});
