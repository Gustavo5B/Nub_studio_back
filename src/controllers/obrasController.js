import { pool } from "../config/db.js";

const secureLog = {
  info: (message, metadata = {}) => {
    console.log(`ℹ️ ${message}`, Object.keys(metadata).length > 0 ? metadata : '');
  },
  error: (message, error) => {
    console.error(`❌ ${message}`, { name: error.name, code: error.code });
  }
};

// =========================================================
// 📚 LISTAR TODAS LAS OBRAS
// =========================================================
// =========================================================
// 📚 LISTAR TODAS LAS OBRAS  (fix admin view)
// =========================================================
export const listarObras = async (req, res) => {
  try {
    const {
      page = 1, limit = 12, categoria, artista,
      precio_min, precio_max, destacadas, ordenar = 'recientes',
      solo_publicadas = 'true'
    } = req.query;

    const offset = (page - 1) * limit;
    let whereConditions = ['o.eliminada IS NOT TRUE'];  // ✅ era 'o.activa = TRUE' — bloqueaba pendientes
    let queryParams = [];
    let paramCount = 1;

    // Catálogo público → solo publicadas Y activas
    // Panel admin (solo_publicadas=false) → todo lo no eliminado
    if (solo_publicadas === 'true') {
      whereConditions.push("o.estado = 'publicada'");
      whereConditions.push("o.activa = TRUE");
    }

    if (categoria)         { whereConditions.push(`o.id_categoria = $${paramCount}`); queryParams.push(categoria); paramCount++; }
    if (artista)           { whereConditions.push(`o.id_artista = $${paramCount}`);   queryParams.push(artista);   paramCount++; }
    if (destacadas === 'true') { whereConditions.push('o.destacada = TRUE'); }

    if (precio_min || precio_max) {
      let precioConditions = [];
      if (precio_min) { precioConditions.push(`ot.precio_base >= $${paramCount}`); queryParams.push(precio_min); paramCount++; }
      if (precio_max) { precioConditions.push(`ot.precio_base <= $${paramCount}`); queryParams.push(precio_max); paramCount++; }
      whereConditions.push(
        `EXISTS (SELECT 1 FROM obras_tamaños ot WHERE ot.id_obra = o.id_obra AND ot.activo = TRUE ${precioConditions.length > 0 ? 'AND ' + precioConditions.join(' AND ') : ''})`
      );
    }

    const whereClause = whereConditions.join(' AND ');

    let orderBy = 'o.fecha_creacion DESC';
    switch (ordenar) {
      case 'antiguos':    orderBy = 'o.fecha_creacion ASC';  break;
      case 'precio_asc':  orderBy = 'precio_minimo ASC NULLS LAST';  break;  // ✅ NULLS LAST — evita crash cuando no hay tamaños
      case 'precio_desc': orderBy = 'precio_minimo DESC NULLS LAST'; break;
      case 'nombre':      orderBy = 'o.titulo ASC';           break;
    }

    // ✅ precio_base directo de obras como fallback cuando no hay obras_tamaños
    const query = `
      SELECT
        o.id_obra, o.titulo, o.descripcion, o.slug, o.imagen_principal,
        o.anio_creacion, o.tecnica, o.destacada, o.vistas, o.fecha_creacion,
        o.precio_base, o.estado, o.activa,
        a.id_artista, a.nombre_completo AS artista_nombre, a.nombre_artistico AS artista_alias,
        c.id_categoria, c.nombre AS categoria_nombre, c.slug AS categoria_slug,
        COALESCE(MIN(ot.precio_base), o.precio_base) AS precio_minimo,
        COALESCE(MAX(ot.precio_base), o.precio_base) AS precio_maximo,
        COUNT(ot.id) FILTER (WHERE ot.activo = TRUE) AS total_tamaños
      FROM obras o
      INNER JOIN artistas a ON o.id_artista = a.id_artista
      INNER JOIN categorias c ON o.id_categoria = c.id_categoria
      LEFT JOIN obras_tamaños ot ON o.id_obra = ot.id_obra AND ot.activo = TRUE
      WHERE ${whereClause}
      GROUP BY
        o.id_obra, o.titulo, o.descripcion, o.slug, o.imagen_principal,
        o.anio_creacion, o.tecnica, o.destacada, o.vistas, o.fecha_creacion,
        o.precio_base, o.estado, o.activa,
        a.id_artista, a.nombre_completo, a.nombre_artistico,
        c.id_categoria, c.nombre, c.slug
      ORDER BY ${orderBy}
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;

    queryParams.push(parseInt(limit), parseInt(offset));
    const result = await pool.query(query, queryParams);

    const countResult = await pool.query(
      `SELECT COUNT(DISTINCT o.id_obra) AS total
       FROM obras o
       LEFT JOIN obras_tamaños ot ON o.id_obra = ot.id_obra AND ot.activo = TRUE
       WHERE ${whereClause}`,
      queryParams.slice(0, -2)
    );
    const total = parseInt(countResult.rows[0].total);

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    secureLog.error('Error al listar obras', error);
    res.status(500).json({ success: false, message: "Error al obtener las obras" });
  }
};

// =========================================================
// 🔍 DETALLE COMPLETO DE UNA OBRA
// =========================================================
export const obtenerObraPorId = async (req, res) => {
  try {
    const { id } = req.params;

    const resultObra = await pool.query(`
      SELECT o.*, a.nombre_completo AS artista_nombre, a.nombre_artistico AS artista_alias,
        a.biografia AS artista_biografia, a.foto_perfil AS artista_foto,
        c.nombre AS categoria_nombre, c.slug AS categoria_slug
      FROM obras o
      INNER JOIN artistas a ON o.id_artista = a.id_artista
      INNER JOIN categorias c ON o.id_categoria = c.id_categoria
      WHERE o.id_obra = $1 AND o.activa = TRUE LIMIT 1
    `, [id]);

    if (resultObra.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Obra no encontrada" });
    }

    const obra = resultObra.rows[0];

    const resultTamaños = await pool.query(`
      SELECT ot.id AS id_obra_tamaño, ot.precio_base, ot.cantidad_disponible,
        t.id_tamaño, t.nombre AS tamaño_nombre, t.ancho_cm, t.alto_cm
      FROM obras_tamaños ot
      INNER JOIN tamaños_disponibles t ON ot.id_tamaño = t.id_tamaño
      WHERE ot.id_obra = $1 AND ot.activo = TRUE AND t.activo = TRUE
      ORDER BY ot.precio_base ASC
    `, [id]);

    const tamaños = resultTamaños.rows;
    for (let tamaño of tamaños) {
      const resultMarcos = await pool.query(`
        SELECT om.id, om.precio_total, tm.id_tipo_marco,
          tm.nombre AS marco_nombre, tm.descripcion AS marco_descripcion,
          tm.precio_adicional, tm.imagen AS marco_imagen
        FROM obras_marcos om
        INNER JOIN tipos_marco tm ON om.id_tipo_marco = tm.id_tipo_marco
        WHERE om.id_obra_tamaño = $1 AND om.activo = TRUE AND tm.activo = TRUE
        ORDER BY om.precio_total ASC
      `, [tamaño.id_obra_tamaño]);
      tamaño.marcos = resultMarcos.rows;
    }

    const resultImagenes  = await pool.query(
      `SELECT id_imagen, url_imagen, orden, es_principal FROM imagenes_obras WHERE id_obra = $1 AND activa = TRUE ORDER BY es_principal DESC, orden ASC`, [id]
    );
    const resultEtiquetas = await pool.query(
      `SELECT e.id_etiqueta, e.nombre, e.slug FROM obras_etiquetas oe INNER JOIN etiquetas e ON oe.id_etiqueta = e.id_etiqueta WHERE oe.id_obra = $1 AND e.activa = TRUE`, [id]
    );
    const resultRelacionadas = await pool.query(`
      SELECT o.id_obra, o.titulo, o.slug, o.imagen_principal,
        a.nombre_artistico AS artista_alias, MIN(ot.precio_base) AS precio_minimo
      FROM obras o
      INNER JOIN artistas a ON o.id_artista = a.id_artista
      LEFT JOIN obras_tamaños ot ON o.id_obra = ot.id_obra AND ot.activo = TRUE
      WHERE o.activa = TRUE AND o.id_obra != $1 AND (o.id_categoria = $2 OR o.id_artista = $3)
      GROUP BY o.id_obra, a.nombre_artistico ORDER BY RANDOM() LIMIT 4
    `, [id, obra.id_categoria, obra.id_artista]);

    await pool.query('UPDATE obras SET vistas = vistas + 1 WHERE id_obra = $1', [id]);

    res.json({
      success: true,
      data: {
        ...obra, tamaños,
        imagenes: resultImagenes.rows,
        etiquetas: resultEtiquetas.rows,
        obras_relacionadas: resultRelacionadas.rows
      }
    });

  } catch (error) {
    secureLog.error('Error al obtener detalle de obra', error);
    res.status(500).json({ success: false, message: "Error al obtener el detalle de la obra" });
  }
};

// =========================================================
// 🔍 OBTENER OBRA POR SLUG
// =========================================================
export const obtenerObraPorSlug = async (req, res) => {
  try {
    const { slug } = req.params;
    const result = await pool.query('SELECT id_obra FROM obras WHERE slug = $1 AND activa = TRUE LIMIT 1', [slug]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: "Obra no encontrada" });
    req.params.id = result.rows[0].id_obra;
    return obtenerObraPorId(req, res);
  } catch (error) {
    secureLog.error('Error al obtener obra por slug', error);
    res.status(500).json({ success: false, message: "Error al obtener la obra" });
  }
};

// =========================================================
// 🔎 BÚSQUEDA POR PALABRA CLAVE
// =========================================================
export const buscarObras = async (req, res) => {
  try {
    const { q, page = 1, limit = 12 } = req.query;
    if (!q || q.trim().length < 2) return res.status(400).json({ success: false, message: "La búsqueda debe tener al menos 2 caracteres" });

    const offset = (page - 1) * limit;
    const searchTerm = `%${q}%`;

    const result = await pool.query(`
      SELECT o.id_obra, o.titulo, o.descripcion, o.slug, o.imagen_principal,
        o.precio_base,
        a.nombre_completo AS artista_nombre, a.nombre_artistico AS artista_alias,
        c.nombre AS categoria_nombre, MIN(ot.precio_base) AS precio_minimo
      FROM obras o
      INNER JOIN artistas a ON o.id_artista = a.id_artista
      INNER JOIN categorias c ON o.id_categoria = c.id_categoria
      LEFT JOIN obras_tamaños ot ON o.id_obra = ot.id_obra AND ot.activo = TRUE
      WHERE o.activa = TRUE AND (o.titulo ILIKE $1 OR o.descripcion ILIKE $1 OR a.nombre_completo ILIKE $1 OR a.nombre_artistico ILIKE $1 OR c.nombre ILIKE $1)
      GROUP BY o.id_obra, a.nombre_completo, a.nombre_artistico, c.nombre
      ORDER BY o.fecha_creacion DESC LIMIT $2 OFFSET $3
    `, [searchTerm, parseInt(limit), parseInt(offset)]);

    const countResult = await pool.query(`
      SELECT COUNT(DISTINCT o.id_obra) as total FROM obras o
      INNER JOIN artistas a ON o.id_artista = a.id_artista
      INNER JOIN categorias c ON o.id_categoria = c.id_categoria
      WHERE o.activa = TRUE AND (o.titulo ILIKE $1 OR o.descripcion ILIKE $1 OR a.nombre_completo ILIKE $1 OR a.nombre_artistico ILIKE $1 OR c.nombre ILIKE $1)
    `, [searchTerm]);

    const total = parseInt(countResult.rows[0].total);
    res.json({ success: true, data: result.rows, search: { query: q, total }, pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / limit) } });

  } catch (error) {
    secureLog.error('Error en búsqueda', error);
    res.status(500).json({ success: false, message: "Error al buscar obras" });
  }
};

// =========================================================
// 🏷️ FILTROS RÁPIDOS
// =========================================================
export const obtenerObrasPorCategoria = async (req, res) => { req.query.categoria = req.params.id; return listarObras(req, res); };
export const obtenerObrasPorArtista   = async (req, res) => { req.query.artista   = req.params.id; return listarObras(req, res); };
export const obtenerObrasDestacadas   = async (req, res) => { req.query.destacadas = 'true'; req.query.limit = req.query.limit || 8; return listarObras(req, res); };

export const obtenerObrasPorEtiqueta = async (req, res) => {
  try {
    const { slug } = req.params;
    const { page = 1, limit = 12 } = req.query;
    const offset = (page - 1) * limit;

    const resultEtiqueta = await pool.query('SELECT id_etiqueta, nombre FROM etiquetas WHERE slug = $1 AND activa = TRUE', [slug]);
    if (resultEtiqueta.rows.length === 0) return res.status(404).json({ success: false, message: "Etiqueta no encontrada" });

    const etiqueta = resultEtiqueta.rows[0];
    const result = await pool.query(`
      SELECT o.id_obra, o.titulo, o.slug, o.imagen_principal, o.precio_base,
        a.nombre_artistico AS artista_alias, c.nombre AS categoria_nombre, MIN(ot.precio_base) AS precio_minimo
      FROM obras o
      INNER JOIN obras_etiquetas oe ON o.id_obra = oe.id_obra
      INNER JOIN artistas a ON o.id_artista = a.id_artista
      INNER JOIN categorias c ON o.id_categoria = c.id_categoria
      LEFT JOIN obras_tamaños ot ON o.id_obra = ot.id_obra AND ot.activo = TRUE
      WHERE oe.id_etiqueta = $1 AND o.activa = TRUE
      GROUP BY o.id_obra, a.nombre_artistico, c.nombre
      ORDER BY o.fecha_creacion DESC LIMIT $2 OFFSET $3
    `, [etiqueta.id_etiqueta, parseInt(limit), parseInt(offset)]);

    const countResult = await pool.query(
      'SELECT COUNT(DISTINCT o.id_obra) as total FROM obras o INNER JOIN obras_etiquetas oe ON o.id_obra = oe.id_obra WHERE oe.id_etiqueta = $1 AND o.activa = TRUE',
      [etiqueta.id_etiqueta]
    );
    const total = parseInt(countResult.rows[0].total);

    res.json({ success: true, etiqueta: etiqueta.nombre, data: result.rows, pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / limit) } });
  } catch (error) {
    secureLog.error('Error al filtrar por etiqueta', error);
    res.status(500).json({ success: false, message: "Error al filtrar obras por etiqueta" });
  }
};

// =========================================================
// ➕ CREAR OBRA
// =========================================================
export const crearObra = async (req, res) => {
  try {
    const {
      titulo, descripcion,
      id_categoria, id_artista, id_tecnica,
      anio_creacion, precio_base,
      dimensiones_alto, dimensiones_ancho, dimensiones_profundidad,
      permite_marco, con_certificado, destacada
    } = req.body;

    const id_usuario = req.user?.id_usuario || 1;

    if (!titulo || !descripcion || !id_categoria || !id_artista) {
      return res.status(400).json({ success: false, message: 'Título, descripción, categoría y artista son obligatorios' });
    }

    const imagen_principal = req.file?.path || req.body.imagen_principal || null;

    let slug = titulo
      .toLowerCase().trim()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    const slugExiste = await pool.query('SELECT id_obra FROM obras WHERE slug = $1 LIMIT 1', [slug]);
    if (slugExiste.rows.length > 0) slug = `${slug}-${Date.now()}`;

    const result = await pool.query(`
      INSERT INTO obras (
        titulo, slug, descripcion,
        id_categoria, id_artista, id_tecnica,
        anio_creacion, imagen_principal, precio_base,
        dimensiones_alto, dimensiones_ancho, dimensiones_profundidad,
        permite_marco, con_certificado, destacada,
        id_usuario_creacion, activa, estado
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,TRUE,'pendiente')
      RETURNING id_obra, slug
    `, [
      titulo, slug, descripcion,
      id_categoria, id_artista, id_tecnica || null,
      anio_creacion || null, imagen_principal, precio_base || null,
      dimensiones_alto || null, dimensiones_ancho || null, dimensiones_profundidad || null,
      permite_marco ?? true, con_certificado ?? false,
      destacada || false, id_usuario
    ]);

    const { id_obra } = result.rows[0];
    secureLog.info('Obra creada', { id_obra, slug });

    res.status(201).json({ success: true, message: 'Obra creada exitosamente', data: { id_obra, slug, imagen_principal } });

  } catch (error) {
    secureLog.error('Error al crear obra', error);
    res.status(500).json({ success: false, message: 'Error al crear la obra' });
  }
};

// =========================================================
// ✏️ ACTUALIZAR OBRA
// =========================================================
// =========================================================
// ✏️ ACTUALIZAR OBRA  (fix: sincroniza campo `activa` con `estado`)
// =========================================================
export const actualizarObra = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      titulo, descripcion, id_categoria, id_artista, id_tecnica,
      anio_creacion, precio_base,
      dimensiones_alto, dimensiones_ancho, dimensiones_profundidad,
      permite_marco, con_certificado, destacada, estado
    } = req.body;

    const imagen_principal = req.file?.path || req.body.imagen_principal;

    // ✅ FIX: activa se sincroniza automáticamente con el estado
    // publicada → activa = TRUE  (aparece en catálogo público y Home)
    // cualquier otro estado → activa = FALSE
    const activa = estado === 'publicada';

    let query = `
      UPDATE obras SET
        titulo=$1, descripcion=$2, id_categoria=$3, id_artista=$4, id_tecnica=$5,
        anio_creacion=$6, precio_base=$7,
        dimensiones_alto=$8, dimensiones_ancho=$9, dimensiones_profundidad=$10,
        permite_marco=$11, con_certificado=$12, destacada=$13,
        estado=$14, activa=$15,
        fecha_actualizacion=NOW()
    `;

    const params = [
      titulo, descripcion, id_categoria, id_artista, id_tecnica || null,
      anio_creacion || null, precio_base || null,
      dimensiones_alto || null, dimensiones_ancho || null, dimensiones_profundidad || null,
      permite_marco ?? true, con_certificado ?? false, destacada || false,
      estado || 'pendiente', activa,
    ];

    if (imagen_principal) {
      query += `, imagen_principal=$${params.length + 1}`;
      params.push(imagen_principal);
    }

    query += ` WHERE id_obra=$${params.length + 1} RETURNING id_obra, titulo, estado, activa`;
    params.push(id);

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Obra no encontrada' });
    }

    secureLog.info('Obra actualizada', { 
      id_obra: result.rows[0].id_obra, 
      estado: result.rows[0].estado,
      activa: result.rows[0].activa 
    });

    res.json({ success: true, message: 'Obra actualizada exitosamente', data: result.rows[0] });

  } catch (error) {
    secureLog.error('Error al actualizar obra', error);
    res.status(500).json({ success: false, message: 'Error al actualizar la obra' });
  }
};
// =========================================================
// 🗑️ ELIMINAR OBRA (soft delete)
// =========================================================
export const eliminarObra = async (req, res) => {
  try {
    const { id } = req.params;
    const id_usuario = req.user?.id_usuario || 1;

    await pool.query(`
      UPDATE obras SET eliminada=TRUE, activa=FALSE,
        fecha_eliminacion=CURRENT_TIMESTAMP, eliminado_por=$2
      WHERE id_obra=$1
    `, [id, id_usuario]);

    res.json({ success: true, message: 'Obra eliminada correctamente' });

  } catch (error) {
    secureLog.error('Error al eliminar obra', error);
    res.status(500).json({ success: false, message: 'Error al eliminar la obra' });
  }
};