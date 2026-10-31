// Pruebas unitarias de DELETE /api/auth/cuenta (eliminar la cuenta del cliente).
// La base de datos y bcrypt se simulan: no se conecta a Neon ni a ninguna base real.
import { jest } from '@jest/globals';

const client = { query: jest.fn(), release: jest.fn() };
const pool = { connect: jest.fn(async () => client) };
const compare = jest.fn();

jest.unstable_mockModule('../../src/config/db.js', () => ({ pool }));
jest.unstable_mockModule('bcrypt', () => ({ default: { compare } }));
jest.unstable_mockModule('../../src/config/logger.js', () => ({
  default: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

const { eliminarMiCuenta } = await import('../../src/controllers/cuentaController.js');

function respuesta() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

const cliente = (extra = {}) => ({
  user: { id_usuario: 4, rol: 'cliente' },
  body: { contrasena: 'Huapango.26' },
  ...extra,
});

// Respuestas de la base en orden: usuario, ventas en curso y luego la transacción.
function base({ usuario = { id_usuario: 4, contraseña_hash: 'hash', eliminado: false }, enCurso = 0 } = {}) {
  client.query.mockImplementation(async (sql) => {
    if (sql.startsWith('SELECT id_usuario')) return { rows: usuario ? [usuario] : [] };
    if (sql.startsWith('SELECT COUNT(*)')) return { rows: [{ total: enCurso }] };
    return { rows: [], rowCount: 1 };
  });
}

const sqls = () => client.query.mock.calls.map(([sql]) => sql.replace(/\s+/g, ' ').trim());

beforeEach(() => {
  jest.clearAllMocks();
  compare.mockResolvedValue(true);
  base();
});

describe('eliminarMiCuenta (ARCO, Cancelación)', () => {
  it('responde 401 si no hay usuario en la sesión', async () => {
    const res = respuesta();
    await eliminarMiCuenta({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('no deja eliminar cuentas de artista o administrador (403)', async () => {
    const res = respuesta();
    await eliminarMiCuenta(cliente({ user: { id_usuario: 2, rol: 'artista' } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('pide la contraseña (400)', async () => {
    const res = respuesta();
    await eliminarMiCuenta(cliente({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Escribe tu contraseña para confirmar' });
  });

  it('responde 404 si la cuenta ya fue eliminada', async () => {
    base({ usuario: { id_usuario: 4, contraseña_hash: null, eliminado: true } });
    const res = respuesta();
    await eliminarMiCuenta(cliente(), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(client.release).toHaveBeenCalled();
  });

  it('responde 404 si el usuario no existe', async () => {
    base({ usuario: null });
    const res = respuesta();
    await eliminarMiCuenta(cliente(), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('rechaza una contraseña incorrecta (401) sin tocar los datos', async () => {
    compare.mockResolvedValue(false);
    const res = respuesta();
    await eliminarMiCuenta(cliente(), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(sqls().some((s) => s.startsWith('BEGIN'))).toBe(false);
  });

  it('trata como incorrecta una cuenta sin contraseña guardada (401)', async () => {
    base({ usuario: { id_usuario: 4, contraseña_hash: null, eliminado: false } });
    const res = respuesta();
    await eliminarMiCuenta(cliente(), res);
    expect(compare).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('no elimina si hay un pedido en camino (409)', async () => {
    base({ enCurso: 1 });
    const res = respuesta();
    await eliminarMiCuenta(cliente(), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(sqls().some((s) => s.startsWith('BEGIN'))).toBe(false);
    const ventas = client.query.mock.calls.find(([sql]) => sql.startsWith('SELECT COUNT(*)'));
    expect(ventas[1]).toEqual([4, ['pagado', 'procesando', 'enviado']]);
  });

  it('anonimiza la cuenta y borra sus datos en una sola transacción', async () => {
    const res = respuesta();
    await eliminarMiCuenta(cliente(), res);

    expect(compare).toHaveBeenCalledWith('Huapango.26', 'hash');
    const pasos = sqls();
    const indice = (inicio) => pasos.findIndex((s) => s.startsWith(inicio));
    expect(indice('BEGIN')).toBeGreaterThan(-1);
    expect(indice('DELETE FROM favoritos')).toBeGreaterThan(indice('BEGIN'));
    expect(indice('DELETE FROM carritos')).toBeGreaterThan(-1);
    expect(indice('DELETE FROM blog_reacciones')).toBeGreaterThan(-1);
    expect(indice('DELETE FROM direcciones')).toBeGreaterThan(-1);
    expect(indice('UPDATE direcciones')).toBeGreaterThan(indice('DELETE FROM direcciones'));
    expect(indice('UPDATE usuarios')).toBeGreaterThan(-1);
    expect(indice('DELETE FROM sesiones_activas')).toBeGreaterThan(indice('UPDATE usuarios'));
    expect(indice('COMMIT')).toBe(pasos.length - 1);

    const anonimiza = pasos[indice('UPDATE usuarios')];
    expect(anonimiza).toContain("nombre_completo = 'Usuario eliminado'");
    expect(anonimiza).toContain('"contraseña_hash" = NULL');
    expect(anonimiza).toContain('eliminado = TRUE');

    expect(res.json).toHaveBeenCalledWith({ message: 'Tu cuenta se eliminó correctamente' });
    expect(res.status).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('si algo falla deshace la transacción y responde 500', async () => {
    client.query.mockImplementation(async (sql) => {
      if (sql.startsWith('SELECT id_usuario')) return { rows: [{ id_usuario: 4, contraseña_hash: 'h', eliminado: false }] };
      if (sql.startsWith('SELECT COUNT(*)')) return { rows: [{ total: 0 }] };
      if (sql.startsWith('UPDATE usuarios')) throw new Error('fallo simulado');
      return { rows: [] };
    });
    const res = respuesta();
    await eliminarMiCuenta(cliente(), res);
    expect(sqls()).toContain('ROLLBACK');
    expect(sqls()).not.toContain('COMMIT');
    expect(res.status).toHaveBeenCalledWith(500);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
