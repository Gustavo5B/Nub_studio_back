import { pools } from "../config/db.js";
import logger from "../config/logger.js";

// =========================================================
// LISTAR CLIENTES — GET /api/admin/clientes
// =========================================================
export const listarClientes = async (req, res) => {
  try {
    const db         = pools["admin"];
    const search     = req.query.search?.trim() || "";
    const page       = Math.max(1, Number.parseInt(req.query.page)  || 1);
    const limit      = Math.max(1, Number.parseInt(req.query.limit) || 15);
    const offset     = (page - 1) * limit;

    // Condición de búsqueda con índice de parámetro configurable
    const searchFilter = (idx) =>
      search ? `AND (u.nombre_completo ILIKE $${idx} OR u.correo ILIKE $${idx})` : "";

    const dataResult = await db.query(`
      SELECT
        u.id_usuario,
        u.nombre_completo,
        u.correo,
        u.telefono,
        u.estado,
        u.verificado,
        u.activo,
        u.fecha_registro,
        u.ultima_conexion,
        COUNT(v.id_venta) FILTER (WHERE v.cancelado = FALSE)          AS total_compras,
        COALESCE(SUM(v.total) FILTER (WHERE v.cancelado = FALSE), 0)  AS monto_total
      FROM usuarios u
      LEFT JOIN ventas v ON v.id_cliente = u.id_usuario
      WHERE u.rol = 'cliente' AND u.eliminado = FALSE ${searchFilter(3)}
      GROUP BY u.id_usuario
      ORDER BY u.fecha_registro DESC
      LIMIT $1 OFFSET $2
    `, search ? [limit, offset, `%${search}%`] : [limit, offset]);

    const countResult = await db.query(`
      SELECT
        COUNT(*)                                    AS total,
        COUNT(*) FILTER (WHERE u.activo = TRUE)     AS total_activos,
        COUNT(*) FILTER (WHERE u.verificado = TRUE) AS total_verificados
      FROM usuarios u
      WHERE u.rol = 'cliente' AND u.eliminado = FALSE ${searchFilter(1)}
    `, search ? [`%${search}%`] : []);

    const total             = Number.parseInt(countResult.rows[0].total);
    const total_activos     = Number.parseInt(countResult.rows[0].total_activos);
    const total_verificados = Number.parseInt(countResult.rows[0].total_verificados);
    const totalPages       = Math.ceil(total / limit);

    res.json({
      success: true,
      data: dataResult.rows,
      pagination: { total, page, totalPages, total_activos, total_verificados },
    });
  } catch (error) {
    logger.error(`Error al listar clientes (admin): ${error.message}`);
    res.status(500).json({ success: false, message: "Error al obtener clientes" });
  }
};

// =========================================================
// TOGGLE ACTIVO — PUT /api/admin/clientes/:id/estado
// =========================================================
export const toggleEstadoCliente = async (req, res) => {
  try {
    const db = pools["admin"];
    const { id } = req.params;

    const current = await db.query(
      `SELECT activo FROM usuarios WHERE id_usuario = $1 AND rol = 'cliente' AND eliminado = FALSE LIMIT 1`,
      [id]
    );

    if (current.rows.length === 0)
      return res.status(404).json({ success: false, message: "Cliente no encontrado" });

    const nuevoActivo = !current.rows[0].activo;

    await db.query(
      `UPDATE usuarios SET activo = $1, fecha_actualizacion = NOW() WHERE id_usuario = $2`,
      [nuevoActivo, id]
    );

    res.json({
      success: true,
      message: nuevoActivo ? "Cliente activado" : "Cliente desactivado",
      activo: nuevoActivo,
    });
  } catch (error) {
    logger.error(`Error al cambiar estado de cliente (admin): ${error.message}`);
    res.status(500).json({ success: false, message: "Error al cambiar estado" });
  }
};
