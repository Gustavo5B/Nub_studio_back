import { pool, pools } from '../config/db.js';
import logger from '../config/logger.js';

// =========================================================
// GET /api/ventas/mis-pedidos
// Historial de compras del cliente autenticado
// =========================================================
export const getMisPedidos = async (req, res) => {
  try {
    const db = pools[req.user?.rol] || pool;
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


export const crearOrden = async (req, res) => {
  const db = pools[req.user?.rol] || pool;
  const id_cliente = req.user.id_usuario;
  const { id_direccion_envio } = req.body;

  try {
    // Obtener items del carrito activo
    const carritoRes = await db.query(`
      SELECT
        c.id_obra,
        c.cantidad,
        o.id_artista,
        o.precio_base
      FROM carritos c
      INNER JOIN obras o ON o.id_obra = c.id_obra
      WHERE c.id_usuario = $1 AND c.activo = true
    `, [id_cliente]);

    if (carritoRes.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'El carrito está vacío' });
    }

    for (const item of carritoRes.rows) {
      const precio_unitario = Number(item.precio_base);
      const subtotal = precio_unitario * item.cantidad;
      const total = subtotal;

      await db.query(`
        INSERT INTO ventas
          (id_cliente, id_obra, id_artista, cantidad, precio_unitario, subtotal, total, estado, fecha_venta, id_direccion_envio)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendiente', NOW(), $8)
      `, [id_cliente, item.id_obra, item.id_artista, item.cantidad, precio_unitario, subtotal, total, id_direccion_envio]);
    }

    // Vaciar carrito
    await db.query(`
      UPDATE carritos SET activo = false
      WHERE id_usuario = $1 AND activo = true
    `, [id_cliente]);

    logger.info(`Ventas creadas para cliente ${id_cliente} - ${carritoRes.rows.length} obras`);
    res.json({ success: true, message: 'Pedido registrado exitosamente.' });
  } catch (error) {
    logger.error(`Error en crearOrden: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error interno al procesar la compra' });
  }
};