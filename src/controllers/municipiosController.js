// controllers/municipiosController.js
import { pool, pools } from '../config/db.js';
import logger from '../config/logger.js';

export const listarMunicipiosPorEstado = async (req, res) => {
  try {
    const db = pools[req.user?.rol] || pool;
    const { id_estado } = req.params;

    if (!id_estado || isNaN(parseInt(id_estado))) {
      return res.status(400).json({ success: false, message: 'ID de estado inválido' });
    }

    const result = await db.query(`
      SELECT id_municipio, nombre, codigo_postal_rango
      FROM municipios
      WHERE id_estado = $1 AND activo = true
      ORDER BY nombre ASC
    `, [id_estado]);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error(`Error en listarMunicipiosPorEstado: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error al obtener municipios' });
  }
};

export const getMunicipiosHidalgo = async (req, res) => {
  try {
    const db = pools[req.user?.rol] || pool;
    const result = await db.query(`
      SELECT COUNT(*) as total FROM municipios
      WHERE id_estado = (SELECT id_estado FROM estados_mexico WHERE nombre ILIKE 'hidalgo' LIMIT 1)
        AND activo = TRUE
    `);
    res.status(200).json({ ok: true, data: { total: parseInt(result.rows[0].total) } });
  } catch (error) {
    res.status(500).json({ ok: false, message: "Error al obtener municipios" });
  }
};