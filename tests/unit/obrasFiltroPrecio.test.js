// Pruebas unitarias del filtro de precio de GET /api/obras.
// Bug: con precio_min/precio_max, las obras sin tamaños (obras_tamaños) nunca aparecían,
// aunque su precio_base estuviera dentro del rango (encontrado en el caso CP-01-04 de la app).
// La base de datos se simula: no se conecta a Neon ni a ninguna base real.
import { jest } from '@jest/globals';

const query = jest.fn();

jest.unstable_mockModule('../../src/config/db.js', () => ({
  pool: { query },
  pools: {},
}));
jest.unstable_mockModule('../../src/config/logger.js', () => ({
  default: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));
jest.unstable_mockModule('../../src/services/emailService.js', () => ({
  sendObraAprobadaEmail: jest.fn(),
  sendObraRechazadaEmail: jest.fn(),
}));

const { condicionPrecio, listarObras } = await import('../../src/controllers/obrasController.js');

const plano = (sql) => sql.replace(/\s+/g, ' ').trim();

function respuesta() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

beforeEach(() => {
  query.mockReset();
  query
    .mockResolvedValueOnce({ rows: [] }) // listado
    .mockResolvedValueOnce({ rows: [{ total: '0' }] }); // conteo
});

describe('condicionPrecio', () => {
  it('con mínimo y máximo revisa los tamaños y, si no hay, el precio_base de la obra', () => {
    const { sql, params } = condicionPrecio('2150', '5000', 3);
    const s = plano(sql);

    expect(params).toEqual(['2150', '5000']);
    expect(s).toContain('EXISTS (SELECT 1 FROM obras_tamaños tam WHERE tam.id_obra = o.id_obra AND tam.activo = TRUE AND tam.precio_base >= $3 AND tam.precio_base <= $4)');
    expect(s).toContain('NOT EXISTS (SELECT 1 FROM obras_tamaños tam WHERE tam.id_obra = o.id_obra AND tam.activo = TRUE) AND o.precio_base >= $3 AND o.precio_base <= $4');
  });

  it('solo con mínimo usa un parámetro', () => {
    const { sql, params } = condicionPrecio('2150', undefined, 1);
    const s = plano(sql);

    expect(params).toEqual(['2150']);
    expect(s).toContain('tam.precio_base >= $1)');
    expect(s).toContain('AND o.precio_base >= $1 )');
    expect(s).not.toContain('<=');
  });

  it('solo con máximo usa un parámetro', () => {
    const { sql, params } = condicionPrecio(undefined, '3000', 2);
    const s = plano(sql);

    expect(params).toEqual(['3000']);
    expect(s).toContain('tam.precio_base <= $2)');
    expect(s).toContain('AND o.precio_base <= $2 )');
    expect(s).not.toContain('>=');
  });
});

describe('listarObras con filtro de precio', () => {
  it('combina categoría y precio con los parámetros en orden', async () => {
    const req = { query: { categoria: '7', precio_min: '2150' } };
    await listarObras(req, respuesta());

    const [sql, params] = query.mock.calls[0];
    // categoria = $1, precio_min = $2; LIMIT y OFFSET al final.
    expect(params).toEqual(['7', '2150', 12, 0]);
    expect(plano(sql)).toContain('o.id_categoria = $1');
    expect(plano(sql)).toContain('o.precio_base >= $2');
    expect(plano(sql)).toContain('LIMIT $3 OFFSET $4');
  });

  it('el conteo usa el mismo filtro sin LIMIT ni OFFSET', async () => {
    await listarObras({ query: { precio_min: '500', precio_max: '3000' } }, respuesta());

    const [sqlConteo, paramsConteo] = query.mock.calls[1];
    expect(paramsConteo).toEqual(['500', '3000']);
    expect(plano(sqlConteo)).toContain('o.precio_base >= $1 AND o.precio_base <= $2');
  });

  it('sin filtro de precio no agrega la condición', async () => {
    await listarObras({ query: {} }, respuesta());
    expect(query.mock.calls[0][0]).not.toContain('tam.precio_base');
  });
});
