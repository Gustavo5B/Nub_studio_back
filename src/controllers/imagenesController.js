import { pool, pools } from "../config/db.js";
import { eliminarImagen } from "../config/cloudinaryConfig.js";
import logger from "../config/logger.js";

// =========================================================
// SUBIR IMAGEN PRINCIPAL DE OBRA
// =========================================================
export const subirImagenPrincipal = async (req, res) => {
  try {
    const db = pools[req.user.rol] || pool;
    const { id_obra } = req.body;

    if (!req.file)
      return res.status(400).json({ success: false, message: 'No se proporciono ninguna imagen' });

    if (!id_obra)
      return res.status(400).json({ success: false, message: 'El ID de la obra es obligatorio' });

    const imageUrl = req.file.path;
    const publicId = req.file.public_id;

    await db.query(
      'UPDATE obras SET imagen_principal = $1 WHERE id_obra = $2',
      [imageUrl, id_obra]
    );

    const imagenExistente = await db.query(
      'SELECT id_imagen FROM imagenes_obras WHERE id_obra = $1 AND es_principal = TRUE',
      [id_obra]
    );

    if (imagenExistente.rows.length > 0) {
      await db.query(
        'UPDATE imagenes_obras SET url_imagen = $1 WHERE id_imagen = $2',
        [imageUrl, imagenExistente.rows[0].id_imagen]
      );
    } else {
      await db.query(
        'INSERT INTO imagenes_obras (id_obra, url_imagen, orden, es_principal, activa) VALUES ($1, $2, 1, TRUE, TRUE)',
        [id_obra, imageUrl]
      );
    }

    logger.info(`Imagen principal subida: obra ${id_obra}`);
    res.json({ success: true, message: 'Imagen subida exitosamente', data: { url: imageUrl, publicId } });

  } catch (error) {
    logger.error(`Error al subir imagen principal: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error al subir la imagen' });
  }
};

// =========================================================
// SUBIR MULTIPLES IMAGENES (GALERIA)
// =========================================================
export const subirImagenesGaleria = async (req, res) => {
  try {
    const db = pools[req.user.rol] || pool;
    const { id_obra } = req.body;

    if (!req.files || req.files.length === 0)
      return res.status(400).json({ success: false, message: 'No se proporcionaron imagenes' });

    if (!id_obra)
      return res.status(400).json({ success: false, message: 'El ID de la obra es obligatorio' });

    // Verificar ownership si es artista
    if (req.user.rol === 'artista') {
      const ownerCheck = await db.query(
        `SELECT o.id_obra FROM obras o
         INNER JOIN artistas a ON o.id_artista = a.id_artista
         WHERE o.id_obra = $1 AND a.id_usuario = $2 AND (o.eliminada IS NULL OR o.eliminada = FALSE)`,
        [id_obra, req.user.id_usuario]
      );
      if (ownerCheck.rows.length === 0)
        return res.status(403).json({ success: false, message: 'No tienes permiso para modificar esta obra' });
    }

    // Validar límite de 6 fotos en total
    const countResult = await db.query(
      'SELECT COUNT(*) AS total FROM imagenes_obras WHERE id_obra = $1 AND activa = TRUE',
      [id_obra]
    );
    const totalActual = Number.parseInt(countResult.rows[0].total);
    if (totalActual + req.files.length > 6)
      return res.status(400).json({
        success: false,
        message: `Solo se permiten 6 fotos por obra. Actualmente tienes ${totalActual}, intentas agregar ${req.files.length}.`
      });

    const maxOrden = await db.query(
      'SELECT COALESCE(MAX(orden), 0) as max_orden FROM imagenes_obras WHERE id_obra = $1',
      [id_obra]
    );

    let ordenInicial = maxOrden.rows[0].max_orden + 1;
    const imagenesSubidas = [];

    for (const file of req.files) {
      await db.query(
        'INSERT INTO imagenes_obras (id_obra, url_imagen, orden, es_principal, activa) VALUES ($1, $2, $3, FALSE, TRUE)',
        [id_obra, file.path, ordenInicial]
      );
      imagenesSubidas.push({ url: file.path, publicId: file.filename, orden: ordenInicial });
      ordenInicial++;
    }

    logger.info(`Imagenes de galeria subidas: obra ${id_obra}, cantidad ${req.files.length}`);
    res.json({ success: true, message: `${req.files.length} imagen(es) subida(s) exitosamente`, data: imagenesSubidas });

  } catch (error) {
    logger.error(`Error al subir imagenes de galeria: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error al subir las imagenes' });
  }
};

// =========================================================
// ELIMINAR IMAGEN
// =========================================================
export const eliminarImagenObra = async (req, res) => {
  try {
    const db = pools[req.user.rol] || pool;
    const { id_imagen } = req.params;

    const imagen = await db.query(
      'SELECT url_imagen, es_principal FROM imagenes_obras WHERE id_imagen = $1',
      [id_imagen]
    );

    if (imagen.rows.length === 0)
      return res.status(404).json({ success: false, message: 'Imagen no encontrada' });

    if (imagen.rows[0].es_principal)
      return res.status(400).json({ success: false, message: 'No se puede eliminar la imagen principal. Primero asigna otra imagen como principal.' });

    const urlParts = imagen.rows[0].url_imagen.split('/');
    const filename = urlParts[urlParts.length - 1];
    const publicId = `nub-studio/obras/${filename.split('.')[0]}`;

    await eliminarImagen(publicId);
    await db.query('DELETE FROM imagenes_obras WHERE id_imagen = $1', [id_imagen]);

    logger.info(`Imagen eliminada: id ${id_imagen}`);
    res.json({ success: true, message: 'Imagen eliminada exitosamente' });

  } catch (error) {
    logger.error(`Error al eliminar imagen: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error al eliminar la imagen' });
  }
};

// =========================================================
// REORDENAR IMAGENES
// =========================================================
export const reordenarImagenes = async (req, res) => {
  try {
    const db = pools[req.user.rol] || pool;
    const { id_obra, ordenNuevo } = req.body;

    if (!id_obra || !ordenNuevo || !Array.isArray(ordenNuevo))
      return res.status(400).json({ success: false, message: 'Datos invalidos' });

    for (let i = 0; i < ordenNuevo.length; i++) {
      await db.query(
        'UPDATE imagenes_obras SET orden = $1 WHERE id_imagen = $2 AND id_obra = $3',
        [i + 1, ordenNuevo[i], id_obra]
      );
    }

    logger.info(`Imagenes reordenadas: obra ${id_obra}`);
    res.json({ success: true, message: 'Imagenes reordenadas exitosamente' });

  } catch (error) {
    logger.error(`Error al reordenar imagenes: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error al reordenar imagenes' });
  }
};