import { pool, pools } from '../config/db.js';
import logger from '../config/logger.js';

// =========================================================
// GET /api/colecciones
// Lista colecciones públicas publicadas
// =========================================================
export const listarColecciones = async (req, res) => {
  try {
    const db = pools[req.user?.rol] || pool;
    const { id_artista, page = 1, limit = 12 } = req.query;
    const offset = (Number.parseInt(page) - 1) * Number.parseInt(limit);

    let whereConditions = ["c.activa = TRUE AND c.eliminada = FALSE AND c.estado = 'publicada'"];
    const params = [];
    let paramCount = 1;

    if (id_artista) {
      whereConditions.push(`c.id_artista = $${paramCount}`);
      params.push(Number.parseInt(id_artista));
      paramCount++;
    }

    const where = whereConditions.join(' AND ');

    const result = await db.query(`
      SELECT
        c.id_coleccion, c.nombre, c.slug, c.historia,
        c.imagen_portada, c.destacada, c.fecha_creacion,
        a.nombre_artistico AS artista_alias, a.foto_perfil AS artista_foto,
        COUNT(o.id_obra) AS total_obras
      FROM colecciones c
      INNER JOIN artistas a ON c.id_artista = a.id_artista
      LEFT JOIN obras o ON o.id_coleccion = c.id_coleccion
        AND o.activa = TRUE AND o.eliminada = FALSE
      WHERE ${where}
      GROUP BY c.id_coleccion, a.nombre_artistico, a.foto_perfil
      ORDER BY c.destacada DESC, c.fecha_creacion DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `, [...params, Number.parseInt(limit), offset]);

    const countResult = await db.query(
      `SELECT COUNT(*) AS total FROM colecciones c WHERE ${where}`,
      params
    );

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        page: Number.parseInt(page),
        limit: Number.parseInt(limit),
        total: Number.parseInt(countResult.rows[0].total),
        totalPages: Math.ceil(countResult.rows[0].total / limit),
      },
    });
  } catch (error) {
    logger.error(`Error en listarColecciones: ${error.message}`);
    res.status(500).json({ message: 'Error al obtener las colecciones' });
  }
};

// =========================================================
// GET /api/colecciones/:slug
// Detalle público de una colección con sus obras
// =========================================================
export const obtenerColeccionPorSlug = async (req, res) => {
  try {
    const db = pools[req.user?.rol] || pool;
    const { slug } = req.params;

    const colResult = await db.query(`
      SELECT
        c.id_coleccion, c.nombre, c.slug, c.historia,
        c.imagen_portada, c.destacada, c.estado, c.fecha_creacion,
        a.id_artista, a.nombre_completo AS artista_nombre,
        a.nombre_artistico AS artista_alias, a.foto_perfil AS artista_foto
      FROM colecciones c
      INNER JOIN artistas a ON c.id_artista = a.id_artista
      WHERE c.slug = $1 AND c.activa = TRUE AND c.eliminada = FALSE
      LIMIT 1
    `, [slug]);

    if (colResult.rows.length === 0)
      return res.status(404).json({ message: 'Colección no encontrada' });

    const coleccion = colResult.rows[0];

    const obrasResult = await db.query(`
      SELECT
        o.id_obra, o.titulo, o.slug, o.imagen_principal,
        o.precio_base, o.estado, o.activa,
        MIN(ot.precio_base) AS precio_minimo
      FROM obras o
      LEFT JOIN obras_tamaños ot ON ot.id_obra = o.id_obra AND ot.activo = TRUE
      WHERE o.id_coleccion = $1 AND o.activa = TRUE AND o.eliminada = FALSE
      GROUP BY o.id_obra
      ORDER BY o.fecha_creacion DESC
    `, [coleccion.id_coleccion]);

    res.json({ success: true, data: { ...coleccion, obras: obrasResult.rows } });
  } catch (error) {
    logger.error(`Error en obtenerColeccionPorSlug: ${error.message}`);
    res.status(500).json({ message: 'Error al obtener la colección' });
  }
};

