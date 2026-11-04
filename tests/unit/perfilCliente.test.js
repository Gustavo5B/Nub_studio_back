// Pruebas unitarias de GET y PUT /api/auth/perfil (ARCO: Acceso, Rectificación y Oposición).
// La base de datos se simula: no se conecta a Neon ni a ninguna base real.
import { jest } from '@jest/globals';

const query = jest.fn();

jest.unstable_mockModule('../../src/config/db.js', () => ({
  pool: { connect: jest.fn() },
  pools: { cliente: { query } },
}));
jest.unstable_mockModule('bcrypt', () => ({ default: { compare: jest.fn() } }));
jest.unstable_mockModule('../../src/config/logger.js', () => ({
  default: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

const { actualizarMiPerfil, obtenerMiPerfil } = await import('../../src/controllers/cuentaController.js');
const { validarActualizarPerfil } = await import('../../src/validators/validators.js');

const PERFIL = {
  nombre: 'Ana Hernández',
  correo: 'ana@correo.mx',
  telefono: '7711234567',
  fecha_registro: '2026-01-10T00:00:00.000Z',
  acepta_marketing: true,
};

function respuesta() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

const peticion = (body) => ({ user: { id_usuario: 4, rol: 'cliente' }, body });
const sql = () => query.mock.calls[0][0].replace(/\s+/g, ' ').trim();

// Corre las validaciones como lo hace la ruta; devuelve el 400 o null si pasan.
async function validar(body) {
  const req = { body };
  const res = respuesta();
  const next = jest.fn();
  for (const middleware of validarActualizarPerfil) {
    await new Promise((resolve) => {
      const seguir = () => resolve();
      const resultado = middleware(req, res, () => {
        next();
        seguir();
      });
      if (resultado?.then) resultado.then(seguir);
      else if (res.status.mock.calls.length) seguir();
    });
    if (res.status.mock.calls.length) return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0], req };
  }
  return { status: null, req };
}

beforeEach(() => {
  jest.clearAllMocks();
  query.mockResolvedValue({ rows: [PERFIL] });
});

describe('obtenerMiPerfil (ARCO, Acceso)', () => {
  it('devuelve los datos del usuario de la sesión', async () => {
    const res = respuesta();
    await obtenerMiPerfil(peticion(), res);
    expect(query.mock.calls[0][1]).toEqual([4]);
    expect(sql()).toContain('eliminado IS NOT TRUE');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: PERFIL });
  });

  it('no consulta ni devuelve datos sensibles', async () => {
    const res = respuesta();
    await obtenerMiPerfil(peticion(), res);
    expect(sql()).not.toContain('contraseña');
    expect(sql()).not.toContain('secret_2fa');
  });

  it('responde 404 si la cuenta ya no existe', async () => {
    query.mockResolvedValue({ rows: [] });
    const res = respuesta();
    await obtenerMiPerfil(peticion(), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('responde 500 si falla la base', async () => {
    query.mockRejectedValue(new Error('fallo simulado'));
    const res = respuesta();
    await obtenerMiPerfil(peticion(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('actualizarMiPerfil (ARCO, Rectificación y Oposición)', () => {
  it('actualiza solo los campos enviados', async () => {
    const res = respuesta();
    await actualizarMiPerfil(peticion({ acepta_marketing: false }), res);
    expect(sql()).toContain('SET acepta_marketing = $2, fecha_actualizacion = NOW()');
    expect(sql()).not.toContain('nombre_completo =');
    expect(query.mock.calls[0][1]).toEqual([4, false]);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: PERFIL });
  });

  it('guarda la autorización cuando el cliente enciende el switch', async () => {
    await actualizarMiPerfil(peticion({ acepta_marketing: true }), respuesta());
    expect(sql()).toContain('SET acepta_marketing = $2');
    expect(query.mock.calls[0][1]).toEqual([4, true]);
  });

  it('actualiza nombre y teléfono del usuario de la sesión', async () => {
    const res = respuesta();
    await actualizarMiPerfil(peticion({ nombre: 'Ana López', telefono: '7719876543' }), res);
    expect(sql()).toContain('nombre_completo = $2, telefono = $3');
    expect(sql()).toContain('WHERE id_usuario = $1');
    expect(query.mock.calls[0][1]).toEqual([4, 'Ana López', '7719876543']);
  });

  it('borra el teléfono si llega vacío', async () => {
    await actualizarMiPerfil(peticion({ telefono: '' }), respuesta());
    expect(query.mock.calls[0][1]).toEqual([4, null]);
  });

  it('ignora el correo y otros campos no permitidos', async () => {
    const res = respuesta();
    await actualizarMiPerfil(peticion({ correo: 'otro@correo.mx', rol: 'admin' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('no cambia el correo aunque llegue junto a un campo válido', async () => {
    await actualizarMiPerfil(peticion({ correo: 'otro@correo.mx', nombre: 'Ana López' }), respuesta());
    expect(sql()).toContain('SET nombre_completo = $2, fecha_actualizacion');
    expect(query.mock.calls[0][1]).toEqual([4, 'Ana López']);
  });

  it('responde 404 si la cuenta ya no existe', async () => {
    query.mockResolvedValue({ rows: [] });
    const res = respuesta();
    await actualizarMiPerfil(peticion({ nombre: 'Ana López' }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('responde 500 si falla la base', async () => {
    query.mockRejectedValue(new Error('fallo simulado'));
    const res = respuesta();
    await actualizarMiPerfil(peticion({ nombre: 'Ana López' }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('validarActualizarPerfil', () => {
  it.each([
    [{ nombre: 'Ana López Núñez' }],
    [{ telefono: '7711234567' }],
    [{ telefono: '' }],
    [{ telefono: null }],
    [{ acepta_marketing: false }],
    [{ acepta_marketing: true }],
  ])('acepta %j', async (body) => {
    expect((await validar(body)).status).toBeNull();
  });

  it.each([
    [{ nombre: 'A' }],
    [{ nombre: 'Ana123' }],
    [{ nombre: 123 }],
    [{ telefono: '12345' }],
    [{ telefono: 7711234567 }],
    [{ acepta_marketing: 'false' }],
  ])('rechaza %j con 400', async (body) => {
    expect((await validar(body)).status).toBe(400);
  });
});
