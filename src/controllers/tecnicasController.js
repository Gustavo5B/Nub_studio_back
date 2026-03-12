import { pool, pools } from "../config/db.js";
import logger from "../config/logger.js";

// LISTAR TECNICAS (con filtro opcional por categoria)
export const listarTecnicas = async (req, res) => {
  try {
    const db = pools[req.user?.rol] || pool;
    const { categoria } = req.query;
    const params = [];
    let whereExtra = '';

    if (categoria) {
      params.push(categoria);
      whereExtra = `AND t.id_categoria = $1`;
    }

    const result = await db.query(`
      SELECT 
        t.id_tecnica, t.id_categoria, t.nombre, t.descripcion,
        c.nombre AS categoria_nombre
      FROM tecnicas t
      LEFT JOIN categorias c ON t.id_categoria = c.id_categoria
      WHERE t.activa = TRUE AND t.eliminada = FALSE
      ${whereExtra}
      ORDER BY c.nombre ASC, t.nombre ASC
    `, params);

    logger.info(`Tecnicas listadas: ${result.rows.length}`);
    res.json({ success: true, data: result.rows });

  } catch (error) {
    logger.error(`Error al listar tecnicas: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error al obtener las tecnicas' });
  }
};

// OBTENER TECNICA POR ID
export const obtenerTecnicaPorId = async (req, res) => {
  try {
    const db = pools[req.user?.rol] || pool;
    const { id } = req.params;

    const result = await db.query(
      `SELECT t.*, c.nombre AS categoria_nombre
       FROM tecnicas t
       LEFT JOIN categorias c ON t.id_categoria = c.id_categoria
       WHERE t.id_tecnica = $1 AND t.activa = TRUE`,
      [id]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ success: false, message: 'Tecnica no encontrada' });

    res.json({ success: true, data: result.rows[0] });

  } catch (error) {
    logger.error(`Error al obtener tecnica: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error al obtener la tecnica' });
  }
};