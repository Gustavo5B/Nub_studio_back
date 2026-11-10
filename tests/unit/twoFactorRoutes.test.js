// Las rutas de 2FA escriben con el logger (limpieza contra inyección en logs) y pasan
// cada petición a su controlador. Los controladores y el logger se simulan.
import { jest } from '@jest/globals';

const logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };
const setupTOTP = jest.fn();
const verifyTOTP = jest.fn();
const validateTOTP = jest.fn();

jest.unstable_mockModule('../../src/config/logger.js', () => ({ default: logger }));
jest.unstable_mockModule('../../src/controllers/twoFactorController.js', () => ({
  setupTOTP,
  verifyTOTP,
  validateTOTP,
}));

const { default: router } = await import('../../src/routes/twoFactorRoutes.js');

const capas = router.stack;
const ruta = (path) => capas.find((capa) => capa.route?.path === path).route.stack[0].handle;

beforeEach(() => jest.clearAllMocks());

describe('twoFactorRoutes', () => {
  it('registra cada petición con el logger, no con console.log', () => {
    const middleware = capas.find((capa) => !capa.route).handle;
    const next = jest.fn();
    middleware({ method: 'POST', path: '/verify-totp\nfalso' }, {}, next);
    expect(logger.debug).toHaveBeenCalledWith('🔍 [2FA] POST /verify-totp\nfalso');
    expect(next).toHaveBeenCalled();
  });

  it.each([
    ['/setup-totp', setupTOTP],
    ['/verify-totp', verifyTOTP],
    ['/validate-totp', validateTOTP],
  ])('%s llama a su controlador', (path, controlador) => {
    const req = {};
    const res = {};
    const next = jest.fn();
    ruta(path)(req, res, next);
    expect(controlador).toHaveBeenCalledWith(req, res, next);
  });
});
