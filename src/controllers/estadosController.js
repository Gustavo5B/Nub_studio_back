import { pool, pools } from '../config/db.js';
import logger from '../config/logger.js';

// =========================================================
// GET /api/estados
// Público — lista estados de México activos
// =========================================================
export const listarEstados = async (req, res) => {
  try {
    const db = pools[req.user?.rol] || pool;

    const result = await db.query(`
      SELECT id_estado, nombre, codigo, abreviatura
      FROM estados_mexico
      WHERE activo = TRUE
      ORDER BY nombre ASC
    `);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error(`Error al listar estados: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error al obtener los estados' });
  }
};