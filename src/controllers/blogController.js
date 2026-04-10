import { pool, pools } from "../config/db.js";
import logger from "../config/logger.js";

// =========================================================
// HELPERS INTERNOS
// =========================================================

const contienepalabrasProhibidas = async (db, texto) => {
  const result = await db.query(
    'SELECT palabra FROM palabras_prohibidas WHERE activa = true'
  );
  const textoLower = texto.toLowerCase();
  return result.rows.some(r => textoLower.includes(r.palabra.toLowerCase()));
};

const generarSlug = async (db, titulo) => {
  let slug = titulo
    .toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const existe = await db.query(
    'SELECT id_post FROM blog_posts WHERE slug = $1 LIMIT 1', [slug]
  );
  if (existe.rows.length > 0) slug = `${slug}-${Date.now()}`;
  return slug;
};

// =========================================================
// ADMIN — LISTAR TODOS LOS POSTS (incluye borradores)
// GET /api/blog/admin/posts
// =========================================================
export const listarTodosPostsAdmin = async (req, res) => {
  try {
    const db = pools[req.user?.rol] || pool;
    const { page = 1, limit = 20, estado, autor_rol } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const conditions = ['bp.eliminado = false'];
    const params = [];

    if (estado) {
      params.push(estado);
      conditions.push(`bp.estado = $${params.length}`);
    }
    if (autor_rol) {
      params.push(autor_rol);
      conditions.push(`bp.autor_rol = $${params.length}`);
    }

    const whereClause = conditions.join(' AND ');
    const limitN  = params.length + 1;
    const offsetN = params.length + 2;

    const result = await db.query(`
      SELECT
        bp.id_post, bp.titulo, bp.slug, bp.estado, bp.activo,
        bp.autor_rol, bp.vistas, bp.fecha_creacion, bp.fecha_publicacion,
        CASE bp.autor_rol
          WHEN 'artista' THEN a.nombre_artistico
          ELSE u.nombre_completo
        END AS autor_nombre,
        COUNT(bc.id_comentario) FILTER (
          WHERE bc.estado = 'pendiente' AND bc.eliminado = false
        ) AS comentarios_pendientes
      FROM blog_posts bp
      JOIN usuarios u ON bp.autor_id = u.id_usuario
      LEFT JOIN artistas a ON bp.autor_rol = 'artista' AND a.id_usuario = bp.autor_id
      LEFT JOIN blog_comentarios bc ON bc.id_post = bp.id_post
      WHERE ${whereClause}
      GROUP BY bp.id_post, u.nombre_completo, a.nombre_artistico
      ORDER BY bp.fecha_creacion DESC
      LIMIT $${limitN} OFFSET $${offsetN}
    `, [...params, parseInt(limit), offset]);

    const countResult = await db.query(
      `SELECT COUNT(*) AS total FROM blog_posts bp WHERE ${whereClause}`,
      params
    );

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].total),
        totalPages: Math.ceil(parseInt(countResult.rows[0].total) / parseInt(limit))
      }
    });
  } catch (error) {
    logger.error(`Error listarTodosPostsAdmin: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error al obtener los posts' });
  }
};

// =========================================================
// ADMIN — CAMBIAR ESTADO DE CUALQUIER POST
// PATCH /api/blog/admin/posts/:id/estado
// Body: estado ('borrador' | 'publicado' | 'oculto')
// =========================================================
export const cambiarEstadoPost = async (req, res) => {
  try {
    const db = pools[req.user?.rol] || pool;
    const { id } = req.params;
    const { estado } = req.body;

    const estadosValidos = ['borrador', 'publicado', 'oculto'];
    if (!estadosValidos.includes(estado))
      return res.status(400).json({
        success: false,
        message: `Estado inválido. Valores permitidos: ${estadosValidos.join(', ')}`
      });

    const fecha_publicacion = estado === 'publicado' ? new Date() : null;
    const activo = estado === 'publicado';

    const result = await db.query(`
      UPDATE blog_posts SET
        estado = $1, activo = $2, fecha_publicacion = $3,
        fecha_actualizacion = NOW()
      WHERE id_post = $4 AND eliminado = false
      RETURNING id_post, titulo, estado, activo
    `, [estado, activo, fecha_publicacion, id]);

    if (result.rows.length === 0)
      return res.status(404).json({ success: false, message: 'Post no encontrado' });

    logger.info(`Estado post ${id} → '${estado}' por admin ${req.user.id_usuario}`);
    res.json({ success: true, message: `Post ${estado} correctamente`, data: result.rows[0] });
  } catch (error) {
    logger.error(`Error cambiarEstadoPost ${req.params.id}: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error al cambiar el estado del post' });
  }
};

