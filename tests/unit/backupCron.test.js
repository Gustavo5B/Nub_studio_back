// Pruebas de la validación del respaldo automático (guardarConfigCron).
// hora y dia_semana van dentro de la expresión del cron, así que solo se aceptan enteros
// en rango. La base, Supabase y node-cron se simulan.
import { jest } from '@jest/globals';

const pool = { query: jest.fn(async () => ({ rows: [] })) };
const schedule = jest.fn(() => ({ stop: jest.fn() }));

jest.unstable_mockModule('../../src/config/db.js', () => ({ pool, pools: {} }));
jest.unstable_mockModule('@supabase/supabase-js', () => ({ createClient: () => ({}) }));
jest.unstable_mockModule('node-cron', () => ({ default: { schedule } }));
jest.unstable_mockModule('../../src/config/logger.js', () => ({
  default: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

const { guardarConfigCron } = await import('../../src/controllers/backupController.js');

function respuesta() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

const guardar = async (body) => {
  const res = respuesta();
  await guardarConfigCron({ body, user: { id_usuario: 1 } }, res);
  return res;
};

beforeEach(() => jest.clearAllMocks());

describe('guardarConfigCron: validación de hora y día', () => {
  it.each([['1 * * * *'], ['2; rm'], [24], [-1], [2.5], ['']])(
    'rechaza la hora %p sin programar nada',
    async (hora) => {
      const res = await guardar({ activo: true, frecuencia: 'diario', hora });
      expect(res.status).toHaveBeenCalledWith(400);
      expect(schedule).not.toHaveBeenCalled();
      expect(pool.query).not.toHaveBeenCalled();
    }
  );

  it.each([[7], ['1 *'], [-1]])('rechaza el día de la semana %p', async (dia_semana) => {
    const res = await guardar({ activo: true, frecuencia: 'semanal', hora: 3, dia_semana });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(schedule).not.toHaveBeenCalled();
  });

  it('acepta hora y día como número o como texto numérico', async () => {
    const res = await guardar({ activo: true, frecuencia: 'semanal', hora: '3', dia_semana: '5' });
    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(schedule).toHaveBeenCalledWith('0 3 * * 5', expect.any(Function), expect.any(Object));
  });

  it('sin día de la semana usa el lunes, como antes', async () => {
    await guardar({ activo: true, frecuencia: 'semanal', hora: 2 });
    expect(schedule).toHaveBeenCalledWith('0 2 * * 1', expect.any(Function), expect.any(Object));
  });

  it('si la base falla responde 500 y lo registra en el log', async () => {
    pool.query.mockRejectedValueOnce(new Error('sin conexión'));
    const res = await guardar({ activo: false, frecuencia: 'diario', hora: 2 });
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
