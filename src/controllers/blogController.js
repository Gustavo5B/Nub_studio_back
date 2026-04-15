import { pool, pools } from "../config/db.js";
import logger from "../config/logger.js";

// =========================================================
// HELPERS INTERNOS
// =========================================================

// Module-level cache for palabras prohibidas (refresh every 5 minutes)
let _palabrasCache = [];
let _palabrasCacheAt = 0;
const PALABRAS_CACHE_TTL = 5 * 60 * 1000; // 5 min

const refreshPalabrasCache = async (db) => {
  const result = await db.query('SELECT palabra FROM palabras_prohibidas WHERE activa = true');
  _palabrasCache = result.rows.map(r => r.palabra.toLowerCase());
  _palabrasCacheAt = Date.now();
};

export const invalidarCachePalabras = () => { _palabrasCacheAt = 0; };

const contienepalabrasProhibidas = async (db, texto) => {
  if (Date.now() - _palabrasCacheAt > PALABRAS_CACHE_TTL) {
    await refreshPalabrasCache(db);
  }
  const textoLower = texto.toLowerCase();
  return _palabrasCache.some(p => textoLower.includes(p));
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

    const activo = estado === 'publicado';

    const result = await db.query(`
      UPDATE blog_posts SET
        estado = $1,
        activo = $2,
        -- Preserve original publication date on re-publish; clear it only when going to borrador
        fecha_publicacion = CASE
          WHEN $3::boolean THEN COALESCE(fecha_publicacion, NOW())
          ELSE NULL
        END,
        fecha_actualizacion = NOW()
      WHERE id_post = $4 AND eliminado = false
      RETURNING id_post, titulo, estado, activo
    `, [estado, activo, activo, id]);

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
        fecha_eliminacion = NOW()
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
      UPDATE blog_comentarios SET estado = $1
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
    invalidarCachePalabras();
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

    // Hard delete (not soft): palabras_prohibidas has no eliminado column — vocabulary management needs no audit trail
    const result = await db.query(
      'DELETE FROM palabras_prohibidas WHERE id_palabra = $1 RETURNING id_palabra, palabra',
      [id]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ success: false, message: 'Palabra no encontrada' });

    logger.info(`Palabra id=${id} eliminada por admin ${req.user.id_usuario}`);
    invalidarCachePalabras();
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

    invalidarCachePalabras();
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

