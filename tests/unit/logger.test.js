// Pruebas de la protección contra inyección en logs (CWE-117, regla S5145 de SonarCloud).
// winston se simula: no se escribe ningún archivo de log durante las pruebas.
import { jest } from '@jest/globals';

const base = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
const formato = () => ({});
jest.unstable_mockModule('winston', () => ({
  createLogger: () => base,
  format: { combine: formato, timestamp: formato, printf: formato, colorize: formato },
  transports: { Console: jest.fn(), File: jest.fn() },
}));

const { default: logger, limpiarParaLog } = await import('../../src/config/logger.js');

beforeEach(() => jest.clearAllMocks());

describe('limpiarParaLog', () => {
  it('cambia los saltos de línea por espacios para que no se puedan falsificar líneas', () => {
    const correo = 'ana@correo.mx\n2026-11-10 09:00:00 [info]: Login exitoso admin';
    expect(limpiarParaLog(`Intento de login: ${correo}`)).toBe(
      'Intento de login: ana@correo.mx 2026-11-10 09:00:00 [info]: Login exitoso admin'
    );
    expect(limpiarParaLog('a\r\nb')).toBe('a  b');
  });

  it('quita los demás caracteres de control y deja el texto normal', () => {
    expect(limpiarParaLog('obra\u0000\u001b[31m roja\u007f')).toBe('obra[31m roja');
    expect(limpiarParaLog('Galería "Huasteca" #12 — ñ')).toBe('Galería "Huasteca" #12 — ñ');
  });

  it('convierte a texto lo que no es texto', () => {
    expect(limpiarParaLog(404)).toBe('404');
    expect(limpiarParaLog(undefined)).toBe('undefined');
  });
});

describe('logger', () => {
  it.each(['error', 'warn', 'info', 'debug'])('limpia el mensaje antes de escribirlo (%s)', (nivel) => {
    logger[nivel]('Título: Obra\nfalsa');
    expect(base[nivel]).toHaveBeenCalledWith('Título: Obra falsa');
  });

  it('agrega al mensaje los valores extra, que antes se perdían', () => {
    logger.error('crearDireccion:', new Error('violates\nconstraint'), { id: 4 });
    expect(base.error).toHaveBeenCalledWith('crearDireccion: violates constraint {"id":4}');
  });

  it('no falla con un objeto que no se puede convertir a JSON', () => {
    const circular = {};
    circular.yo = circular;
    logger.warn('dato:', circular);
    expect(base.warn).toHaveBeenCalledWith('dato: [objeto]');
  });
});
