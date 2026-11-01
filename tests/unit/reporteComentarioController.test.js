// Pruebas unitarias de POST /api/blog/comentarios/:id/reportar.
// La base de datos se simula: no se conecta a Neon ni a ninguna base real.
import { jest } from '@jest/globals';

const pool = { query: jest.fn() };

jest.unstable_mockModule('../../src/config/db.js', () => ({ pool }));
jest.unstable_mockModule('../../src/config/logger.js', () => ({
  default: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

const { reportarComentario } = await import('../../src/controllers/reporteComentarioController.js');

function respuesta() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

const peticion = (extra = {}) => ({
  user: { id_usuario: 4, rol: 'cliente' },
  params: { id: '10' },
  ...extra,
});

function base(comentario) {
  pool.query.mockImplementation(async (sql) => {
    if (sql.startsWith('SELECT')) return { rows: comentario ? [comentario] : [] };
    return { rows: [], rowCount: 1 };
  });
}

const updates = () => pool.query.mock.calls.filter(([sql]) => sql.startsWith('UPDATE'));

beforeEach(() => jest.clearAllMocks());

describe('reportarComentario', () => {
  it('sin sesión responde 401', async () => {
    const res = respuesta();
    await reportarComentario(peticion({ user: undefined }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('con un id inválido responde 400', async () => {
    const res = respuesta();
    await reportarComentario(peticion({ params: { id: 'abc' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('si el comentario no existe responde 404', async () => {
    base(null);
    const res = respuesta();
    await reportarComentario(peticion(), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('no deja reportar un comentario propio', async () => {
    base({ id_comentario: 10, id_usuario: 4, estado: 'aprobado' });
    const res = respuesta();
    await reportarComentario(peticion(), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(updates()).toHaveLength(0);
  });

  it('un comentario aprobado pasa a revisión (pendiente) y se oculta', async () => {
    base({ id_comentario: 10, id_usuario: 7, estado: 'aprobado' });
    const res = respuesta();
    await reportarComentario(peticion(), res);
    expect(updates()).toHaveLength(1);
    expect(updates()[0][0]).toContain("estado = 'pendiente'");
    expect(updates()[0][1]).toEqual([10]);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('si ya estaba en revisión no cambia nada y responde bien', async () => {
    base({ id_comentario: 10, id_usuario: 7, estado: 'pendiente' });
    const res = respuesta();
    await reportarComentario(peticion(), res);
    expect(updates()).toHaveLength(0);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('si falla la base responde 500', async () => {
    pool.query.mockRejectedValue(new Error('sin conexión'));
    const res = respuesta();
    await reportarComentario(peticion(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