// =========================================================
// CREAR POST (admin o artista)
// POST /api/blog/posts
// Body: titulo, contenido, extracto, id_categoria, estado, meta_description
// File: imagen (opcional → Cloudinary, req.file?.path)
// =========================================================
export const crearPost = async (req, res) => {
  try {
    const { titulo, contenido, extracto, id_categoria, estado = 'borrador', meta_description } = req.body;
    const autor_id  = req.user.id_usuario;
    const autor_rol = req.user.rol; // 'admin' o 'artista'
    const db = pools[req.user?.rol] || pool;

    // ── Validaciones ──────────────────────────────────────
    const XSS_RE  = /<script|<iframe|<object|<embed|javascript:|on\w+\s*=|eval\(|vbscript:/i;
    const SQLI_RE = /('|(OR|AND)\s+\d+=\d+|UNION\s+SELECT|DROP\s+TABLE|INSERT\s+INTO|DELETE\s+FROM|--\s|\/\*)/i;
    const stripHtml = (html) => html?.replace(/<[^>]*>/g, '').trim() || '';
    const isMalicious = (v) => XSS_RE.test(v) || SQLI_RE.test(v);

    if (!titulo?.trim())
      return res.status(400).json({ success: false, message: 'El título es obligatorio' });
    if (titulo.trim().length < 5)
      return res.status(400).json({ success: false, message: 'El título debe tener al menos 5 caracteres' });
    if (titulo.trim().length > 200)
      return res.status(400).json({ success: false, message: 'El título no puede superar 200 caracteres' });
    if (isMalicious(titulo))
      return res.status(400).json({ success: false, message: 'El título contiene caracteres no permitidos' });

    if (!contenido?.trim())
      return res.status(400).json({ success: false, message: 'El contenido es obligatorio' });
    const contenidoPlain = stripHtml(contenido);
    if (contenidoPlain.length < 50)
      return res.status(400).json({ success: false, message: 'El contenido debe tener al menos 50 caracteres' });
    if (XSS_RE.test(contenido))
      return res.status(400).json({ success: false, message: 'El contenido contiene código no permitido' });

    if (extracto?.trim()) {
      if (extracto.trim().length < 20)
        return res.status(400).json({ success: false, message: 'El extracto debe tener al menos 20 caracteres' });
      if (extracto.trim().length > 400)
        return res.status(400).json({ success: false, message: 'El extracto no puede superar 400 caracteres' });
      if (isMalicious(extracto))
        return res.status(400).json({ success: false, message: 'El extracto contiene caracteres no permitidos' });
    }
    if (meta_description?.trim() && meta_description.trim().length > 160)
      return res.status(400).json({ success: false, message: 'La meta descripción no puede superar 160 caracteres' });

    const estadosValidos = ['borrador', 'publicado', 'oculto'];
    if (!estadosValidos.includes(estado))
      return res.status(400).json({ success: false, message: `Estado inválido. Valores permitidos: ${estadosValidos.join(', ')}` });
    // ──────────────────────────────────────────────────────

    const textoPost = `${titulo} ${contenidoPlain}`;
    if (await contienepalabrasProhibidas(db, textoPost))
      return res.status(422).json({ success: false, message: 'El contenido contiene palabras no permitidas' });

    const imagen_destacada = req.file?.path || null;
    const slug = await generarSlug(db, titulo);
    const fecha_publicacion = estado === 'publicado' ? new Date() : null;

    const result = await db.query(`
      INSERT INTO blog_posts (
        autor_id, autor_rol, id_categoria, titulo, slug,
        contenido, extracto, imagen_destacada, meta_description,
        estado, fecha_publicacion, activo
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)
      RETURNING id_post, slug, titulo, estado
    `, [
      autor_id, autor_rol,
      id_categoria || null,
      titulo, slug, contenido,
      extracto || null,
      imagen_destacada,
      meta_description || null,
      estado, fecha_publicacion
    ]);

    logger.info(`Post creado: id=${result.rows[0].id_post} autor=${autor_id} rol=${autor_rol}`);
    res.status(201).json({ success: true, message: 'Post creado exitosamente', data: result.rows[0] });
  } catch (error) {
    logger.error(`Error crearPost: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error al crear el post' });
  }
};

// =========================================================
// EDITAR POST
// PUT /api/blog/posts/:id
// Admin: puede editar cualquier post. Artista: solo el suyo.
// Body: titulo, contenido, extracto, id_categoria, estado, meta_description
// File: imagen (opcional)
// =========================================================
export const editarPost = async (req, res) => {
  try {
    const db = pools[req.user?.rol] || pool;
    const { id } = req.params;
    const { titulo, contenido, extracto, id_categoria, estado, meta_description } = req.body;
    const id_usuario = req.user.id_usuario;
    const rol = req.user.rol;

    const postExiste = await db.query(
      'SELECT id_post, autor_id FROM blog_posts WHERE id_post = $1 AND eliminado = false LIMIT 1',
      [id]
    );
    if (postExiste.rows.length === 0)
      return res.status(404).json({ success: false, message: 'Post no encontrado' });

    if (rol === 'artista' && postExiste.rows[0].autor_id !== id_usuario)
      return res.status(403).json({ success: false, message: 'No tienes permiso para editar este post' });

    // ── Validaciones ──────────────────────────────────────
    const XSS_RE  = /<script|<iframe|<object|<embed|javascript:|on\w+\s*=|eval\(|vbscript:/i;
    const SQLI_RE = /('|(OR|AND)\s+\d+=\d+|UNION\s+SELECT|DROP\s+TABLE|INSERT\s+INTO|DELETE\s+FROM|--\s|\/\*)/i;
    const stripHtml = (html) => html?.replace(/<[^>]*>/g, '').trim() || '';
    const isMalicious = (v) => XSS_RE.test(v) || SQLI_RE.test(v);

    if (!titulo?.trim())
      return res.status(400).json({ success: false, message: 'El título es obligatorio' });
    if (titulo.trim().length < 5)
      return res.status(400).json({ success: false, message: 'El título debe tener al menos 5 caracteres' });
    if (titulo.trim().length > 200)
      return res.status(400).json({ success: false, message: 'El título no puede superar 200 caracteres' });
    if (isMalicious(titulo))
      return res.status(400).json({ success: false, message: 'El título contiene caracteres no permitidos' });

    if (!contenido?.trim())
      return res.status(400).json({ success: false, message: 'El contenido es obligatorio' });
    const contenidoPlain = stripHtml(contenido);
    if (contenidoPlain.length < 50)
      return res.status(400).json({ success: false, message: 'El contenido debe tener al menos 50 caracteres' });
    if (XSS_RE.test(contenido))
      return res.status(400).json({ success: false, message: 'El contenido contiene código no permitido' });

    if (extracto?.trim()) {
      if (extracto.trim().length < 20)
        return res.status(400).json({ success: false, message: 'El extracto debe tener al menos 20 caracteres' });
      if (extracto.trim().length > 400)
        return res.status(400).json({ success: false, message: 'El extracto no puede superar 400 caracteres' });
      if (isMalicious(extracto))
        return res.status(400).json({ success: false, message: 'El extracto contiene caracteres no permitidos' });
    }
    if (meta_description?.trim() && meta_description.trim().length > 160)
      return res.status(400).json({ success: false, message: 'La meta descripción no puede superar 160 caracteres' });
    // ──────────────────────────────────────────────────────

    const textoPost = `${titulo} ${contenidoPlain}`;
    if (await contienepalabrasProhibidas(db, textoPost))
      return res.status(422).json({ success: false, message: 'El contenido contiene palabras no permitidas' });

    const imagen_destacada = req.file?.path || req.body.imagen_destacada;
    const publicando = (estado === 'publicado');

    let query = `
      UPDATE blog_posts SET
        titulo = $1, contenido = $2, extracto = $3,
        id_categoria = $4, estado = $5, meta_description = $6,
        activo = $7::boolean,
        fecha_publicacion = CASE
          WHEN $7::boolean THEN COALESCE(fecha_publicacion, NOW())
          ELSE NULL
        END,
        fecha_actualizacion = NOW()
    `;
    const params = [
      titulo, contenido, extracto || null,
      id_categoria || null, estado || 'borrador',
      meta_description || null, publicando
    ];

    if (imagen_destacada) {
      query += `, imagen_destacada = $${params.length + 1}`;
      params.push(imagen_destacada);
    }

    query += ` WHERE id_post = $${params.length + 1} RETURNING id_post, slug, titulo, estado`;
    params.push(id);

    const result = await db.query(query, params);
    logger.info(`Post editado: id=${id} por usuario=${id_usuario} rol=${rol}`);
    res.json({ success: true, message: 'Post actualizado exitosamente', data: result.rows[0] });
  } catch (error) {
    logger.error(`Error editarPost ${req.params.id}: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error al actualizar el post' });
  }
};

// =========================================================
// ELIMINAR POST — soft delete
// DELETE /api/blog/posts/:id
// Admin: puede eliminar cualquier post. Artista: solo el suyo.
// =========================================================
export const eliminarPost = async (req, res) => {
  try {
    const db = pools[req.user?.rol] || pool;
    const { id } = req.params;
    const id_usuario = req.user.id_usuario;
    const rol = req.user.rol;

    const postExiste = await db.query(
      'SELECT id_post, autor_id FROM blog_posts WHERE id_post = $1 AND eliminado = false LIMIT 1',
      [id]
    );
    if (postExiste.rows.length === 0)
      return res.status(404).json({ success: false, message: 'Post no encontrado' });

    if (rol === 'artista' && postExiste.rows[0].autor_id !== id_usuario)
      return res.status(403).json({ success: false, message: 'No tienes permiso para eliminar este post' });

    await db.query(`
      UPDATE blog_posts SET
        eliminado = true, activo = false,
        fecha_eliminacion = NOW(), eliminado_por = $1,
        fecha_actualizacion = NOW()
      WHERE id_post = $2
    `, [id_usuario, id]);

    logger.info(`Post eliminado: id=${id} por usuario=${id_usuario}`);
    res.json({ success: true, message: 'Post eliminado correctamente' });
  } catch (error) {
    logger.error(`Error eliminarPost ${req.params.id}: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error al eliminar el post' });
  }
};

// =========================================================
// LISTAR MIS POSTS (artista — solo los suyos)
// GET /api/blog/mis-posts
// Query params: page, limit, estado
// =========================================================
export const listarMisPosts = async (req, res) => {
  try {
    const db = pools[req.user?.rol] || pool;
    const { page = 1, limit = 20, estado } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const id_usuario = req.user.id_usuario;

    const conditions = ['bp.autor_id = $1', 'bp.eliminado = false'];
    const params = [id_usuario];

    if (estado) {
      params.push(estado);
      conditions.push(`bp.estado = $${params.length}`);
    }

    const whereClause = conditions.join(' AND ');
    const limitN  = params.length + 1;
    const offsetN = params.length + 2;

    const result = await db.query(`
      SELECT
        bp.id_post, bp.titulo, bp.slug, bp.estado, bp.activo,
        bp.imagen_destacada, bp.vistas, bp.fecha_creacion, bp.fecha_publicacion,
        COUNT(bc.id_comentario) FILTER (
          WHERE bc.estado = 'aprobado' AND bc.eliminado = false
        ) AS total_comentarios
      FROM blog_posts bp
      LEFT JOIN blog_comentarios bc ON bc.id_post = bp.id_post
      WHERE ${whereClause}
      GROUP BY bp.id_post
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
    logger.error(`Error listarMisPosts usuario=${req.user?.id_usuario}: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error al obtener tus posts' });
  }
};

// =========================================================
// CREAR COMENTARIO (cliente, artista)
// POST /api/blog/posts/:id/comentarios
// Body: contenido, padre_id (opcional)
// File: imagen (opcional → Cloudinary, req.file?.path)
// =========================================================
export const crearComentario = async (req, res) => {
  try {
    const db = pools[req.user?.rol] || pool;
    const { id } = req.params; // id_post
    const { contenido, padre_id } = req.body;
    const id_usuario = req.user.id_usuario;

    if (!contenido || contenido.trim().length === 0)
      return res.status(400).json({ success: false, message: 'El contenido del comentario es obligatorio' });

    if (contenido.trim().length > 2000)
      return res.status(400).json({ success: false, message: 'El comentario no puede superar los 2000 caracteres' });

    // Verificar que el post existe y está publicado
    const postExiste = await db.query(
      `SELECT id_post FROM blog_posts
       WHERE id_post = $1 AND estado = 'publicado' AND activo = true AND eliminado = false
       LIMIT 1`,
      [id]
    );
    if (postExiste.rows.length === 0)
      return res.status(404).json({ success: false, message: 'Post no encontrado' });

    // Filtro de palabras prohibidas
    if (await contienepalabrasProhibidas(db, contenido))
      return res.status(422).json({
        success: false,
        message: 'Tu comentario contiene palabras no permitidas. Por favor revisa el contenido.'
      });

    // Calcular nivel si es respuesta anidada
    let nivel = 0;
    let padre_id_val = null;

    if (padre_id) {
      const padreResult = await db.query(
        'SELECT id_comentario, nivel FROM blog_comentarios WHERE id_comentario = $1 AND eliminado = false LIMIT 1',
        [padre_id]
      );
      if (padreResult.rows.length === 0)
        return res.status(404).json({ success: false, message: 'Comentario padre no encontrado' });

      if (padreResult.rows[0].nivel >= 2)
        return res.status(400).json({
          success: false,
          message: 'No se puede anidar más. Máximo 3 niveles de respuesta.'
        });

      nivel = padreResult.rows[0].nivel + 1;
      padre_id_val = parseInt(padre_id);
    }

    const imagen_url = req.file?.path || null;

    const result = await db.query(`
      INSERT INTO blog_comentarios
        (id_post, id_usuario, padre_id, nivel, contenido, imagen_url, estado)
      VALUES ($1, $2, $3, $4, $5, $6, 'aprobado')
      RETURNING id_comentario, estado
    `, [id, id_usuario, padre_id_val, nivel, contenido.trim(), imagen_url]);

    logger.info(`Comentario creado: id=${result.rows[0].id_comentario} post=${id} usuario=${id_usuario}`);
    res.status(201).json({
      success: true,
      message: 'Comentario publicado.',
      data: result.rows[0]
    });
  } catch (error) {
    logger.error(`Error crearComentario: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error al enviar el comentario' });
  }
};

// =========================================================
// ELIMINAR PROPIO COMENTARIO — soft delete (cliente o artista)
// DELETE /api/blog/comentarios/:id
// Solo puede eliminar el propio comentario (no el de otro usuario)
// =========================================================
export const eliminarComentario = async (req, res) => {
  try {
    const db = pools[req.user?.rol] || pool;
    const { id } = req.params;
    const id_usuario = req.user.id_usuario;

    const comentario = await db.query(
      'SELECT id_comentario, id_usuario FROM blog_comentarios WHERE id_comentario = $1 AND eliminado = false LIMIT 1',
      [id]
    );
    if (comentario.rows.length === 0)
      return res.status(404).json({ success: false, message: 'Comentario no encontrado' });

    if (comentario.rows[0].id_usuario !== id_usuario)
      return res.status(403).json({ success: false, message: 'Solo puedes eliminar tus propios comentarios' });

    await db.query(`
      UPDATE blog_comentarios SET
        eliminado = true,
        eliminado_por = $1,
        fecha_eliminacion = NOW(),
        fecha_actualizacion = NOW()
      WHERE id_comentario = $2
    `, [id_usuario, id]);

    logger.info(`Comentario ${id} eliminado por su autor usuario=${id_usuario}`);
    res.json({ success: true, message: 'Comentario eliminado correctamente' });
  } catch (error) {
    logger.error(`Error eliminarComentario ${req.params.id}: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error al eliminar el comentario' });
  }
};

// =========================================================
// LISTAR POSTS PUBLICADOS (público)
// GET /api/blog/posts
// Query params: page, limit, categoria (id_categoria)
// =========================================================
export const listarPosts = async (req, res) => {
  try {
    const db = pools[req.user?.rol] || pool;
    const { page = 1, limit = 10, categoria } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const conditions = ["bp.estado = 'publicado'", 'bp.activo = true', 'bp.eliminado = false'];
    const params = [];

    if (categoria) {
      const catId = parseInt(categoria, 10);
      if (isNaN(catId))
        return res.status(400).json({ success: false, message: 'Categoría inválida' });
      params.push(catId);
      conditions.push(`bp.id_categoria = $${params.length}`);
    }

    const whereClause = conditions.join(' AND ');
    const limitN  = params.length + 1;
    const offsetN = params.length + 2;

    const result = await db.query(`
      SELECT
        bp.id_post, bp.titulo, bp.slug, bp.extracto,
        bp.imagen_destacada, bp.autor_rol, bp.vistas,
        bp.fecha_publicacion, bp.fecha_creacion,
        c.nombre AS categoria_nombre,
        CASE bp.autor_rol
          WHEN 'artista' THEN a.nombre_artistico
          ELSE u.nombre_completo
        END AS autor_nombre,
        CASE bp.autor_rol
          WHEN 'artista' THEN a.foto_perfil
          ELSE NULL
        END AS autor_foto,
        COUNT(bc.id_comentario) FILTER (
          WHERE bc.estado = 'aprobado' AND bc.eliminado = false
        ) AS total_comentarios
      FROM blog_posts bp
      JOIN usuarios u ON bp.autor_id = u.id_usuario
      LEFT JOIN artistas a ON bp.autor_rol = 'artista' AND a.id_usuario = bp.autor_id
      LEFT JOIN categorias c ON bp.id_categoria = c.id_categoria
      LEFT JOIN blog_comentarios bc ON bc.id_post = bp.id_post
      WHERE ${whereClause}
      GROUP BY bp.id_post, c.nombre, u.nombre_completo, a.nombre_artistico, a.foto_perfil
      ORDER BY bp.fecha_publicacion DESC
      LIMIT $${limitN} OFFSET $${offsetN}
    `, [...params, parseInt(limit), offset]);

    const countResult = await db.query(
      `SELECT COUNT(*) AS total FROM blog_posts bp WHERE ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].total);

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    logger.error(`Error listarPosts: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error al obtener los posts' });
  }
};

// =========================================================
// OBTENER POST COMPLETO PARA EDITAR (admin o artista dueño)
// GET /api/blog/posts/:id/editar
// Devuelve todos los campos incluyendo contenido, sin filtro de estado
// =========================================================
export const obtenerPostParaEditar = async (req, res) => {
  try {
    const db = pools[req.user?.rol] || pool;
    const idNum = parseInt(req.params.id, 10);
    if (isNaN(idNum))
      return res.status(400).json({ success: false, message: 'ID inválido' });

    const conditions = ['bp.id_post = $1', 'bp.eliminado = false'];
    const params = [idNum];

    // Artista solo puede ver sus propios posts
    if (req.user?.rol === 'artista') {
      params.push(req.user.id_usuario);
      conditions.push(`bp.autor_id = $${params.length}`);
    }

    const result = await db.query(`
      SELECT
        bp.id_post, bp.titulo, bp.slug, bp.extracto, bp.contenido,
        bp.imagen_destacada, bp.meta_description, bp.autor_id, bp.autor_rol,
        bp.id_categoria, bp.estado, bp.activo, bp.vistas,
        bp.fecha_publicacion, bp.fecha_creacion, bp.fecha_actualizacion
      FROM blog_posts bp
      WHERE ${conditions.join(' AND ')}
      LIMIT 1
    `, params);

    if (result.rows.length === 0)
      return res.status(404).json({ success: false, message: 'Post no encontrado' });

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    logger.error(`Error obtenerPostParaEditar ${req.params.id}: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error al obtener el post' });
  }
};

// =========================================================
// DETALLE DE POST POR SLUG (público)
// GET /api/blog/posts/:slug
// Incrementa vistas en background (no bloqueante)
// =========================================================
export const obtenerPostPorSlug = async (req, res) => {
  try {
    const db = pools[req.user?.rol] || pool;
    const { slug } = req.params;

    const result = await db.query(`
      SELECT
        bp.id_post, bp.titulo, bp.slug, bp.extracto, bp.contenido,
        bp.imagen_destacada, bp.meta_description, bp.autor_id, bp.autor_rol,
        bp.id_categoria, bp.estado, bp.activo, bp.vistas,
        bp.fecha_publicacion, bp.fecha_creacion, bp.fecha_actualizacion,
        c.nombre AS categoria_nombre,
        CASE bp.autor_rol
          WHEN 'artista' THEN a.nombre_artistico
          ELSE u.nombre_completo
        END AS autor_nombre,
        CASE bp.autor_rol
          WHEN 'artista' THEN a.foto_perfil
          ELSE NULL
        END AS autor_foto,
        CASE bp.autor_rol
          WHEN 'artista' THEN a.id_artista
          ELSE NULL
        END AS autor_artista_id
      FROM blog_posts bp
      JOIN usuarios u ON bp.autor_id = u.id_usuario
      LEFT JOIN artistas a ON bp.autor_rol = 'artista' AND a.id_usuario = bp.autor_id
      LEFT JOIN categorias c ON bp.id_categoria = c.id_categoria
      WHERE bp.slug = $1
        AND bp.estado = 'publicado'
        AND bp.activo = true
        AND bp.eliminado = false
      LIMIT 1
    `, [slug]);

    if (result.rows.length === 0)
      return res.status(404).json({ success: false, message: 'Post no encontrado' });

    // Incrementar vistas en background — no bloquea la respuesta
    db.query('UPDATE blog_posts SET vistas = vistas + 1 WHERE slug = $1', [slug])
      .catch(err => logger.error(`Error incrementando vistas '${slug}': ${err.message}`));

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    logger.error(`Error obtenerPostPorSlug '${req.params.slug}': ${error.message}`);
    res.status(500).json({ success: false, message: 'Error al obtener el post' });
  }
};

// =========================================================
// LISTAR COMENTARIOS APROBADOS EN ÁRBOL (público)
// GET /api/blog/posts/:id/comentarios
// Devuelve array de raíces, cada una con array 'respuestas' anidado
// =========================================================
export const listarComentarios = async (req, res) => {
  try {
    const db = pools[req.user?.rol] || pool;
    const { id } = req.params;

    const idNum = parseInt(id, 10);
    if (isNaN(idNum))
      return res.status(400).json({ success: false, message: 'ID de post inválido' });

    const postExiste = await db.query(
      `SELECT id_post FROM blog_posts
       WHERE id_post = $1 AND estado = 'publicado' AND activo = true AND eliminado = false
       LIMIT 1`,
      [idNum]
    );
    if (postExiste.rows.length === 0)
      return res.status(404).json({ success: false, message: 'Post no encontrado' });

    const result = await db.query(`
      SELECT
        bc.id_comentario, bc.padre_id, bc.nivel,
        bc.contenido, bc.imagen_url, bc.fecha_creacion,
        u.rol AS usuario_rol,
        CASE u.rol
          WHEN 'artista' THEN a.nombre_artistico
          ELSE u.nombre_completo
        END AS autor_nombre,
        CASE u.rol
          WHEN 'artista' THEN a.foto_perfil
          ELSE NULL
        END AS autor_foto
      FROM blog_comentarios bc
      JOIN usuarios u ON bc.id_usuario = u.id_usuario
      LEFT JOIN artistas a ON u.rol = 'artista' AND a.id_usuario = u.id_usuario
      WHERE bc.id_post = $1
        AND bc.estado = 'aprobado'
        AND bc.eliminado = false
      ORDER BY bc.fecha_creacion ASC
    `, [idNum]);

    // Construir árbol en memoria
    const map = {};
    const raices = [];
    result.rows.forEach(c => { map[c.id_comentario] = { ...c, respuestas: [] }; });
    result.rows.forEach(c => {
      if (c.padre_id && map[c.padre_id]) {
        map[c.padre_id].respuestas.push(map[c.id_comentario]);
      } else {
        raices.push(map[c.id_comentario]);
      }
    });

    res.json({ success: true, data: raices });
  } catch (error) {
    logger.error(`Error listarComentarios post=${req.params.id}: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error al obtener los comentarios' });
  }
};
