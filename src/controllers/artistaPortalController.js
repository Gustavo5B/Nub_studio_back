import { pool, pools } from '../config/db.js';
import logger from '../config/logger.js';

// =========================================================
// GET /api/artista-portal/mi-perfil
// =========================================================
export const getMiPerfil = async (req, res) => {
  try {
    const db = pools[req.user.rol] || pool;
    const usuarioId = req.user.id_usuario;

    const result = await db.query(
      `SELECT
        a.id_artista, a.nombre_completo, a.nombre_artistico,
        a.biografia, a.foto_perfil, a.foto_portada, a.foto_logo,
        a.correo, a.telefono,
        a.ciudad, a.direccion_taller, a.codigo_postal,
        a.id_estado_base, e.nombre AS nombre_estado,
        a.id_categoria_principal, c.nombre AS categoria_nombre,
        a.dias_preparacion_default,
        a.porcentaje_comision, a.estado, a.fecha_registro,
        a.acepta_envios, a.solo_entrega_personal,
        a.politica_envios, a.politica_devoluciones, a.matricula,
        u.correo AS email_usuario
      FROM artistas a
      JOIN usuarios u ON u.id_usuario = a.id_usuario
      LEFT JOIN estados_mexico e ON e.id_estado = a.id_estado_base
      LEFT JOIN categorias c ON c.id_categoria = a.id_categoria_principal
      WHERE a.id_usuario = $1`,
      [usuarioId]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ message: 'Artista no encontrado' });

    const artista = result.rows[0];

    const fotosRes = await db.query(
      `SELECT id_foto, url_foto, es_principal, orden
       FROM artistas_fotos_personales
       WHERE id_artista = $1 AND activa = TRUE
       ORDER BY es_principal DESC, orden ASC`,
      [artista.id_artista]
    );

    res.json({ ...artista, fotos_personales: fotosRes.rows });
  } catch (error) {
    logger.error(`Error en getMiPerfil: ${error.message}`);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// =========================================================
// PUT /api/artista-portal/mi-perfil
// El artista edita sus propios datos
// NO puede cambiar: estado, comisión, matrícula
// =========================================================
export const actualizarMiPerfil = async (req, res) => {
  try {
    const db = pools[req.user.rol] || pool;
    const usuarioId = req.user.id_usuario;

    const artistaRes = await db.query(
      'SELECT id_artista, estado FROM artistas WHERE id_usuario = $1 LIMIT 1',
      [usuarioId]
    );
    if (artistaRes.rows.length === 0)
      return res.status(403).json({ message: 'No eres un artista registrado' });

    if (artistaRes.rows[0].estado !== 'activo')
      return res.status(403).json({ message: 'Tu cuenta de artista aún no está aprobada' });

    const { id_artista } = artistaRes.rows[0];

    const {
      nombre_artistico, biografia, telefono, ciudad,
      direccion_taller, codigo_postal, id_estado_base,
      id_categoria_principal, dias_preparacion_default,
      acepta_envios, solo_entrega_personal,
      politica_envios, politica_devoluciones,
    } = req.body;

    const uploadToCloudinary = async (fileBuffer) => {
      const { cloudinary } = await import('../config/cloudinaryConfig.js');
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: 'nub_studio/artistas', resource_type: 'image', quality: 'auto:good', fetch_format: 'auto' },
          (error, result) => { if (error) reject(new Error(error.message)); else resolve(result); }
        );
        stream.end(fileBuffer);
      });
    };

    let foto_portada = req.body.foto_portada || null;
    let foto_logo    = req.body.foto_logo    || null;

    if (req.files?.foto_portada?.[0]) {
      const r = await uploadToCloudinary(req.files.foto_portada[0].buffer);
      foto_portada = r.secure_url;
    }
    if (req.files?.foto_logo?.[0]) {
      const r = await uploadToCloudinary(req.files.foto_logo[0].buffer);
      foto_logo = r.secure_url;
    }

    await db.query(`
      UPDATE artistas SET
        nombre_artistico        = COALESCE($1,  nombre_artistico),
        biografia               = COALESCE($2,  biografia),
        telefono                = COALESCE($3,  telefono),
        ciudad                  = COALESCE($4,  ciudad),
        direccion_taller        = COALESCE($5,  direccion_taller),
        codigo_postal           = COALESCE($6,  codigo_postal),
        id_estado_base          = COALESCE($7,  id_estado_base),
        id_categoria_principal  = COALESCE($8,  id_categoria_principal),
        dias_preparacion_default= COALESCE($9,  dias_preparacion_default),
        acepta_envios           = COALESCE($10, acepta_envios),
        solo_entrega_personal   = COALESCE($11, solo_entrega_personal),
        politica_envios         = COALESCE($12, politica_envios),
        politica_devoluciones   = COALESCE($13, politica_devoluciones),
        foto_portada            = COALESCE($14, foto_portada),
        foto_logo               = COALESCE($15, foto_logo),
        fecha_actualizacion     = NOW()
      WHERE id_artista = $16
    `, [
      nombre_artistico        || null,
      biografia               || null,
      telefono                || null,
      ciudad                  || null,
      direccion_taller        || null,
      codigo_postal           || null,
      id_estado_base          ? Number.parseInt(id_estado_base)          : null,
      id_categoria_principal  ? Number.parseInt(id_categoria_principal)  : null,
      dias_preparacion_default? Number.parseInt(dias_preparacion_default): null,
      acepta_envios         !== undefined ? (acepta_envios         === 'true' || acepta_envios         === true) : null,
      solo_entrega_personal !== undefined ? (solo_entrega_personal === 'true' || solo_entrega_personal === true) : null,
      politica_envios         || null,
      politica_devoluciones   || null,
      foto_portada,
      foto_logo,
      id_artista,
    ]);

    logger.info(`Perfil actualizado: artista ${id_artista} usuario ${usuarioId}`);
    res.json({ success: true, message: 'Perfil actualizado correctamente', foto_portada, foto_logo });

  } catch (error) {
    logger.error(`Error en actualizarMiPerfil: ${error.message}`);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// =========================================================
// POST /api/artista-portal/fotos-personales
// =========================================================
export const agregarFotoPersonal = async (req, res) => {
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

    if (!req.file)
      return res.status(400).json({ message: 'No se proporcionó ninguna imagen' });

    const countRes = await db.query(
      'SELECT COUNT(*) AS total FROM artistas_fotos_personales WHERE id_artista = $1 AND activa = TRUE',
      [id_artista]
    );
    if (Number.parseInt(countRes.rows[0].total) >= 3)
      return res.status(400).json({ message: 'Ya tienes el máximo de 3 fotos personales' });

    const { cloudinary } = await import('../config/cloudinaryConfig.js');
    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'nub_studio/artistas', resource_type: 'image', quality: 'auto:good', fetch_format: 'auto' },
        (error, result) => { if (error) reject(new Error(error.message)); else resolve(result); }
      );
      stream.end(req.file.buffer);
    });

    const esPrimera = Number.parseInt(countRes.rows[0].total) === 0;
    const ordenRes  = await db.query(
      'SELECT COALESCE(MAX(orden), -1) AS max_orden FROM artistas_fotos_personales WHERE id_artista = $1',
      [id_artista]
    );
    const orden = Number.parseInt(ordenRes.rows[0].max_orden) + 1;

    const insertRes = await db.query(
      `INSERT INTO artistas_fotos_personales (id_artista, url_foto, es_principal, orden)
       VALUES ($1, $2, $3, $4) RETURNING id_foto, url_foto, es_principal, orden`,
      [id_artista, uploadResult.secure_url, esPrimera, orden]
    );

    if (esPrimera) {
      await db.query('UPDATE artistas SET foto_perfil = $1 WHERE id_artista = $2', [uploadResult.secure_url, id_artista]);
    }

    logger.info(`Foto personal agregada: artista ${id_artista}`);
    res.status(201).json({ success: true, message: 'Foto agregada correctamente', data: insertRes.rows[0] });

  } catch (error) {
    logger.error(`Error en agregarFotoPersonal: ${error.message}`);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// =========================================================
// DELETE /api/artista-portal/fotos-personales/:id
// =========================================================
export const eliminarFotoPersonal = async (req, res) => {
  try {
    const db = pools[req.user.rol] || pool;
    const usuarioId = req.user.id_usuario;
    const { id }    = req.params;

    const artistaRes = await db.query(
      'SELECT id_artista FROM artistas WHERE id_usuario = $1 AND estado = $2 LIMIT 1',
      [usuarioId, 'activo']
    );
    if (artistaRes.rows.length === 0)
      return res.status(403).json({ message: 'Artista no encontrado o inactivo' });

    const { id_artista } = artistaRes.rows[0];

    const fotoRes = await db.query(
      'SELECT id_foto, es_principal FROM artistas_fotos_personales WHERE id_foto = $1 AND id_artista = $2 AND activa = TRUE',
      [id, id_artista]
    );
    if (fotoRes.rows.length === 0)
      return res.status(404).json({ message: 'Foto no encontrada' });

    const countRes = await db.query(
      'SELECT COUNT(*) AS total FROM artistas_fotos_personales WHERE id_artista = $1 AND activa = TRUE',
      [id_artista]
    );
    if (Number.parseInt(countRes.rows[0].total) <= 1)
      return res.status(400).json({ message: 'No puedes eliminar tu única foto personal' });

    await db.query('UPDATE artistas_fotos_personales SET activa = FALSE WHERE id_foto = $1', [id]);

    if (fotoRes.rows[0].es_principal) {
      const siguienteRes = await db.query(
        `SELECT id_foto, url_foto FROM artistas_fotos_personales
         WHERE id_artista = $1 AND activa = TRUE
         ORDER BY orden ASC LIMIT 1`,
        [id_artista]
      );
      if (siguienteRes.rows.length > 0) {
        const siguiente = siguienteRes.rows[0];
        await db.query('UPDATE artistas_fotos_personales SET es_principal = TRUE WHERE id_foto = $1', [siguiente.id_foto]);
        await db.query('UPDATE artistas SET foto_perfil = $1 WHERE id_artista = $2', [siguiente.url_foto, id_artista]);
      }
    }

    logger.info(`Foto personal eliminada: id ${id}, artista ${id_artista}`);
    res.json({ success: true, message: 'Foto eliminada correctamente' });

  } catch (error) {
    logger.error(`Error en eliminarFotoPersonal: ${error.message}`);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// =========================================================
// GET /api/artista-portal/mis-obras
// =========================================================
export const getMisObras = async (req, res) => {
  try {
    const db = pools[req.user.rol] || pool;
    const usuarioId = req.user.id_usuario;

    const artistaRes = await db.query(
      'SELECT id_artista FROM artistas WHERE id_usuario = $1',
      [usuarioId]
    );
    if (artistaRes.rows.length === 0)
      return res.status(404).json({ message: 'Artista no encontrado' });

    const idArtista = artistaRes.rows[0].id_artista;

    const result = await db.query(
      `SELECT
        o.id_obra, o.titulo, o.slug, o.descripcion,
        o.imagen_principal, o.precio_base, o.estado,
        o.activa, o.visible, o.destacada, o.vistas,
        o.fecha_creacion, o.fecha_aprobacion, o.motivo_rechazo,
        o.dimensiones_alto, o.dimensiones_ancho, o.dimensiones_profundidad,
        o.dimensiones_unidad, o.anio_creacion, o.tecnica,
        o.permite_marco, o.con_certificado,
        o.id_coleccion,
        c.nombre AS categoria,
        col.nombre AS nombre_coleccion
      FROM obras o
      LEFT JOIN categorias c ON c.id_categoria = o.id_categoria
      LEFT JOIN colecciones col ON col.id_coleccion = o.id_coleccion AND col.eliminada = FALSE
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
    };

    res.json({ obras, stats });
  } catch (error) {
    logger.error(`Error en getMisObras: ${error.message}`);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// =========================================================
// POST /api/artista-portal/nueva-obra
// Bloquea si el perfil no está completo
// =========================================================
export const nuevaObra = async (req, res) => {
  try {
    const db = pools[req.user.rol] || pool;
    const usuarioId = req.user.id_usuario;

    const artistaRes = await db.query(
      `SELECT id_artista, estado,
        nombre_artistico, biografia, telefono, foto_perfil,
        ciudad, id_estado_base, codigo_postal, direccion_taller,
        id_categoria_principal
      FROM artistas WHERE id_usuario = $1`,
      [usuarioId]
    );
    if (artistaRes.rows.length === 0)
      return res.status(403).json({ message: 'No eres un artista registrado' });

    const artista = artistaRes.rows[0];
    if (artista.estado !== 'activo')
      return res.status(403).json({ message: 'Tu cuenta de artista aún no está aprobada' });

    const camposFaltantes = [];
    if (!artista.nombre_artistico)       camposFaltantes.push('nombre artístico');
    if (!artista.biografia)              camposFaltantes.push('biografía');
    if (!artista.telefono)               camposFaltantes.push('teléfono');
    if (!artista.foto_perfil)            camposFaltantes.push('foto de perfil');
    if (!artista.ciudad)                 camposFaltantes.push('ciudad');
    if (!artista.id_estado_base)         camposFaltantes.push('estado');
    if (!artista.codigo_postal)          camposFaltantes.push('código postal');
    if (!artista.direccion_taller)       camposFaltantes.push('dirección del taller');
    if (!artista.id_categoria_principal) camposFaltantes.push('categoría principal');

    if (camposFaltantes.length > 0) {
      return res.status(403).json({
        message: 'Completa tu perfil antes de subir obras',
        camposFaltantes,
      });
    }

    const idArtista = artista.id_artista;

    const {
      titulo, descripcion, historia, id_categoria, id_coleccion, tecnica, anio_creacion,
      dimensiones_alto, dimensiones_ancho, dimensiones_profundidad,
      precio_base, permite_marco, con_certificado, etiquetas: etiquetasRaw,
    } = req.body;

    if (!titulo || !descripcion || !id_categoria || !precio_base)
      return res.status(400).json({ message: 'Faltan campos requeridos: titulo, descripcion, id_categoria, precio_base' });

    if (!req.file)
      return res.status(400).json({ message: 'La imagen es requerida' });

    const { cloudinary } = await import('../config/cloudinaryConfig.js');
    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'nub_studio/obras', resource_type: 'image', quality: 'auto:good', fetch_format: 'auto' },
        (error, result) => { if (error) reject(error); else resolve(result); }
      );
      stream.end(req.file.buffer);
    });

    const imagenPrincipal = uploadResult.secure_url;
    const slugBase = titulo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const slug = `${slugBase}-${Date.now()}`;

    const obraRes = await db.query(
      `INSERT INTO obras (
        titulo, slug, descripcion, historia,
        id_categoria, id_artista, id_usuario_creacion,
        id_coleccion, tecnica, anio_creacion,
        dimensiones_alto, dimensiones_ancho, dimensiones_profundidad,
        precio_base, permite_marco, con_certificado,
        imagen_principal, estado, activa, visible,
        fecha_creacion, fecha_actualizacion
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'pendiente',false,false,NOW(),NOW())
      RETURNING id_obra, titulo, slug, estado, imagen_principal`,
      [
        titulo, slug, descripcion, historia || null,
        Number.parseInt(id_categoria), idArtista, usuarioId,
        id_coleccion ? Number.parseInt(id_coleccion) : null,
        tecnica || null,
        anio_creacion ? Number.parseInt(anio_creacion) : null,
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
          await db.query(
            `INSERT INTO obras_etiquetas (id_obra, id_etiqueta) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [obraCreada.id_obra, idEtiqueta]
          );
        }
      }
    }

    logger.info(`Nueva obra creada: ${obraCreada.titulo} (id: ${obraCreada.id_obra})`);
    res.status(201).json({ message: 'Obra enviada. Quedará en revisión hasta que el admin la apruebe.', obra: obraCreada });

  } catch (error) {
    logger.error(`Error en nuevaObra: ${error.message}`);
    res.status(500).json({ message: 'Error interno del servidor', error: error.message });
  }
};