// =========================================================
// ADMIN — ELIMINAR CUALQUIER COMENTARIO (soft delete)
// DELETE /api/blog/admin/comentarios/:id
// =========================================================
export const eliminarComentarioAdmin = async (req, res) => {
  try {
    const db = pools[req.user?.rol] || pool;
    const { id } = req.params;

    const result = await db.query(
      'SELECT id_comentario FROM blog_comentarios WHERE id_comentario = $1 AND eliminado = false LIMIT 1',
      [id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ success: false, message: 'Comentario no encontrado' });

    await db.query(`
      UPDATE blog_comentarios SET
        eliminado = true,
        eliminado_por = $1,
        fecha_eliminacion = NOW(),
        fecha_actualizacion = NOW()
      WHERE id_comentario = $2
    `, [req.user.id_usuario, id]);

    logger.info(`Comentario ${id} eliminado por admin ${req.user.id_usuario}`);
    res.json({ success: true, message: 'Comentario eliminado correctamente' });
  } catch (error) {
    logger.error(`Error eliminarComentarioAdmin ${req.params.id}: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error al eliminar el comentario' });
  }
};

// =========================================================
// ADMIN — COLA DE COMENTARIOS PENDIENTES
// GET /api/blog/admin/comentarios/pendientes
// =========================================================
export const listarComentariosPendientes = async (req, res) => {
  try {
    const db = pools[req.user?.rol] || pool;
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const result = await db.query(`
      SELECT
        bc.id_comentario, bc.id_post, bc.padre_id, bc.nivel,
        bc.contenido, bc.imagen_url, bc.fecha_creacion,
        bp.titulo AS post_titulo, bp.slug AS post_slug,
        CASE u.rol
          WHEN 'artista' THEN a.nombre_artistico
          ELSE u.nombre_completo
        END AS autor_nombre,
        u.rol AS usuario_rol
      FROM blog_comentarios bc
      JOIN blog_posts bp ON bc.id_post = bp.id_post
      JOIN usuarios u ON bc.id_usuario = u.id_usuario
      LEFT JOIN artistas a ON u.rol = 'artista' AND a.id_usuario = u.id_usuario
      WHERE bc.estado = 'pendiente' AND bc.eliminado = false
      ORDER BY bc.fecha_creacion ASC
      LIMIT $1 OFFSET $2
    `, [parseInt(limit), offset]);

    const countResult = await db.query(
      `SELECT COUNT(*) AS total FROM blog_comentarios WHERE estado = 'pendiente' AND eliminado = false`
    );

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].total),
        totalPages: Math.ceil(parseInt(countResult.rows[0].total) / parseInt(limit))
      }
    });
  } catch (error) {
    logger.error(`Error listarComentariosPendientes: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error al obtener comentarios pendientes' });
  }
};

// =========================================================
// ADMIN — MODERAR COMENTARIO
// PATCH /api/blog/admin/comentarios/:id/moderar
// Body: accion ('aprobar' | 'rechazar')
// =========================================================
export const moderarComentario = async (req, res) => {
  try {
    const db = pools[req.user?.rol] || pool;
    const { id } = req.params;
    const { accion } = req.body;

    if (!['aprobar', 'rechazar'].includes(accion))
      return res.status(400).json({
        success: false,
        message: "Acción inválida. Valores permitidos: 'aprobar', 'rechazar'"
      });

    const nuevoEstado = accion === 'aprobar' ? 'aprobado' : 'rechazado';

    const result = await db.query(`
      UPDATE blog_comentarios SET
        estado = $1, fecha_actualizacion = NOW()
      WHERE id_comentario = $2 AND eliminado = false
      RETURNING id_comentario, estado
    `, [nuevoEstado, id]);

    if (result.rows.length === 0)
      return res.status(404).json({ success: false, message: 'Comentario no encontrado' });

    logger.info(`Comentario ${id} → '${nuevoEstado}' por admin ${req.user.id_usuario}`);
    res.json({
      success: true,
      message: `Comentario ${accion === 'aprobar' ? 'aprobado' : 'rechazado'} correctamente`,
      data: result.rows[0]
    });
  } catch (error) {
    logger.error(`Error moderarComentario ${req.params.id}: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error al moderar el comentario' });
  }
};

// =========================================================
// ADMIN — LISTAR PALABRAS PROHIBIDAS
// GET /api/blog/admin/palabras-prohibidas
// =========================================================
export const listarPalabras = async (req, res) => {
  try {
    const db = pools[req.user?.rol] || pool;
    const result = await db.query(
      'SELECT id_palabra, palabra, activa, fecha_creacion FROM palabras_prohibidas ORDER BY palabra ASC'
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error(`Error listarPalabras: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error al obtener palabras prohibidas' });
  }
};

// =========================================================
// ADMIN — AGREGAR PALABRA PROHIBIDA
// POST /api/blog/admin/palabras-prohibidas
// Body: palabra
// =========================================================
export const agregarPalabra = async (req, res) => {
  try {
    const db = pools[req.user?.rol] || pool;
    const { palabra } = req.body;

    if (!palabra || palabra.trim().length === 0)
      return res.status(400).json({ success: false, message: 'La palabra es obligatoria' });

    const palabraLimpia = palabra.trim().toLowerCase();

    const result = await db.query(`
      INSERT INTO palabras_prohibidas (palabra, creado_por)
      VALUES ($1, $2)
      ON CONFLICT (palabra) DO NOTHING
      RETURNING id_palabra, palabra, activa
    `, [palabraLimpia, req.user.id_usuario]);

    if (result.rows.length === 0)
      return res.status(409).json({ success: false, message: 'Esa palabra ya está en la lista' });

    logger.info(`Palabra '${palabraLimpia}' agregada por admin ${req.user.id_usuario}`);
    res.status(201).json({ success: true, message: 'Palabra agregada a la lista', data: result.rows[0] });
  } catch (error) {
    logger.error(`Error agregarPalabra: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error al agregar la palabra' });
  }
};

// =========================================================
// ADMIN — ELIMINAR PALABRA PROHIBIDA
// DELETE /api/blog/admin/palabras-prohibidas/:id
// =========================================================
export const eliminarPalabra = async (req, res) => {
  try {
    const db = pools[req.user?.rol] || pool;
    const { id } = req.params;

    const result = await db.query(
      'DELETE FROM palabras_prohibidas WHERE id_palabra = $1 RETURNING id_palabra, palabra',
      [id]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ success: false, message: 'Palabra no encontrada' });

    logger.info(`Palabra id=${id} eliminada por admin ${req.user.id_usuario}`);
    res.json({ success: true, message: 'Palabra eliminada de la lista', data: result.rows[0] });
  } catch (error) {
    logger.error(`Error eliminarPalabra ${req.params.id}: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error al eliminar la palabra' });
  }
};

// =========================================================
// ADMIN — ACTIVAR / DESACTIVAR PALABRA PROHIBIDA
// PATCH /api/blog/admin/palabras-prohibidas/:id
// Body: activa (boolean)
// =========================================================
export const togglePalabra = async (req, res) => {
  try {
    const db = pools[req.user?.rol] || pool;
    const { id } = req.params;
    const { activa } = req.body;

    if (typeof activa !== 'boolean')
      return res.status(400).json({ success: false, message: "El campo 'activa' debe ser true o false" });

    const result = await db.query(
      'UPDATE palabras_prohibidas SET activa = $1 WHERE id_palabra = $2 RETURNING id_palabra, palabra, activa',
      [activa, id]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ success: false, message: 'Palabra no encontrada' });

    res.json({
      success: true,
      message: `Palabra ${activa ? 'activada' : 'desactivada'} correctamente`,
      data: result.rows[0]
    });
  } catch (error) {
    logger.error(`Error togglePalabra ${req.params.id}: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error al actualizar la palabra' });
  }
};
