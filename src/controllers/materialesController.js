import { pool, pools } from "../config/db.js";
import logger from "../config/logger.js";

export const listarMateriales = async (req, res) => {
  try {
    const db = pools[req.user?.rol] || pool;
    const { categoria } = req.query;

    let result;
    if (categoria) {
      result = await db.query(
        `SELECT m.id_material, m.nombre
         FROM materiales m
         JOIN categorias_materiales cm ON cm.id_material  = m.id_material
         JOIN categorias             c  ON c.id_categoria = cm.id_categoria
         WHERE m.activa = TRUE AND c.id_categoria = $1
         ORDER BY m.nombre ASC`,
        [parseInt(categoria, 10)]
      );
    } else {
      result = await db.query(
        `SELECT id_material, nombre FROM materiales WHERE activa = TRUE ORDER BY nombre ASC`
      );
    }

    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error(`Error al listar materiales: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error al obtener los materiales' });
  }
};
