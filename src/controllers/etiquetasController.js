import { pool } from "../config/db.js";
import logger from "../config/logger.js";

// =========================================================
// LISTAR TODAS LAS ETIQUETAS ACTIVAS
// =========================================================
export const listarEtiquetas = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        e.id_etiqueta, e.nombre, e.slug,
        COUNT(o.id_obra) AS total_obras
      FROM etiquetas e
      LEFT JOIN obras_etiquetas oe ON e.id_etiqueta = oe.id_etiqueta
      LEFT JOIN obras o ON oe.id_obra = o.id_obra AND o.activa = TRUE
      WHERE e.activa = TRUE
      GROUP BY e.id_etiqueta
      HAVING COUNT(o.id_obra) > 0
      ORDER BY COUNT(o.id_obra) DESC, e.nombre ASC
    `);

    logger.info(`Etiquetas listadas: ${result.rows.length}`);
    res.json({ success: true, data: result.rows });

  } catch (error) {
    logger.error(`Error al listar etiquetas: ${error.message}`);
    res.status(500).json({ success: false, message: "Error al obtener las etiquetas" });
  }
};

// =========================================================
// OBTENER ETIQUETA POR SLUG
// =========================================================
export const obtenerEtiquetaPorSlug = async (req, res) => {
  try {
    const { slug } = req.params;

    const result = await pool.query(`
      SELECT 
        e.id_etiqueta, e.nombre, e.slug,
        COUNT(o.id_obra) AS total_obras
      FROM etiquetas e
      LEFT JOIN obras_etiquetas oe ON e.id_etiqueta = oe.id_etiqueta
      LEFT JOIN obras o ON oe.id_obra = o.id_obra AND o.activa = TRUE
      WHERE e.slug = $1 AND e.activa = TRUE
      GROUP BY e.id_etiqueta
      LIMIT 1
    `, [slug]);

    if (result.rows.length === 0)
      return res.status(404).json({ success: false, message: "Etiqueta no encontrada" });

    res.json({ success: true, data: result.rows[0] });

  } catch (error) {
    logger.error(`Error al obtener etiqueta: ${error.message}`);
    res.status(500).json({ success: false, message: "Error al obtener la etiqueta" });
  }
};