// Pruebas de los filtros de SQL injection y XSS (#146 del repo móvil).
// Las contraseñas pueden llevar cualquier símbolo; los demás campos siguen protegidos.
import { jest } from '@jest/globals';

const logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn() };
jest.unstable_mockModule('../../src/config/logger.js', () => ({ default: logger }));

const { preventSQLInjection } = await import('../../src/middlewares/sql-injection.middleware.js');
const { sanitizeInput } = await import('../../src/middlewares/sanitize.middleware.js');

function respuesta() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

function correr(middleware, body) {
  const res = respuesta();
  const next = jest.fn();
  middleware({ body, query: {}, params: {} }, res, next);
  return { res, next };
}

// Contraseñas de ejemplo que cumplen las reglas y que antes se rechazaban.
const CONTRASENAS = ['Galeria#2026', 'Arte--Huasteca9', 'Delete.Obra7', 'Pin/*tura8'];

beforeEach(() => jest.clearAllMocks());

describe('preventSQLInjection', () => {
  it.each(CONTRASENAS)('deja pasar la contraseña %s en todos los campos de contraseña', (valor) => {
    for (const campo of ['contrasena', 'password', 'nuevaContrasena', 'nueva_password']) {
      const { res, next } = correr(preventSQLInjection, { correo: 'ana@correo.mx', [campo]: valor });
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    }
  });

  it('sigue rechazando patrones de SQL en los demás campos', () => {
    const { res, next } = correr(preventSQLInjection, { nombre: "Ana'; DROP TABLE usuarios --" });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'SQL_INJECTION_DETECTED', field: 'nombre' })
    );
  });

  it('escribe en el log solo el nombre del campo, nunca su valor', () => {
    correr(preventSQLInjection, { comentario: 'texto secreto # con numeral' });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toContain('body.comentario');
    expect(logger.warn.mock.calls[0][0]).not.toContain('secreto');
  });
});

describe('sanitizeInput (XSS)', () => {
  it('deja pasar una contraseña que parece un atributo de HTML', () => {
    const { res, next } = correr(sanitizeInput, { contrasena: 'Ponerse=Arte9' });
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('sigue rechazando scripts en los demás campos', () => {
    const { res, next } = correr(sanitizeInput, { comentario: '<script>alert(1)</script>' });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'XSS_DETECTED', field: 'comentario' })
    );
  });

  it('escribe en el log solo el nombre del campo, nunca su valor', () => {
    correr(sanitizeInput, { biografia: '<iframe src="dato-privado">' });
    expect(logger.warn.mock.calls[0][0]).toContain('body.biografia');
    expect(logger.warn.mock.calls[0][0]).not.toContain('dato-privado');
  });
});
