// src/controllers/tecnicasController.js
import { pool } from "../config/db.js";

const secureLog = {
  info: (message, metadata = {}) => {
    console.log(`ℹ️ ${message}`, Object.keys(metadata).length > 0 ? metadata : '');
  },
  error: (message, error) => {
    console.error(`❌ ${message}`, { name: error.name, code: error.code });
  }
};

// LISTAR TÉCNICAS (con filtro opcional por categoría)
export const listarTecnicas = async (req, res) => {
  try {
    const { categoria } = req.query;
    const params = [];
    let whereExtra = '';

    if (categoria) {
      params.push(categoria);
      whereExtra = `AND t.id_categoria = $1`;
    }

    const query = `
      SELECT 
        t.id_tecnica,
        t.id_categoria,
        t.nombre,
        t.descripcion,
        c.nombre AS categoria_nombre
      FROM tecnicas t
      LEFT JOIN categorias c ON t.id_categoria = c.id_categoria
      WHERE t.activa = TRUE AND t.eliminada = FALSE
      ${whereExtra}
      ORDER BY c.nombre ASC, t.nombre ASC
    `;

    const result = await pool.query(query, params);
    secureLog.info('Técnicas listadas', { total: result.rows.length });

    res.json({ success: true, data: result.rows });

  } catch (error) {
    secureLog.error('Error al listar técnicas', error);
    res.status(500).json({ success: false, message: 'Error al obtener las técnicas' });
  }
};

// OBTENER TÉCNICA POR ID
export const obtenerTecnicaPorId = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT t.*, c.nombre AS categoria_nombre
       FROM tecnicas t
       LEFT JOIN categorias c ON t.id_categoria = c.id_categoria
       WHERE t.id_tecnica = $1 AND t.activa = TRUE`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Técnica no encontrada' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    secureLog.error('Error al obtener técnica', error);
    res.status(500).json({ success: false, message: 'Error al obtener la técnica' });
  }
};