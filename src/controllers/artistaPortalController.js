// back_auth_mysql/src/controllers/artistaPortalController.js
import { pool } from '../config/db.js';

// GET /api/artista-portal/mi-perfil
export const getMiPerfil = async (req, res) => {
  try {
    const usuarioId = req.user.id_usuario; // ✅ CORRECTO

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
    console.error('Error en getMiPerfil:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// GET /api/artista-portal/mis-obras
export const getMisObras = async (req, res) => {
  try {
    const usuarioId = req.user.id_usuario; // ✅ CORRECTO

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
    console.error('Error en getMisObras:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// POST /api/artista-portal/nueva-obra
export const nuevaObra = async (req, res) => {
  try {
    const usuarioId = req.user.id_usuario; // ✅ CORRECTO

    const artistaRes = await pool.query(
      'SELECT id_artista, estado FROM artistas WHERE id_usuario = $1',
      [usuarioId]
    );

    if (artistaRes.rows.length === 0) {
      return res.status(403).json({ message: 'No eres un artista registrado' });
    }

    const artista = artistaRes.rows[0];
    if (artista.estado !== 'activo') {
      return res.status(403).json({ message: 'Tu cuenta de artista aún no está aprobada' });
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

    res.status(201).json({
      message: 'Obra enviada. Quedará en revisión hasta que el admin la apruebe.',
      obra: obraCreada,
    });

  } catch (error) {
    console.error('Error en nuevaObra:', error);
    res.status(500).json({ message: 'Error interno del servidor', error: error.message });
  }
};