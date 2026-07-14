import { pool } from '../config/db.js';
import logger from '../config/logger.js';

// GET /api/admin/configuracion — todas las claves activas
export const getConfiguracion = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id_configuracion, clave, valor, tipo, descripcion, activo, fecha_actualizacion
       FROM configuracion_sistema WHERE activo = TRUE ORDER BY clave ASC`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error(`getConfiguracion: ${err.message}`);
    res.status(500).json({ success: false, message: 'Error al obtener configuración' });
  }
};

// PATCH /api/admin/configuracion/:clave — actualizar valor de una clave
export const updateConfiguracion = async (req, res) => {
  try {
    const { clave } = req.params;
    const { valor } = req.body;

    if (valor === undefined || valor === null)
      return res.status(400).json({ success: false, message: 'El valor es requerido' });

    const result = await pool.query(
      `UPDATE configuracion_sistema
       SET valor=$1, fecha_actualizacion=NOW()
       WHERE clave=$2 AND activo=TRUE
       RETURNING *`,
      [String(valor), clave]
    );

    if (!result.rows.length)
      return res.status(404).json({ success: false, message: 'Clave de configuración no encontrada' });

    res.json({ success: true, message: 'Configuración actualizada', data: result.rows[0] });
  } catch (err) {
    logger.error(`updateConfiguracion: ${err.message}`);
    res.status(500).json({ success: false, message: 'Error al actualizar configuración' });
  }
};

// GET /api/configuracion/:clave — valor público de una clave (para frontend)
export const getConfiguracionPublica = async (req, res) => {
  try {
    const { clave } = req.params;
    const result = await pool.query(
      `SELECT clave, valor, tipo FROM configuracion_sistema WHERE clave=$1 AND activo=TRUE LIMIT 1`,
      [clave]
    );
    if (!result.rows.length)
      return res.status(404).json({ success: false, message: 'Configuración no encontrada' });

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error(`getConfiguracionPublica: ${err.message}`);
    res.status(500).json({ success: false, message: 'Error al obtener configuración' });
  }
};
