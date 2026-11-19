// Pruebas del límite de concurrencia de bcrypt (plan de mejora del rendimiento).
// bcrypt se simula: las pruebas controlan cuándo termina cada comparación.
import { jest } from '@jest/globals';

const compare = jest.fn();
const hash = jest.fn();
jest.unstable_mockModule('bcrypt', () => ({ default: { compare, hash } }));

const { default: bcryptLimitado, crearLimitador, MAXIMO_BCRYPT } = await import(
  '../../src/services/bcryptLimitado.js'
);

// Tarea que no termina hasta que la prueba llama a terminar() o fallar().
const pendiente = () => {
  const tarea = {};
  tarea.promesa = new Promise((resolve, reject) => {
    tarea.terminar = resolve;
    tarea.fallar = reject;
  });
  return tarea;
};

// Deja correr las promesas que ya están listas.
const avanzar = () => new Promise((r) => setImmediate(r));

beforeEach(() => jest.clearAllMocks());

describe('crearLimitador', () => {
  it('nunca corre más tareas que el máximo y atiende la fila en orden', async () => {
    const limitar = crearLimitador(2);
    const tareas = Array.from({ length: 5 }, pendiente);
    const iniciadas = [];
    let corriendo = 0;
    let maximoVisto = 0;

    const resultados = tareas.map((t, i) =>
      limitar(async () => {
        iniciadas.push(i);
        corriendo++;
        maximoVisto = Math.max(maximoVisto, corriendo);
        const valor = await t.promesa;
        corriendo--;
        return valor;
      })
    );

    await avanzar();
    expect(iniciadas).toEqual([0, 1]);

    tareas[1].terminar('b');
    await avanzar();
    expect(iniciadas).toEqual([0, 1, 2]);

    tareas[0].terminar('a');
    tareas[2].terminar('c');
    await avanzar();
    tareas[3].terminar('d');
    tareas[4].terminar('e');

    await expect(Promise.all(resultados)).resolves.toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(iniciadas).toEqual([0, 1, 2, 3, 4]);
    expect(maximoVisto).toBe(2);
  });

  it('si una tarea falla, devuelve el error y libera su lugar', async () => {
    const limitar = crearLimitador(1);
    const primera = pendiente();
    const fallida = limitar(() => primera.promesa);
    const segunda = limitar(async () => 'ok');

    primera.fallar(new Error('hash inválido'));

    await expect(fallida).rejects.toThrow('hash inválido');
    await expect(segunda).resolves.toBe('ok');
  });

  it('quien llega justo cuando se libera un lugar no se brinca la fila', async () => {
    const limitar = crearLimitador(1);
    const primera = pendiente();
    const orden = [];
    const a = limitar(async () => {
      await primera.promesa;
      orden.push('a');
    });
    const b = limitar(async () => orden.push('b'));

    primera.terminar();
    const c = limitar(async () => orden.push('c'));

    await Promise.all([a, b, c]);
    expect(orden).toEqual(['a', 'b', 'c']);
  });
});

describe('bcrypt con límite', () => {
  it('deja 1 de los 4 hilos de Node libre para abrir conexiones a la base', () => {
    expect(MAXIMO_BCRYPT).toBe(3);
  });

  it('compare y hash llaman a bcrypt con los mismos datos y regresan su resultado', async () => {
    compare.mockResolvedValueOnce(true);
    hash.mockResolvedValueOnce('$2b$12$hash');

    await expect(bcryptLimitado.compare('Clave#1', '$2b$12$x')).resolves.toBe(true);
    await expect(bcryptLimitado.hash('Clave#1', 12)).resolves.toBe('$2b$12$hash');
    expect(compare).toHaveBeenCalledWith('Clave#1', '$2b$12$x');
    expect(hash).toHaveBeenCalledWith('Clave#1', 12);
  });

  it('con 6 logins a la vez, solo 3 comparan contraseña al mismo tiempo', async () => {
    const tareas = Array.from({ length: 6 }, pendiente);
    let i = 0;
    compare.mockImplementation(() => tareas[i++].promesa);

    const logins = tareas.map(() => bcryptLimitado.compare('Clave#1', '$2b$12$x'));
    await avanzar();
    expect(compare).toHaveBeenCalledTimes(3);

    tareas.forEach((t) => t.terminar(true));
    await expect(Promise.all(logins)).resolves.toEqual([true, true, true, true, true, true]);
    expect(compare).toHaveBeenCalledTimes(6);
  });
});