// =========================================================
// GET /api/artista-portal/colecciones
// Lista colecciones del artista autenticado (todas, incluso borradores)
// =========================================================
export const getMisColecciones = async (req, res) => {
  try {
    const db = pools[req.user.rol] || pool;
    const usuarioId = req.user.id_usuario;

    const artistaRes = await db.query(
      'SELECT id_artista FROM artistas WHERE id_usuario = $1 AND estado = $2 LIMIT 1',
      [usuarioId, 'activo']
    );
    if (artistaRes.rows.length === 0)
      return res.status(403).json({ message: 'Artista no encontrado o inactivo' });

    const { id_artista } = artistaRes.rows[0];

    const result = await db.query(`
      SELECT
        c.id_coleccion, c.nombre, c.slug, c.historia,
        c.imagen_portada, c.estado, c.destacada, c.fecha_creacion,
        COUNT(o.id_obra) AS total_obras
      FROM colecciones c
      LEFT JOIN obras o ON o.id_coleccion = c.id_coleccion
        AND o.activa = TRUE AND o.eliminada = FALSE
      WHERE c.id_artista = $1 AND c.activa = TRUE AND c.eliminada = FALSE
      GROUP BY c.id_coleccion
      ORDER BY c.fecha_creacion DESC
    `, [id_artista]);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error(`Error en getMisColecciones: ${error.message}`);
    res.status(500).json({ message: 'Error al obtener las colecciones' });
  }
};

// =========================================================
// POST /api/artista-portal/colecciones
// Crear colección
// =========================================================
export const crearColeccion = async (req, res) => {
  try {
    const db = pools[req.user.rol] || pool;
    const usuarioId = req.user.id_usuario;

    const artistaRes = await db.query(
      'SELECT id_artista FROM artistas WHERE id_usuario = $1 AND estado = $2 LIMIT 1',
      [usuarioId, 'activo']
    );
    if (artistaRes.rows.length === 0)
      return res.status(403).json({ message: 'Artista no encontrado o inactivo' });

    const { id_artista } = artistaRes.rows[0];
    const { nombre, historia } = req.body;

    if (!nombre?.trim())
      return res.status(400).json({ message: 'El nombre de la colección es requerido' });

    const slugBase = nombre.toLowerCase()
      .normalize('NFD').replaceAll(/[\u0300-\u036f]/g, '')
      .replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/(^-|-$)/g, '');
    const slug = `${slugBase}-${Date.now()}`;

    let imagen_portada = null;
    if (req.file) {
      const { cloudinary } = await import('../config/cloudinaryConfig.js');
      const uploadResult = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: 'nub_studio/colecciones', resource_type: 'image', quality: 'auto:good', fetch_format: 'auto' },
          (error, result) => { if (error) reject(new Error(error.message)); else resolve(result); }
        );
        stream.end(req.file.buffer);
      });
      imagen_portada = uploadResult.secure_url;
    }

    const result = await db.query(`
      INSERT INTO colecciones (id_artista, nombre, slug, historia, imagen_portada, estado)
      VALUES ($1, $2, $3, $4, $5, 'borrador')
      RETURNING id_coleccion, nombre, slug, historia, imagen_portada, estado, fecha_creacion
    `, [id_artista, nombre.trim(), slug, historia || null, imagen_portada]);

    logger.info(`Colección creada: ${nombre} (id: ${result.rows[0].id_coleccion})`);
    res.status(201).json({ success: true, message: 'Colección creada correctamente', data: result.rows[0] });
  } catch (error) {
    logger.error(`Error en crearColeccion: ${error.message}`);
    res.status(500).json({ message: 'Error al crear la colección' });
  }
};

