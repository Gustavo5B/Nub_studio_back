import { pool } from '../config/db.js';
import logger from '../config/logger.js';

const fmtMXN = (n) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(n);

// =========================================================
// GET /api/admin/liquidaciones/pendientes
// Resumen por artista: monto pendiente de liquidar
// =========================================================
export const getPendientes = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        a.id_artista,
        COALESCE(a.nombre_artistico, a.nombre_completo) AS nombre,
        a.correo,
        a.porcentaje_comision,
        COUNT(v.id_venta)                          AS ventas_pendientes,
        COALESCE(SUM(v.monto_artista), 0)          AS monto_pendiente,
        MIN(v.fecha_venta)                          AS venta_mas_antigua
      FROM artistas a
      INNER JOIN ventas v ON v.id_artista = a.id_artista
      WHERE v.id_liquidacion IS NULL
        AND v.estado = 'entregado'
        AND v.monto_artista IS NOT NULL
      GROUP BY a.id_artista
      ORDER BY monto_pendiente DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error(`getPendientes: ${err.message}`);
    res.status(500).json({ success: false, message: 'Error al obtener liquidaciones pendientes' });
  }
};

// =========================================================
// GET /api/admin/liquidaciones/historial
// Historial de liquidaciones realizadas
// =========================================================
export const getHistorial = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const result = await pool.query(`
      SELECT
        l.id_liquidacion,
        l.monto_total,
        l.fecha_liquidacion,
        l.notas,
        l.comprobante_url,
        COALESCE(a.nombre_artistico, a.nombre_completo) AS artista_nombre,
        a.correo AS artista_correo,
        u.nombre_completo AS admin_nombre,
        (SELECT COUNT(*) FROM ventas WHERE id_liquidacion = l.id_liquidacion) AS ventas_incluidas
      FROM liquidaciones_artistas l
      INNER JOIN artistas a ON a.id_artista = l.id_artista
      INNER JOIN usuarios u ON u.id_usuario = l.id_admin
      ORDER BY l.fecha_liquidacion DESC
      LIMIT $1 OFFSET $2
    `, [parseInt(limit), offset]);

    const total = await pool.query('SELECT COUNT(*) FROM liquidaciones_artistas');

    res.json({
      success: true,
      data: result.rows,
      pagination: { total: parseInt(total.rows[0].count), page: parseInt(page), limit: parseInt(limit) },
    });
  } catch (err) {
    logger.error(`getHistorial: ${err.message}`);
    res.status(500).json({ success: false, message: 'Error al obtener historial' });
  }
};

// =========================================================
// GET /api/admin/liquidaciones/artista/:id
// Detalle de ventas pendientes y liquidaciones de un artista
// =========================================================
export const getDetalleArtista = async (req, res) => {
  try {
    const { id } = req.params;

    const artista = await pool.query(
      `SELECT id_artista, COALESCE(nombre_artistico, nombre_completo) AS nombre,
              correo, porcentaje_comision
       FROM artistas WHERE id_artista=$1 LIMIT 1`, [id]
    );
    if (!artista.rows.length)
      return res.status(404).json({ success: false, message: 'Artista no encontrado' });

    const pendientes = await pool.query(`
      SELECT v.id_venta, v.fecha_venta, v.subtotal, v.monto_artista,
             v.estado, o.titulo AS obra_titulo
      FROM ventas v
      INNER JOIN obras o ON o.id_obra = v.id_obra
      WHERE v.id_artista=$1
        AND v.id_liquidacion IS NULL
        AND v.estado = 'entregado'
      ORDER BY v.fecha_venta DESC
    `, [id]);

    const historial = await pool.query(`
      SELECT l.id_liquidacion, l.monto_total, l.fecha_liquidacion, l.notas, l.comprobante_url,
             (SELECT COUNT(*) FROM ventas WHERE id_liquidacion = l.id_liquidacion) AS ventas_incluidas
      FROM liquidaciones_artistas l
      WHERE l.id_artista=$1
      ORDER BY l.fecha_liquidacion DESC
      LIMIT 10
    `, [id]);

    res.json({
      success: true,
      data: {
        artista: artista.rows[0],
        pendientes: pendientes.rows,
        total_pendiente: pendientes.rows.reduce((s, v) => s + Number(v.monto_artista || 0), 0),
        historial: historial.rows,
      },
    });
  } catch (err) {
    logger.error(`getDetalleArtista: ${err.message}`);
    res.status(500).json({ success: false, message: 'Error al obtener detalle' });
  }
};

// =========================================================
// POST /api/admin/liquidaciones
// Crear una liquidación: marca las ventas como liquidadas
// =========================================================
export const crearLiquidacion = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id_artista, notas, comprobante_url } = req.body;
    const id_admin = req.user.id_usuario;

    if (!id_artista)
      return res.status(400).json({ success: false, message: 'id_artista es requerido' });

    await client.query('BEGIN');

    // Calcular monto total de ventas pendientes
    const ventasRes = await client.query(`
      SELECT id_venta, monto_artista FROM ventas
      WHERE id_artista=$1
        AND id_liquidacion IS NULL
        AND estado = 'entregado'
        AND monto_artista IS NOT NULL
    `, [id_artista]);

    if (!ventasRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'No hay ventas pendientes de liquidar' });
    }

    const monto_total = ventasRes.rows.reduce((s, v) => s + Number(v.monto_artista), 0);

    // Crear registro de liquidación
    const liqRes = await client.query(
      `INSERT INTO liquidaciones_artistas (id_artista, id_admin, monto_total, notas, comprobante_url)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [id_artista, id_admin, monto_total, notas || null, comprobante_url || null]
    );
    const id_liquidacion = liqRes.rows[0].id_liquidacion;

    // Marcar todas las ventas pendientes como liquidadas
    const ids = ventasRes.rows.map(v => v.id_venta);
    await client.query(
      `UPDATE ventas SET id_liquidacion=$1 WHERE id_venta = ANY($2::int[])`,
      [id_liquidacion, ids]
    );

    await client.query('COMMIT');

    logger.info(`Liquidación ${id_liquidacion} creada: artista ${id_artista}, monto ${fmtMXN(monto_total)}, ${ids.length} ventas`);

    res.status(201).json({
      success: true,
      message: `Liquidación registrada: ${fmtMXN(monto_total)} por ${ids.length} ventas`,
      data: liqRes.rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(`crearLiquidacion: ${err.message}`);
    res.status(500).json({ success: false, message: 'Error al crear liquidación' });
  } finally {
    client.release();
  }
};