// =========================================================
// GET /api/artista-portal/obra/:id
// =========================================================
export const getObraById = async (req, res) => {
  try {
    const db = pools[req.user.rol] || pool;
    const usuarioId = req.user.id_usuario;
    const { id }    = req.params;

    const artistaRes = await db.query(
      'SELECT id_artista FROM artistas WHERE id_usuario = $1 AND estado = $2 LIMIT 1',
      [usuarioId, 'activo']
    );
    if (artistaRes.rows.length === 0)
      return res.status(403).json({ message: 'Artista no encontrado o inactivo' });

    const { id_artista } = artistaRes.rows[0];

    const result = await db.query(`
      SELECT o.*,
        c.nombre AS categoria_nombre,
        COALESCE(json_agg(oe.id_etiqueta) FILTER (WHERE oe.id_etiqueta IS NOT NULL), '[]') AS etiquetas
      FROM obras o
      LEFT JOIN categorias c ON c.id_categoria = o.id_categoria
      LEFT JOIN obras_etiquetas oe ON oe.id_obra = o.id_obra
      WHERE o.id_obra = $1 AND o.id_artista = $2
        AND (o.eliminada IS NULL OR o.eliminada = FALSE)
      GROUP BY o.id_obra, c.nombre
      LIMIT 1
    `, [id, id_artista]);

    if (result.rows.length === 0)
      return res.status(404).json({ message: 'Obra no encontrada' });

    const imagenesRes = await db.query(
      `SELECT id_imagen, url_imagen, orden, es_principal
       FROM imagenes_obras WHERE id_obra = $1 AND activa = TRUE
       ORDER BY es_principal DESC, orden ASC`,
      [id]
    );

    res.json({ ...result.rows[0], imagenes: imagenesRes.rows });
  } catch (error) {
    logger.error(`Error en getObraById: ${error.message}`);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// =========================================================
// PUT /api/artista-portal/obra/:id
// =========================================================
export const actualizarObraArtista = async (req, res) => {
  try {
    const db = pools[req.user.rol] || pool;
    const usuarioId = req.user.id_usuario;
    const { id }    = req.params;

    const artistaRes = await db.query(
      'SELECT id_artista, estado FROM artistas WHERE id_usuario = $1 LIMIT 1',
      [usuarioId]
    );
    if (artistaRes.rows.length === 0)
      return res.status(403).json({ message: 'No eres un artista registrado' });

    const artista = artistaRes.rows[0];
    if (artista.estado !== 'activo')
      return res.status(403).json({ message: 'Tu cuenta de artista aún no está aprobada' });

    const { id_artista } = artista;

    const obraCheck = await db.query(
      `SELECT id_obra FROM obras WHERE id_obra = $1 AND id_artista = $2 AND (eliminada IS NULL OR eliminada = FALSE) LIMIT 1`,
      [id, id_artista]
    );
    if (obraCheck.rows.length === 0)
      return res.status(404).json({ message: 'Obra no encontrada' });

    const {
      titulo, descripcion, historia, id_categoria, id_coleccion, tecnica, anio_creacion,
      dimensiones_alto, dimensiones_ancho, dimensiones_profundidad,
      precio_base, permite_marco, con_certificado,
      imagen_principal: imgUrl, etiquetas: etiquetasRaw,
    } = req.body;

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

    await db.query(`
      UPDATE obras SET
        titulo                  = $1,
        descripcion             = $2,
        historia                = $3,
        id_categoria            = $4,
        id_coleccion            = $5,
        tecnica                 = $6,
        anio_creacion           = $7,
        dimensiones_alto        = $8,
        dimensiones_ancho       = $9,
        dimensiones_profundidad = $10,
        precio_base             = $11,
        permite_marco           = $12,
        con_certificado         = $13,
        imagen_principal        = COALESCE($14, imagen_principal),
        estado                  = 'pendiente',
        activa                  = FALSE,
        visible                 = FALSE,
        fecha_actualizacion     = NOW()
      WHERE id_obra = $15
    `, [
      titulo, descripcion || null, historia || null,
      id_categoria ? Number.parseInt(id_categoria) : null,
      id_coleccion ? Number.parseInt(id_coleccion) : null,
      tecnica || null,
      anio_creacion ? Number.parseInt(anio_creacion) : null,
      dimensiones_alto        ? Number.parseFloat(dimensiones_alto)        : null,
      dimensiones_ancho       ? Number.parseFloat(dimensiones_ancho)       : null,
      dimensiones_profundidad ? Number.parseFloat(dimensiones_profundidad) : null,
      Number.parseFloat(precio_base),
      permite_marco   === 'true' || permite_marco   === true,
      con_certificado === 'true' || con_certificado === true,
      imagen_principal, id,
    ]);

    if (etiquetasRaw !== undefined) {
      let etiquetas = [];
      try { etiquetas = typeof etiquetasRaw === 'string' ? JSON.parse(etiquetasRaw) : etiquetasRaw; } catch (e) { logger.warn(`etiquetas parse error: ${e.message}`); }
      await db.query('DELETE FROM obras_etiquetas WHERE id_obra = $1', [id]);
      if (Array.isArray(etiquetas) && etiquetas.length > 0) {
        for (const idEtiqueta of etiquetas) {
          await db.query('INSERT INTO obras_etiquetas (id_obra, id_etiqueta) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, idEtiqueta]);
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