import { pool, pools } from '../config/db.js';
import logger from '../config/logger.js';

// =========================================================
// GET /api/favoritos
// Obtiene las obras favoritas del usuario autenticado
// =========================================================
export const getFavoritos = async (req, res) => {
  try {
    const db         = pools[req.user?.rol] || pool;
    const id_usuario = req.user?.id_usuario;

    const result = await db.query(`
      SELECT
        f.id_favorito,
        f.id_obra,
        o.titulo,
        o.slug,
        o.imagen_principal,
        o.precio_base,
        o.estado,
        COALESCE(a.nombre_artistico, a.nombre_completo) AS artista_alias
      FROM favoritos f
      INNER JOIN obras    o ON o.id_obra    = f.id_obra
      INNER JOIN artistas a ON a.id_artista = o.id_artista
      WHERE f.id_usuario = $1
        AND o.eliminada IS NOT TRUE
      ORDER BY f.id_favorito DESC
    `, [id_usuario]);

    return res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('getFavoritos error:', err);
    return res.status(500).json({ success: false, message: 'Error al obtener favoritos' });
  }
};

// =========================================================
// POST /api/favoritos/:id_obra
// Agrega una obra a favoritos (toggle — si ya existe la quita)
// =========================================================
export const toggleFavorito = async (req, res) => {
  try {
    const db         = pools[req.user?.rol] || pool;
    const id_usuario = req.user?.id_usuario;
    const id_obra    = parseInt(req.params.id_obra);

    if (!id_obra || isNaN(id_obra)) {
      return res.status(400).json({ success: false, message: 'ID de obra inválido' });
    }

    // Verificar que la obra exista y esté publicada
    const obraCheck = await db.query(
      `SELECT id_obra FROM obras WHERE id_obra = $1 AND eliminada IS NOT TRUE`,
      [id_obra]
    );
    if (!obraCheck.rows.length) {
      return res.status(404).json({ success: false, message: 'Obra no encontrada' });
    }

    // Verificar si ya es favorito
    const existing = await db.query(
      `SELECT id_favorito FROM favoritos WHERE id_usuario = $1 AND id_obra = $2`,
      [id_usuario, id_obra]
    );

    if (existing.rows.length) {
      // Ya existe → eliminar
      await db.query(
        `DELETE FROM favoritos WHERE id_usuario = $1 AND id_obra = $2`,
        [id_usuario, id_obra]
      );
      logger.info(`Favorito eliminado: usuario ${id_usuario} - obra ${id_obra}`);
      return res.json({ success: true, accion: 'eliminado', message: 'Obra eliminada de favoritos' });
    } else {
      // No existe → agregar
      await db.query(
        `INSERT INTO favoritos (id_usuario, id_obra) VALUES ($1, $2)`,
        [id_usuario, id_obra]
      );
      logger.info(`Favorito agregado: usuario ${id_usuario} - obra ${id_obra}`);
      return res.json({ success: true, accion: 'agregado', message: 'Obra agregada a favoritos' });
    }
  } catch (err) {
    logger.error('toggleFavorito error:', err);
    return res.status(500).json({ success: false, message: 'Error al actualizar favoritos' });
  }
};

// =========================================================
// DELETE /api/favoritos/:id_obra
// Elimina una obra de favoritos
// =========================================================
export const eliminarFavorito = async (req, res) => {
  try {
    const db         = pools[req.user?.rol] || pool;
    const id_usuario = req.user?.id_usuario;
    const id_obra    = parseInt(req.params.id_obra);

    if (!id_obra || isNaN(id_obra)) {
      return res.status(400).json({ success: false, message: 'ID de obra inválido' });
    }

    const result = await db.query(
      `DELETE FROM favoritos WHERE id_usuario = $1 AND id_obra = $2 RETURNING id_favorito`,
      [id_usuario, id_obra]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Favorito no encontrado' });
    }

    logger.info(`Favorito eliminado: usuario ${id_usuario} - obra ${id_obra}`);
    return res.json({ success: true, message: 'Obra eliminada de favoritos' });
  } catch (err) {
    logger.error('eliminarFavorito error:', err);
    return res.status(500).json({ success: false, message: 'Error al eliminar favorito' });
  }
};

// =========================================================
// GET /api/favoritos/check/:id_obra
// Verifica si una obra específica es favorita del usuario
// =========================================================
export const checkFavorito = async (req, res) => {
  try {
    const db         = pools[req.user?.rol] || pool;
    const id_usuario = req.user?.id_usuario;
    const id_obra    = parseInt(req.params.id_obra);

    if (!id_obra || isNaN(id_obra)) {
      return res.status(400).json({ success: false, message: 'ID de obra inválido' });
    }

    const result = await db.query(
      `SELECT id_favorito FROM favoritos WHERE id_usuario = $1 AND id_obra = $2`,
      [id_usuario, id_obra]
    );

    return res.json({ success: true, esFavorito: result.rows.length > 0 });
  } catch (err) {
    logger.error('checkFavorito error:', err);
    return res.status(500).json({ success: false, message: 'Error al verificar favorito' });
  }
};
