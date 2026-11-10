// Pruebas de restablecer la contraseña (#147 del repo móvil): al cambiarla se cierran
// todas las sesiones abiertas. La base, bcrypt y el correo se simulan.
import { jest } from '@jest/globals';

const client = { query: jest.fn(), release: jest.fn() };
const pool = { connect: jest.fn(async () => client), query: jest.fn() };
const compare = jest.fn();
const hash = jest.fn(async () => 'hash-nuevo');

jest.unstable_mockModule('../../src/config/db.js', () => ({ pool, pools: {} }));
jest.unstable_mockModule('bcrypt', () => ({ default: { compare, hash } }));
jest.unstable_mockModule('../../src/services/emailService.js', () => ({
  generateCode: jest.fn(),
  sendRecoveryCode: jest.fn(),
}));
jest.unstable_mockModule('../../src/config/logger.js', () => ({
  default: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

const { resetPassword } = await import('../../src/controllers/recoveryController.js');

function respuesta() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

const sqls = () => client.query.mock.calls.map(([sql]) => sql.replace(/\s+/g, ' ').trim());

beforeEach(() => {
  jest.clearAllMocks();
  compare.mockResolvedValue(false); // la nueva no es igual a la anterior
  client.query.mockImplementation(async (sql) => {
    if (sql.includes('FROM codigos_recuperacion')) {
      return { rows: [{ id_usuario: 4, contraseña_hash: 'hash-viejo' }] };
    }
    return { rows: [], rowCount: 1 };
  });
});

describe('resetPassword', () => {
  it('cierra todas las sesiones del usuario dentro de la misma transacción', async () => {
    const res = respuesta();
    await resetPassword(
      { body: { correo: 'ana@correo.mx', codigo: '123456', nuevaContrasena: 'Galeria#2026' } },
      res
    );

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const consultas = sqls();
    const borrar = consultas.indexOf('DELETE FROM sesiones_activas WHERE id_usuario = $1');
    expect(borrar).toBeGreaterThan(-1);
    expect(borrar).toBeLessThan(consultas.indexOf('COMMIT'));
    const params = client.query.mock.calls[borrar][1];
    expect(params).toEqual([4]);
  });

  it('no cierra sesiones si el código no es válido', async () => {
    client.query.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
    const res = respuesta();
    await resetPassword(
      { body: { correo: 'ana@correo.mx', codigo: '123456', nuevaContrasena: 'Galeria#2026' } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(401);
    expect(sqls().some((sql) => sql.startsWith('DELETE FROM sesiones_activas'))).toBe(false);
  });
});
