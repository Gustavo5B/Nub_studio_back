// Pruebas del límite de intentos de login por IP (plan de mejora del rendimiento, acción 2).
// No se levanta el servidor: se simulan la petición, la respuesta y el reloj.
import { jest } from '@jest/globals';
import { EventEmitter } from 'node:events';

const logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };
jest.unstable_mockModule('../../src/config/logger.js', () => ({ default: logger }));

const { crearLimiteLogin, ipCliente, MENSAJE_LIMITE, MAXIMO_FALLIDOS_LOGIN, VENTANA_LOGIN_MS, default: limiteLogin } =
  await import('../../src/middlewares/limiteLogin.middleware.js');

const peticion = ({ xff, remota = '10.0.0.5' } = {}) => ({
  headers: xff ? { 'x-forwarded-for': xff } : {},
  socket: { remoteAddress: remota },
  ip: remota,
});

const respuesta = () => {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.encabezados = {};
  res.set = jest.fn((k, v) => { res.encabezados[k] = v; return res; });
  res.status = jest.fn((c) => { res.statusCode = c; return res; });
  res.json = jest.fn(() => res);
  return res;
};

// Hace un intento completo: pasa por el límite y, si llega al login, termina con `estado`.
const intento = (limite, estado, req = peticion({ xff: '200.1.1.1' })) => {
  const res = respuesta();
  const next = jest.fn(() => {
    res.statusCode = estado;
    res.emit('finish');
  });
  limite(req, res, next);
  return { res, next };
};

beforeEach(() => jest.clearAllMocks());

describe('ipCliente', () => {
  it('usa el primer valor de X-Forwarded-For, como el resto del backend', () => {
    expect(ipCliente(peticion({ xff: '189.203.4.5, 10.1.2.3' }))).toBe('189.203.4.5');
  });

  it('sin el encabezado usa la dirección de la conexión', () => {
    expect(ipCliente(peticion({ remota: '172.16.0.9' }))).toBe('172.16.0.9');
    expect(ipCliente({ headers: {} })).toBe('desconocida');
  });
});

describe('crearLimiteLogin', () => {
  it('deja pasar los intentos fallidos hasta el máximo y después responde 429 sin llegar al login', () => {
    const limite = crearLimiteLogin({ ventanaMs: 60_000, maximo: 3 });
    for (let i = 0; i < 3; i++) expect(intento(limite, 401).next).toHaveBeenCalled();

    const { res, next } = intento(limite, 401);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({ success: false, code: 'DEMASIADOS_INTENTOS', message: MENSAJE_LIMITE });
    expect(res.encabezados['Retry-After']).toBe('60');
  });

  it('los inicios de sesión correctos no cuentan', () => {
    const limite = crearLimiteLogin({ ventanaMs: 60_000, maximo: 2 });
    for (let i = 0; i < 10; i++) expect(intento(limite, 200).next).toHaveBeenCalled();
    intento(limite, 401);
    expect(intento(limite, 200).next).toHaveBeenCalled();
  });

  it('una ráfaga de peticiones al mismo tiempo se corta aunque todavía no terminen', () => {
    const limite = crearLimiteLogin({ ventanaMs: 60_000, maximo: 5 });
    const pendientes = Array.from({ length: 8 }, () => {
      const res = respuesta();
      const next = jest.fn();
      limite(peticion({ xff: '200.1.1.1' }), res, next);
      return next;
    });
    expect(pendientes.filter((n) => n.mock.calls.length > 0)).toHaveLength(5);
  });

  it('cada IP tiene su propio contador', () => {
    const limite = crearLimiteLogin({ ventanaMs: 60_000, maximo: 1 });
    intento(limite, 401, peticion({ xff: '200.1.1.1' }));
    expect(intento(limite, 401, peticion({ xff: '200.1.1.1' })).next).not.toHaveBeenCalled();
    expect(intento(limite, 401, peticion({ xff: '200.2.2.2' })).next).toHaveBeenCalled();
  });

  it('al terminar la ventana se puede volver a intentar y avisa en el log una sola vez por ventana', () => {
    let t = 0;
    const limite = crearLimiteLogin({ ventanaMs: 60_000, maximo: 1, ahora: () => t });
    intento(limite, 401);
    intento(limite, 401);
    intento(limite, 401);
    expect(logger.warn).toHaveBeenCalledTimes(1);

    t = 45_000;
    expect(intento(limite, 401).res.encabezados['Retry-After']).toBe('15');

    t = 60_000;
    expect(intento(limite, 401).next).toHaveBeenCalled();
  });

  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])(
    'no limita una conexión local directa desde %s (entorno de pruebas)',
    (remota) => {
      const limite = crearLimiteLogin({ ventanaMs: 60_000, maximo: 1 });
      for (let i = 0; i < 5; i++) expect(intento(limite, 401, peticion({ remota })).next).toHaveBeenCalled();
      expect(limite.tamano()).toBe(0);
    }
  );

  it('sí limita si la petición local trae X-Forwarded-For, como las que pasan por el proxy de Render', () => {
    const limite = crearLimiteLogin({ ventanaMs: 60_000, maximo: 1 });
    const req = peticion({ remota: '127.0.0.1', xff: '200.1.1.1' });
    intento(limite, 401, req);
    expect(intento(limite, 401, req).next).not.toHaveBeenCalled();
  });

  it('limpiar borra solo las ventanas vencidas', () => {
    let t = 0;
    const limite = crearLimiteLogin({ ventanaMs: 60_000, maximo: 5, ahora: () => t });
    intento(limite, 401, peticion({ xff: '200.1.1.1' }));
    t = 50_000;
    intento(limite, 401, peticion({ xff: '200.2.2.2' }));
    t = 70_000;
    limite.limpiar();
    expect(limite.tamano()).toBe(1);
  });
});

describe('límite del login en la app', () => {
  it('permite 20 intentos fallidos por IP cada 15 minutos', () => {
    expect(MAXIMO_FALLIDOS_LOGIN).toBe(20);
    expect(VENTANA_LOGIN_MS).toBe(15 * 60 * 1000);
    expect(typeof limiteLogin).toBe('function');
  });
});
