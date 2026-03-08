import { pool } from '../config/db.js';
import logger from '../config/logger.js';

// Redes válidas según el ENUM del schema
const REDES_VALIDAS = ['instagram', 'facebook', 'tiktok', 'youtube', 'twitter', 'pinterest', 'otra'];

// ─────────────────────────────────────────────────────────
// HELPER — obtener id_artista activo del usuario autenticado
// ─────────────────────────────────────────────────────────
const getArtistaActivo = async (usuarioId) => {
  const res = await pool.query(
    `SELECT id_artista FROM artistas
     WHERE id_usuario = $1 AND estado = 'activo' AND eliminado = FALSE
     LIMIT 1`,
    [usuarioId]
  );
  return res.rows[0] ?? null;
};

// =========================================================
// GET /api/artista-portal/redes-sociales
// =========================================================
export const getRedesSociales = async (req, res) => {
  try {
    const artista = await getArtistaActivo(req.user.id_usuario);
    if (!artista)
      return res.status(403).json({ message: 'Artista no encontrado o inactivo' });

    const result = await pool.query(`
      SELECT id_red, red_social, url, usuario
      FROM artistas_redes_sociales
      WHERE id_artista = $1 AND activo = TRUE
      ORDER BY red_social ASC
    `, [artista.id_artista]);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error(`Error en getRedesSociales: ${error.message}`);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// =========================================================
// POST /api/artista-portal/redes-sociales
// Body: { red_social, url, usuario? }
// =========================================================
export const agregarRedSocial = async (req, res) => {
  try {
    const artista = await getArtistaActivo(req.user.id_usuario);
    if (!artista)
      return res.status(403).json({ message: 'Artista no encontrado o inactivo' });

    const { red_social, url, usuario } = req.body;

    if (!red_social || !url)
      return res.status(400).json({ message: 'red_social y url son obligatorios' });

    if (!REDES_VALIDAS.includes(red_social))
      return res.status(400).json({ message: `red_social inválida. Válidas: ${REDES_VALIDAS.join(', ')}` });

    // Solo una entrada por red social por artista
    const existe = await pool.query(`
      SELECT id_red FROM artistas_redes_sociales
      WHERE id_artista = $1 AND red_social = $2 AND activo = TRUE
      LIMIT 1
    `, [artista.id_artista, red_social]);

    if (existe.rows.length > 0)
      return res.status(409).json({ message: `Ya tienes registrada una cuenta de ${red_social}` });

    const result = await pool.query(`
      INSERT INTO artistas_redes_sociales (id_artista, red_social, url, usuario)
      VALUES ($1, $2, $3, $4)
      RETURNING id_red, red_social, url, usuario
    `, [artista.id_artista, red_social, url.trim(), usuario?.trim() || null]);

    logger.info(`Red social agregada: artista ${artista.id_artista} — ${red_social}`);
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    logger.error(`Error en agregarRedSocial: ${error.message}`);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// =========================================================
// PUT /api/artista-portal/redes-sociales/:id
// Body: { url, usuario? }
// =========================================================
export const actualizarRedSocial = async (req, res) => {
  try {
    const artista = await getArtistaActivo(req.user.id_usuario);
    if (!artista)
      return res.status(403).json({ message: 'Artista no encontrado o inactivo' });

    const { id } = req.params;
    const { url, usuario } = req.body;

    if (!url)
      return res.status(400).json({ message: 'url es obligatoria' });

    const result = await pool.query(`
      UPDATE artistas_redes_sociales
      SET url = $1, usuario = $2, fecha_actualizacion = NOW()
      WHERE id_red = $3 AND id_artista = $4 AND activo = TRUE
      RETURNING id_red, red_social, url, usuario
    `, [url.trim(), usuario?.trim() || null, id, artista.id_artista]);

    if (result.rows.length === 0)
      return res.status(404).json({ message: 'Red social no encontrada' });

    logger.info(`Red social actualizada: id ${id} artista ${artista.id_artista}`);
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    logger.error(`Error en actualizarRedSocial: ${error.message}`);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// =========================================================
// DELETE /api/artista-portal/redes-sociales/:id
// Soft delete — activo = FALSE
// =========================================================
export const eliminarRedSocial = async (req, res) => {
  try {
    const artista = await getArtistaActivo(req.user.id_usuario);
    if (!artista)
      return res.status(403).json({ message: 'Artista no encontrado o inactivo' });

    const { id } = req.params;

    const result = await pool.query(`
      UPDATE artistas_redes_sociales
      SET activo = FALSE
      WHERE id_red = $1 AND id_artista = $2 AND activo = TRUE
      RETURNING id_red
    `, [id, artista.id_artista]);

    if (result.rows.length === 0)
      return res.status(404).json({ message: 'Red social no encontrada' });

    logger.info(`Red social eliminada: id ${id} artista ${artista.id_artista}`);
    res.json({ success: true, message: 'Red social eliminada' });
  } catch (error) {
    logger.error(`Error en eliminarRedSocial: ${error.message}`);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};