// =========================================================
// PUT /api/artista-portal/colecciones/:id
// Editar colección
// =========================================================
export const actualizarColeccion = async (req, res) => {
  try {
    const db = pools[req.user.rol] || pool;
    const usuarioId = req.user.id_usuario;
    const { id } = req.params;

    const artistaRes = await db.query(
      'SELECT id_artista FROM artistas WHERE id_usuario = $1 AND estado = $2 LIMIT 1',
      [usuarioId, 'activo']
    );
    if (artistaRes.rows.length === 0)
      return res.status(403).json({ message: 'Artista no encontrado o inactivo' });

    const { id_artista } = artistaRes.rows[0];

    const colCheck = await db.query(
      'SELECT id_coleccion FROM colecciones WHERE id_coleccion = $1 AND id_artista = $2 AND activa = TRUE AND eliminada = FALSE LIMIT 1',
      [id, id_artista]
    );
    if (colCheck.rows.length === 0)
      return res.status(404).json({ message: 'Colección no encontrada' });

    const { nombre, historia, estado } = req.body;

    let imagen_portada = req.body.imagen_portada || null;
    if (req.file) {
      const { cloudinary } = await import('../config/cloudinaryConfig.js');
      const uploadResult = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: 'nub_studio/colecciones', resource_type: 'image', quality: 'auto:good', fetch_format: 'auto' },
          (error, result) => { if (error) reject(new Error(error.message)); else resolve(result); }
        );
        stream.end(req.file.buffer);
      });
      imagen_portada = uploadResult.secure_url;
    }

    await db.query(`
      UPDATE colecciones SET
        nombre              = COALESCE($1, nombre),
        historia            = COALESCE($2, historia),
        imagen_portada      = COALESCE($3, imagen_portada),
        estado              = COALESCE($4, estado),
        fecha_actualizacion = NOW()
      WHERE id_coleccion = $5
    `, [nombre?.trim() || null, historia || null, imagen_portada, estado || null, id]);

    logger.info(`Colección actualizada: id ${id}`);
    res.json({ success: true, message: 'Colección actualizada correctamente' });
  } catch (error) {
    logger.error(`Error en actualizarColeccion: ${error.message}`);
    res.status(500).json({ message: 'Error al actualizar la colección' });
  }
};

