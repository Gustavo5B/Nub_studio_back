import { pool } from '../config/db.js';
import logger from '../config/logger.js';

// GET /api/artista-portal/mi-perfil
export const getMiPerfil = async (req, res) => {
  try {
    const usuarioId = req.user.id_usuario;

    const result = await pool.query(
      `SELECT
        a.id_artista, a.nombre_completo, a.nombre_artistico,
        a.biografia, a.foto_perfil, a.correo, a.telefono,
        a.ciudad, a.direccion_taller, a.codigo_postal,
        a.porcentaje_comision, a.estado, a.fecha_registro,
        a.acepta_envios, a.solo_entrega_personal,
        a.politica_envios, a.politica_devoluciones,
        u.correo AS email_usuario
      FROM artistas a
      JOIN usuarios u ON u.id_usuario = a.id_usuario
      WHERE a.id_usuario = $1`,
      [usuarioId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Artista no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    logger.error(`Error en getMiPerfil: ${error.message}`);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// GET /api/artista-portal/mis-obras
export const getMisObras = async (req, res) => {
  try {
    const usuarioId = req.user.id_usuario;

    const artistaRes = await pool.query(
      'SELECT id_artista FROM artistas WHERE id_usuario = $1',
      [usuarioId]
    );

    if (artistaRes.rows.length === 0) {
      return res.status(404).json({ message: 'Artista no encontrado' });
    }

    const idArtista = artistaRes.rows[0].id_artista;

    const result = await pool.query(
      `SELECT
        o.id_obra, o.titulo, o.slug, o.descripcion,
        o.imagen_principal, o.precio_base, o.estado,
        o.activa, o.visible, o.destacada, o.vistas,
        o.fecha_creacion, o.fecha_aprobacion, o.motivo_rechazo,
        o.dimensiones_alto, o.dimensiones_ancho, o.dimensiones_profundidad,
        o.dimensiones_unidad, o.anio_creacion, o.tecnica,
        o.permite_marco, o.con_certificado,
        c.nombre AS categoria
      FROM obras o
      LEFT JOIN categorias c ON c.id_categoria = o.id_categoria
      WHERE o.id_artista = $1
        AND (o.eliminada IS NULL OR o.eliminada = false)
      ORDER BY o.fecha_creacion DESC`,
      [idArtista]
    );

    const obras = result.rows;
    const stats = {
      total:      obras.length,
      publicadas: obras.filter(o => o.estado === 'publicada').length,
      pendientes: obras.filter(o => o.estado === 'pendiente').length,
      rechazadas: obras.filter(o => o.estado === 'rechazada').length,
      borradores: obras.filter(o => o.estado === 'borrador').length,
    };

    res.json({ obras, stats });
  } catch (error) {
    logger.error(`Error en getMisObras: ${error.message}`);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// POST /api/artista-portal/nueva-obra
export const nuevaObra = async (req, res) => {
  try {
    const usuarioId = req.user.id_usuario;

    const artistaRes = await pool.query(
      'SELECT id_artista, estado FROM artistas WHERE id_usuario = $1',
      [usuarioId]
    );

    if (artistaRes.rows.length === 0) {
      return res.status(403).json({ message: 'No eres un artista registrado' });
    }

    const artista = artistaRes.rows[0];
    if (artista.estado !== 'activo') {
      return res.status(403).json({ message: 'Tu cuenta de artista aun no esta aprobada' });
    }

    const idArtista = artista.id_artista;

    const {
      titulo, descripcion, id_categoria, tecnica, anio_creacion,
      dimensiones_alto, dimensiones_ancho, dimensiones_profundidad,
      precio_base, permite_marco, con_certificado, etiquetas: etiquetasRaw,
    } = req.body;

    if (!titulo || !descripcion || !id_categoria || !precio_base) {
      return res.status(400).json({ message: 'Faltan campos requeridos: titulo, descripcion, id_categoria, precio_base' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'La imagen es requerida' });
    }

    const { cloudinary } = await import('../config/cloudinaryConfig.js');

    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'nub_studio/obras', resource_type: 'image', quality: 'auto:good', fetch_format: 'auto' },
        (error, result) => { if (error) reject(error); else resolve(result); }
      );
      stream.end(req.file.buffer);
    });

    const imagenPrincipal = uploadResult.secure_url;

    const slugBase = titulo
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    const slug = `${slugBase}-${Date.now()}`;

    const obraRes = await pool.query(
      `INSERT INTO obras (
        titulo, slug, descripcion,
        id_categoria, id_artista, id_usuario_creacion,
        tecnica, anio_creacion,
        dimensiones_alto, dimensiones_ancho, dimensiones_profundidad,
        precio_base, permite_marco, con_certificado,
        imagen_principal,
        estado, activa, visible,
        fecha_creacion, fecha_actualizacion
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
        'pendiente', false, false, NOW(), NOW()
      ) RETURNING id_obra, titulo, slug, estado, imagen_principal`,
      [
        titulo, slug, descripcion,
        parseInt(id_categoria), idArtista, usuarioId,
        tecnica || null,
        anio_creacion ? parseInt(anio_creacion) : null,
        dimensiones_alto        ? parseFloat(dimensiones_alto)        : null,
        dimensiones_ancho       ? parseFloat(dimensiones_ancho)       : null,
        dimensiones_profundidad ? parseFloat(dimensiones_profundidad) : null,
        parseFloat(precio_base),
        permite_marco   === 'true' || permite_marco   === true,
        con_certificado === 'true' || con_certificado === true,
        imagenPrincipal,
      ]
    );

    const obraCreada = obraRes.rows[0];

    if (etiquetasRaw) {
      let etiquetas = [];
      try { etiquetas = typeof etiquetasRaw === 'string' ? JSON.parse(etiquetasRaw) : etiquetasRaw; } catch (_) {}
      if (Array.isArray(etiquetas) && etiquetas.length > 0) {
        for (const idEtiqueta of etiquetas) {
          await pool.query(
            `INSERT INTO obras_etiquetas (id_obra, id_etiqueta) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [obraCreada.id_obra, idEtiqueta]
          );
        }
      }
    }

    logger.info(`Nueva obra creada: ${obraCreada.titulo} (id: ${obraCreada.id_obra})`);
    res.status(201).json({
      message: 'Obra enviada. Quedara en revision hasta que el admin la apruebe.',
      obra: obraCreada,
    });

  } catch (error) {
    logger.error(`Error en nuevaObra: ${error.message}`);
    res.status(500).json({ message: 'Error interno del servidor', error: error.message });
  }
};
// GET /api/artista-portal/obra/:id
export const getObraById = async (req, res) => {
  try {
    const usuarioId = req.user.id_usuario;
    const { id }    = req.params;

    const artistaRes = await pool.query(
      'SELECT id_artista FROM artistas WHERE id_usuario = $1 AND estado = $2 LIMIT 1',
      [usuarioId, 'activo']
    );
    if (artistaRes.rows.length === 0)
      return res.status(403).json({ message: 'Artista no encontrado o inactivo' });

    const { id_artista } = artistaRes.rows[0];

    const result = await pool.query(`
      SELECT o.*,
        c.nombre AS categoria_nombre,
        COALESCE(
          json_agg(oe.id_etiqueta) FILTER (WHERE oe.id_etiqueta IS NOT NULL),
          '[]'
        ) AS etiquetas
      FROM obras o
      LEFT JOIN categorias c  ON c.id_categoria = o.id_categoria
      LEFT JOIN obras_etiquetas oe ON oe.id_obra = o.id_obra
      WHERE o.id_obra = $1 AND o.id_artista = $2
        AND (o.eliminada IS NULL OR o.eliminada = FALSE)
      GROUP BY o.id_obra, c.nombre
      LIMIT 1
    `, [id, id_artista]);

    if (result.rows.length === 0)
      return res.status(404).json({ message: 'Obra no encontrada' });

    res.json(result.rows[0]);
  } catch (error) {
    logger.error(`Error en getObraById: ${error.message}`);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// PUT /api/artista-portal/obra/:id
export const actualizarObraArtista = async (req, res) => {
  try {
    const usuarioId = req.user.id_usuario;
    const { id }    = req.params;

    const artistaRes = await pool.query(
      'SELECT id_artista, estado FROM artistas WHERE id_usuario = $1 LIMIT 1',
      [usuarioId]
    );
    if (artistaRes.rows.length === 0)
      return res.status(403).json({ message: 'No eres un artista registrado' });

    const artista = artistaRes.rows[0];
    if (artista.estado !== 'activo')
      return res.status(403).json({ message: 'Tu cuenta de artista aún no está aprobada' });

    const { id_artista } = artista;

    // Verificar que la obra pertenece al artista
    const obraCheck = await pool.query(
      `SELECT id_obra FROM obras
       WHERE id_obra = $1 AND id_artista = $2
         AND (eliminada IS NULL OR eliminada = FALSE) LIMIT 1`,
      [id, id_artista]
    );
    if (obraCheck.rows.length === 0)
      return res.status(404).json({ message: 'Obra no encontrada' });

    const {
      titulo, descripcion, id_categoria, tecnica, anio_creacion,
      dimensiones_alto, dimensiones_ancho, dimensiones_profundidad,
      precio_base, permite_marco, con_certificado,
      imagen_principal: imgUrl, etiquetas: etiquetasRaw,
    } = req.body;

    // Imagen: si mandaron archivo lo subimos a Cloudinary, si no usamos la URL del body
    let imagen_principal = imgUrl || null;

    if (req.file) {
      const { cloudinary } = await import('../config/cloudinaryConfig.js');
      const uploadResult = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: 'nub_studio/obras', resource_type: 'image', quality: 'auto:good', fetch_format: 'auto' },
          (error, result) => { if (error) reject(error); else resolve(result); }
        );
        stream.end(req.file.buffer);
      });
      imagen_principal = uploadResult.secure_url;
    }

    await pool.query(`
      UPDATE obras SET
        titulo                   = $1,
        descripcion              = $2,
        id_categoria             = $3,
        tecnica                  = $4,
        anio_creacion            = $5,
        dimensiones_alto         = $6,
        dimensiones_ancho        = $7,
        dimensiones_profundidad  = $8,
        precio_base              = $9,
        permite_marco            = $10,
        con_certificado          = $11,
        imagen_principal         = COALESCE($12, imagen_principal),
        estado                   = 'pendiente',
        activa                   = FALSE,
        visible                  = FALSE,
        fecha_actualizacion      = NOW()
      WHERE id_obra = $13
    `, [
      titulo,
      descripcion       || null,
      id_categoria      ? parseInt(id_categoria) : null,
      tecnica           || null,
      anio_creacion     ? parseInt(anio_creacion) : null,
      dimensiones_alto        ? parseFloat(dimensiones_alto)        : null,
      dimensiones_ancho       ? parseFloat(dimensiones_ancho)       : null,
      dimensiones_profundidad ? parseFloat(dimensiones_profundidad) : null,
      parseFloat(precio_base),
      permite_marco   === 'true' || permite_marco   === true,
      con_certificado === 'true' || con_certificado === true,
      imagen_principal,
      id,
    ]);

    // Actualizar etiquetas si vienen
    if (etiquetasRaw !== undefined) {
      let etiquetas = [];
      try { etiquetas = typeof etiquetasRaw === 'string' ? JSON.parse(etiquetasRaw) : etiquetasRaw; } catch (_) {}

      await pool.query('DELETE FROM obras_etiquetas WHERE id_obra = $1', [id]);

      if (Array.isArray(etiquetas) && etiquetas.length > 0) {
        for (const idEtiqueta of etiquetas) {
          await pool.query(
            'INSERT INTO obras_etiquetas (id_obra, id_etiqueta) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [id, idEtiqueta]
          );
        }
      }
    }

    logger.info(`Obra actualizada: id ${id} por artista ${id_artista}`);
    res.json({ success: true, message: 'Obra actualizada. Quedará en revisión hasta que el admin la apruebe.' });

  } catch (error) {
    logger.error(`Error en actualizarObraArtista: ${error.message}`);
    res.status(500).json({ message: 'Error interno del servidor', error: error.message });
  }
};