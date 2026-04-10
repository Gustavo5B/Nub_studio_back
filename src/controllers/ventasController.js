import { pool, pools } from '../config/db.js';
import logger from '../config/logger.js';

// =========================================================
// GET /api/ventas/mis-pedidos
// Historial de compras del cliente autenticado
// =========================================================
export const getMisPedidos = async (req, res) => {
  try {
    const db         = pools[req.user?.rol] || pool;
    const id_usuario = req.user?.id_usuario;

    const result = await db.query(`
      SELECT
        v.id_venta,
        v.total,
        v.estado,
        v.fecha_venta,
        o.titulo,
        o.slug,
        o.imagen_principal,
        COALESCE(v.cantidad, 1)                              AS cantidad,
        v.total                                              AS precio_unitario,
        COALESCE(a.nombre_artistico, a.nombre_completo)     AS artista_alias
      FROM   ventas v
      INNER JOIN obras    o ON o.id_obra    = v.id_obra
      INNER JOIN artistas a ON a.id_artista = v.id_artista
      WHERE  v.id_cliente = $1
      ORDER BY v.fecha_venta DESC
      LIMIT  50
    `, [id_usuario]);

    return res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('getMisPedidos error:', err.message);
    return res.status(500).json({ success: false, message: 'Error al obtener pedidos' });
  }
};