// =========================================================
// GET /api/admin/colecciones
// Lista todas las colecciones (admin)
// =========================================================
export const listarColeccionesAdmin = async (req, res) => {
  try {
    const { estado, id_artista, page = 1, limit = 20 } = req.query;
    const offset = (Number.parseInt(page) - 1) * Number.parseInt(limit);

    const whereConditions = ['c.eliminada = FALSE'];
    const params = [];
    let paramCount = 1;

    if (estado) {
      whereConditions.push(`c.estado = $${paramCount}`);
      params.push(estado);
      paramCount++;
    }

    if (id_artista) {
      whereConditions.push(`c.id_artista = $${paramCount}`);
      params.push(Number.parseInt(id_artista));
      paramCount++;
    }

    const where = whereConditions.join(' AND ');

    const result = await pool.query(`
      SELECT
        c.id_coleccion, c.nombre, c.slug, c.estado, c.destacada,
        c.imagen_portada, c.fecha_creacion, c.activa,
        a.id_artista, a.nombre_artistico AS artista_alias,
        a.nombre_completo AS artista_nombre,
        COUNT(o.id_obra) AS total_obras
      FROM colecciones c
      INNER JOIN artistas a ON c.id_artista = a.id_artista
      LEFT JOIN obras o ON o.id_coleccion = c.id_coleccion
        AND o.activa = TRUE AND o.eliminada = FALSE
      WHERE ${where}
      GROUP BY c.id_coleccion, a.id_artista, a.nombre_artistico, a.nombre_completo
      ORDER BY c.fecha_creacion DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `, [...params, Number.parseInt(limit), offset]);

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM colecciones c WHERE ${where}`,
      params
    );

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        page: Number.parseInt(page),
        limit: Number.parseInt(limit),
        total: Number.parseInt(countResult.rows[0].total),
        totalPages: Math.ceil(countResult.rows[0].total / Number.parseInt(limit)),
      },
    });
  } catch (error) {
    logger.error(`Error en listarColeccionesAdmin: ${error.message}`);
    res.status(500).json({ message: 'Error al obtener las colecciones' });
  }
};

// =========================================================
// PUT /api/admin/colecciones/:id
// Cambiar estado o destacada (admin)
// =========================================================
export const actualizarColeccionAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { estado, destacada } = req.body;

    const colCheck = await pool.query(
      'SELECT id_coleccion FROM colecciones WHERE id_coleccion = $1 AND eliminada = FALSE LIMIT 1',
      [id]
    );
    if (colCheck.rows.length === 0)
      return res.status(404).json({ message: 'Colección no encontrada' });

    const updates = [];
    const params = [];
    let paramCount = 1;

    if (estado !== undefined) {
      updates.push(`estado = $${paramCount}`);
      params.push(estado);
      paramCount++;
    }

    if (destacada !== undefined) {
      updates.push(`destacada = $${paramCount}`);
      params.push(destacada);
      paramCount++;
    }

    if (updates.length === 0)
      return res.status(400).json({ message: 'No hay cambios para aplicar' });

    // Límite: máximo 3 colecciones destacadas por artista
    if (destacada === true) {
      const artistaRes = await pool.query(
        'SELECT id_artista FROM colecciones WHERE id_coleccion = $1 LIMIT 1', [id]
      );
      const idArtista = artistaRes.rows[0]?.id_artista;
      if (idArtista) {
        const countRes = await pool.query(
          'SELECT COUNT(*) AS total FROM colecciones WHERE id_artista = $1 AND destacada = TRUE AND eliminada = FALSE AND id_coleccion != $2',
          [idArtista, id]
        );
        if (Number.parseInt(countRes.rows[0].total) >= 3)
          return res.status(400).json({ message: 'Este artista ya tiene 3 colecciones destacadas. Quita el destacado de una antes de destacar otra.' });
      }
    }

    updates.push('fecha_actualizacion = NOW()');
    params.push(id);

    await pool.query(
      `UPDATE colecciones SET ${updates.join(', ')} WHERE id_coleccion = $${paramCount}`,
      params
    );

    logger.info(`Colección ${id} actualizada por admin`);
    res.json({ success: true, message: 'Colección actualizada correctamente' });
  } catch (error) {
    logger.error(`Error en actualizarColeccionAdmin: ${error.message}`);
    res.status(500).json({ message: 'Error al actualizar la colección' });
  }
};

// =========================================================
// DELETE /api/artista-portal/colecciones/:id
// Eliminar colección (soft delete, desvincula obras)
// =========================================================
export const eliminarColeccion = async (req, res) => {
  try {
    const db = pools[req.user.rol] || pool;
    const usuarioId = req.user.id_usuario;
    const { id } = req.params;

    const artistaRes = await db.query(
      'SELECT id_artista FROM artistas WHERE id_usuario = $1 AND estado = $2 LIMIT 1',
      [usuarioId, 'activo']
    );
    if (artistaRes.rows.length === 0)
      return res.status(403).json({ message: 'Artista no encontrado o inactivo' });

    const { id_artista } = artistaRes.rows[0];

    const colCheck = await db.query(
      'SELECT id_coleccion FROM colecciones WHERE id_coleccion = $1 AND id_artista = $2 AND activa = TRUE AND eliminada = FALSE LIMIT 1',
      [id, id_artista]
    );
    if (colCheck.rows.length === 0)
      return res.status(404).json({ message: 'Colección no encontrada' });

    // Desvincular obras antes de eliminar
    await db.query('UPDATE obras SET id_coleccion = NULL WHERE id_coleccion = $1', [id]);

    await db.query(
      'UPDATE colecciones SET activa = FALSE, eliminada = TRUE, fecha_eliminacion = NOW() WHERE id_coleccion = $1',
      [id]
    );

    logger.info(`Colección eliminada: id ${id}`);
    res.json({ success: true, message: 'Colección eliminada. Las obras quedaron sin colección asignada.' });
  } catch (error) {
    logger.error(`Error en eliminarColeccion: ${error.message}`);
    res.status(500).json({ message: 'Error al eliminar la colección' });
  }
};
